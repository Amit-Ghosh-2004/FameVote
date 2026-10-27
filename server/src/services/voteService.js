const { Vote, Payment, Category, Celebrity, Receipt, Settings, Notification } = require('../models');
const { resolveAmountInr } = require('./amountService');
const ApiError = require('../utils/ApiError');
const { withTransaction } = require('../utils/transaction');
const { getCurrentCampaign, assertVotingOpen } = require('./campaignService');
const { issueReceipt } = require('./receiptService');

const slotKey = (userId, campaignId, categoryId) => `${userId}:${campaignId}:${categoryId}`;

/**
 * Pre-flight checks shared by the free-vote and paid-order flows.
 * These give friendly errors; the unique index on Vote remains the real guarantee.
 */
async function checkEligibility(user, { categoryId, celebrityId }, now = new Date()) {
  if (user.status !== 'active') throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
  if (!user.state) throw ApiError.unprocessable('Select your state in your profile before voting', 'STATE_REQUIRED');

  const campaign = await getCurrentCampaign(now);
  assertVotingOpen(campaign, now);

  const category = await Category.findById(categoryId);
  if (!category || category.status !== 'active') throw ApiError.unprocessable('This category is not open for voting', 'CATEGORY_INACTIVE');

  const celebrity = await Celebrity.findById(celebrityId);
  if (!celebrity || celebrity.status !== 'active' || String(celebrity.categoryId) !== String(category._id)) {
    throw ApiError.unprocessable('This celebrity is not eligible in this category', 'CELEBRITY_INELIGIBLE');
  }

  const existing = await Vote.findOne({ userId: user._id, campaignId: campaign._id, categoryId: category._id });
  if (existing) {
    throw ApiError.conflict('You have already voted in this category for this campaign', 'ALREADY_VOTED', { celebrityId: existing.celebrityId });
  }
  return { campaign, category, celebrity };
}

async function loadResult(payment) {
  const [vote, receipt] = await Promise.all([Vote.findById(payment.voteId), Receipt.findOne({ paymentId: payment._id })]);
  return { vote, receipt, payment };
}

/**
 * Turns a verified-paid (or free) Payment into exactly one confirmed Vote + one Receipt.
 * Idempotent and race-safe: the unique indexes on Vote {user,campaign,category} and
 * Vote.paymentId are the arbiter, so concurrent/duplicate calls can only ever produce one vote.
 */
async function confirmVote(payment) {
  if (payment.status !== 'paid') throw new Error(`confirmVote called for payment in status ${payment.status}`);
  if (payment.voteId) return loadResult(payment);

  try {
    const { vote, receipt } = await withTransaction(async (session) => {
      const opts = session ? { session } : {};
      const [vote] = await Vote.create(
        [{ userId: payment.userId, campaignId: payment.campaignId, categoryId: payment.categoryId, celebrityId: payment.celebrityId,
           state: payment.state, paymentId: payment._id, status: 'confirmed' }],
        opts
      );
      const receipt = await issueReceipt(vote, payment, session);
      await Vote.updateOne({ _id: vote._id }, { $set: { receiptId: receipt._id } }, opts);
      await Payment.updateOne({ _id: payment._id }, { $set: { voteId: vote._id, receiptId: receipt._id } }, opts);
      await Category.updateOne({ _id: payment.categoryId }, { $set: { hasHistoricalData: true } }, opts);
      return { vote, receipt };
    });
    Notification.create({
      userId: payment.userId, type: 'vote_confirmed', title: 'Vote confirmed',
      body: `Your vote was recorded. Receipt ${receipt.receiptNo}.`, link: `/dashboard/receipts/${receipt._id}`,
    }).catch(() => {});
    payment.voteId = vote._id; payment.receiptId = receipt._id;
    return { vote, receipt, payment };
  } catch (e) {
    if (e.code === 11000) {
      // Either this payment already produced a vote (duplicate processing) or the slot is taken.
      const mine = await Vote.findOne({ paymentId: payment._id });
      if (mine) {
        const receipt = await issueReceipt(mine, payment);
        await Payment.updateOne({ _id: payment._id }, { $set: { voteId: mine._id, receiptId: receipt._id } });
        return { vote: mine, receipt, payment };
      }
      throw ApiError.conflict('You have already voted in this category for this campaign', 'ALREADY_VOTED');
    }
    throw e;
  }
}

/** Releases a payment's live slot so the user can retry after a failed attempt. */
const releaseSlot = (paymentId, status, reason) =>
  Payment.updateOne({ _id: paymentId }, { $set: { status, failureReason: reason }, $unset: { activeKey: '' } });

async function submitFreeVote(user, { categoryId, celebrityId, amountInr, idempotencyKey }, now = new Date()) {
  // Idempotent replay (same key => same outcome, and finishes a half-completed attempt).
  if (idempotencyKey) {
    const prior = await Payment.findOne({ userId: user._id, idempotencyKey });
    if (prior) return prior.status === 'paid' ? confirmVote(prior) : Promise.reject(ApiError.conflict('This request was already processed', 'DUPLICATE_REQUEST'));
  }

  const { campaign, category, celebrity } = await checkEligibility(user, { categoryId, celebrityId }, now);
  const settings = await Settings.get();
  const chosen = resolveAmountInr(settings, amountInr);
  if (chosen > 0) {
    throw ApiError.conflict('This amount requires a payment. Use the paid flow.', 'PAYMENT_REQUIRED', { amountInr: chosen });
  }

  let payment;
  try {
    payment = await Payment.create({
      userId: user._id, campaignId: campaign._id, categoryId: category._id, celebrityId: celebrity._id, state: user.state,
      amountPaise: 0, currency: 'INR', method: 'free', status: 'paid', paidAt: now,
      activeKey: slotKey(user._id, campaign._id, category._id), idempotencyKey: idempotencyKey || undefined,
    });
  } catch (e) {
    if (e.code === 11000) throw ApiError.conflict('A vote for this category is already being processed', 'VOTE_IN_PROGRESS');
    throw e;
  }

  try {
    return await confirmVote(payment);
  } catch (e) {
    if (e.code === 'ALREADY_VOTED' || e.isApiError) await releaseSlot(payment._id, 'failed', e.code || e.message);
    throw e;
  }
}

async function listMyVotes(userId, campaignId) {
  const q = { userId, ...(campaignId ? { campaignId } : {}) };
  return Vote.find(q).sort({ createdAt: -1 })
    .populate('celebrityId', 'name code image slug')
    .populate('categoryId', 'name slug')
    .populate('campaignId', 'key title year month')
    .populate('receiptId', 'receiptNo');
}

module.exports = { checkEligibility, confirmVote, submitFreeVote, releaseSlot, listMyVotes, slotKey };
