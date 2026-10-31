const { isPlaceholderEmail } = require('../utils/phone');
const env = require('../config/env');
const { Payment, Vote, Campaign, Category, Celebrity, User, Settings, WebhookEvent, Notification } = require('../models');
const { resolveAmountInr } = require('./amountService');
const ApiError = require('../utils/ApiError');
const { hmacHex, safeEqual, sha256 } = require('../utils/crypto');
const { checkEligibility, confirmVote, slotKey } = require('./voteService');

/**
 * Razorpay orders must be at least INR 1 (100 paise); we verify this at deploy time per the
 * setup guide, but also hard-guard here so an invalid price can never reach the gateway.
 */
const MIN_GATEWAY_PAISE = 100;
const ORDER_TTL_MS = 30 * 60 * 1000;

let injectedGateway = null;
let cachedGateway = null;
const setGateway = (g) => { injectedGateway = g; };
function gateway() {
  if (injectedGateway) return injectedGateway;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw ApiError.unavailable('Payments are not configured', 'PAYMENTS_UNAVAILABLE');
  if (!cachedGateway) {
    const Razorpay = require('razorpay'); // loaded on the first payment call, not at boot (pulls in axios + ~5 modules)
    cachedGateway = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
    // The SDK sets no timeout of its own: without this a stalled Razorpay call would hold the request (and a pool slot) open.
    if (cachedGateway.api?.rq?.defaults) cachedGateway.api.rq.defaults.timeout = env.RAZORPAY_TIMEOUT_MS;
  }
  return cachedGateway;
}

/** Amount in paise from the settings and the voter's (validated) request. See amountService for the rules. */
async function getVoteAmountPaise(requestedInr) {
  return resolveAmountInr(await Settings.get(), requestedInr) * 100;
}

async function createOrder(user, { categoryId, celebrityId, amountInr }, now = new Date()) {
  const amountPaise = await getVoteAmountPaise(amountInr);
  if (amountPaise === 0) throw ApiError.conflict('Voting is currently free. Use the free voting flow.', 'USE_FREE_FLOW');
  if (amountPaise < MIN_GATEWAY_PAISE) throw ApiError.unavailable('Configured amount is below the payment gateway minimum', 'AMOUNT_BELOW_MINIMUM');

  const { campaign, category, celebrity } = await checkEligibility(user, { categoryId, celebrityId }, now);
  const key = slotKey(user._id, campaign._id, category._id);

  // Reuse / replace any live payment attempt for this slot.
  const live = await Payment.findOne({ activeKey: key });
  if (live) {
    if (live.status === 'paid') throw ApiError.conflict('Your payment was received and your vote is being finalised', 'PAYMENT_ALREADY_RECEIVED');
    const sameChoice = String(live.celebrityId) === String(celebrity._id) && live.amountPaise === amountPaise && live.expiresAt > now && live.razorpayOrderId;
    if (sameChoice) return orderPayload(live, celebrity, user);
    // Different choice / stale: cancel the old unpaid attempt. A late capture on it will be refunded by reconciliation.
    await Payment.updateOne({ _id: live._id, status: 'created' }, { $set: { status: 'cancelled', failureReason: 'superseded' }, $unset: { activeKey: '' } });
  }

  let payment;
  try {
    payment = await Payment.create({
      userId: user._id, campaignId: campaign._id, categoryId: category._id, celebrityId: celebrity._id, state: user.state,
      amountPaise, currency: 'INR', method: 'razorpay', status: 'created', activeKey: key, expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
    });
  } catch (e) {
    if (e.code === 11000) throw ApiError.conflict('A payment for this category is already in progress', 'VOTE_IN_PROGRESS');
    throw e;
  }

  try {
    const order = await gateway().orders.create({
      amount: amountPaise, currency: 'INR', receipt: `fv_${payment._id}`.slice(0, 40),
      notes: { paymentId: String(payment._id), campaign: campaign.key, category: category.slug },
    });
    payment.razorpayOrderId = order.id;
    await payment.save();
  } catch (e) {
    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'failed', failureReason: 'order_creation_failed' }, $unset: { activeKey: '' } });
    if (e.isApiError) throw e;
    console.error('[razorpay] order creation failed', e?.error || e.message);
    throw ApiError.unavailable('Could not start the payment. Please try again.', 'ORDER_FAILED');
  }
  return orderPayload(payment, celebrity, user);
}

const orderPayload = (payment, celebrity, user) => ({
  paymentId: payment._id,
  orderId: payment.razorpayOrderId,
  amount: payment.amountPaise,
  currency: 'INR',
  keyId: env.RAZORPAY_KEY_ID,
  celebrityName: celebrity.name,
  prefill: { name: user.name, ...(isPlaceholderEmail(user.email) ? {} : { email: user.email }) },
  expiresAt: payment.expiresAt,
});

/** Moves a payment to requires_reconciliation (money captured but no vote can be issued). */
async function flagForReconciliation(paymentId, reason, extra = {}) {
  const p = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $in: ['created', 'cancelled', 'expired', 'failed', 'paid'] }, voteId: { $exists: false } },
    { $set: { status: 'requires_reconciliation', reconciliationReason: reason, ...extra }, $unset: { activeKey: '' } },
    { new: true }
  );
  if (p) {
    Notification.create({ userId: p.userId, type: 'payment_failed', title: 'Payment needs attention',
      body: 'Your payment was received but your vote could not be recorded. It will be refunded.', link: '/dashboard/payments' }).catch(() => {});
    if (env.AUTO_REFUND && p.razorpayPaymentId) refundPayment(p, { reason, auto: true }).catch((e) => console.error('[refund] auto refund failed', e.message));
  }
  return p;
}

/**
 * Core settlement. `rp` is the gateway's payment entity (fetched from the Razorpay API, or the
 * payload of a signature-verified webhook). Idempotent: safe to call any number of times, from
 * the browser callback, the webhook, and the reconciliation job simultaneously.
 */
async function settleCapturedPayment(payment, rp, { signatureVerified = false, now = new Date() } = {}) {
  if (rp.order_id !== payment.razorpayOrderId) throw ApiError.badRequest('Payment does not belong to this order', 'ORDER_MISMATCH');
  if (rp.amount !== payment.amountPaise || rp.currency !== 'INR') {
    await flagForReconciliation(payment._id, 'amount_or_currency_mismatch', { razorpayPaymentId: rp.id });
    throw ApiError.badRequest('Payment amount mismatch', 'AMOUNT_MISMATCH');
  }
  const paidAt = rp.created_at ? new Date(rp.created_at * 1000) : now; // gateway time, not browser time

  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'created' },
    { $set: { status: 'paid', razorpayPaymentId: rp.id, razorpayPaymentTime: paidAt, paidAt: now, gatewayStatus: 'captured',
              signatureVerified, failureReason: undefined } },
    { new: true }
  );

  if (!updated) {
    const current = await Payment.findById(payment._id);
    if (current.status === 'paid') return { status: 'paid', ...(await confirmVote(current).catch(handleConfirmFailure(current))) }; // idempotent replay
    if (['cancelled', 'expired', 'failed'].includes(current.status)) {
      await flagForReconciliation(current._id, `captured_after_${current.status}`, { razorpayPaymentId: rp.id, razorpayPaymentTime: paidAt, gatewayStatus: 'captured' });
      return { status: 'requires_reconciliation' };
    }
    return { status: current.status, vote: current.voteId, receipt: current.receiptId };
  }

  // Is the vote still acceptable? Judged by when the user actually paid (gateway time) and campaign state.
  const campaign = await Campaign.findById(updated.campaignId);
  const [category, celebrity, user] = await Promise.all([Category.findById(updated.categoryId), Celebrity.findById(updated.celebrityId), User.findById(updated.userId)]);
  let reason = null;
  if (!campaign || campaign.status === 'finalized') reason = 'campaign_finalized';
  else if (paidAt > campaign.endsAt) reason = 'paid_after_campaign_close';
  else if (paidAt < campaign.startsAt) reason = 'paid_before_campaign_start';
  else if (!category || category.status !== 'active') reason = 'category_inactive';
  else if (!celebrity || celebrity.status !== 'active') reason = 'celebrity_ineligible';
  else if (!user || user.status !== 'active') reason = 'user_suspended';
  if (reason) {
    await flagForReconciliation(updated._id, reason);
    return { status: 'requires_reconciliation', reason };
  }

  const result = await confirmVote(updated).catch(handleConfirmFailure(updated));
  return { status: result.vote ? 'paid' : 'requires_reconciliation', ...result };
}

const handleConfirmFailure = (payment) => async (e) => {
  if (e.code === 'ALREADY_VOTED') {
    await flagForReconciliation(payment._id, 'duplicate_vote', {});
    return { reason: 'duplicate_vote' };
  }
  throw e;
};

/** Browser callback: verify signature, then confirm with the gateway. The callback alone is never trusted. */
async function verifyClientPayment(user, { razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId: user._id }); // ownership check
  if (!payment) throw ApiError.notFound('Payment not found', 'PAYMENT_NOT_FOUND');
  if (!env.RAZORPAY_KEY_SECRET) throw ApiError.unavailable('Payments are not configured', 'PAYMENTS_UNAVAILABLE');

  const expected = hmacHex(env.RAZORPAY_KEY_SECRET, `${razorpay_order_id}|${razorpay_payment_id}`);
  if (!safeEqual(expected, razorpay_signature)) throw ApiError.badRequest('Payment signature verification failed', 'INVALID_SIGNATURE');

  let rp = await gateway().payments.fetch(razorpay_payment_id);
  if (rp.status === 'authorized') {
    await gateway().payments.capture(razorpay_payment_id, payment.amountPaise, 'INR');
    rp = await gateway().payments.fetch(razorpay_payment_id);
  }
  if (rp.status === 'captured') return settleCapturedPayment(payment, rp, { signatureVerified: true });
  if (rp.status === 'failed') { await markFailed(payment._id, rp.error_description || 'payment_failed'); return { status: 'failed' }; }
  return { status: 'pending' }; // not final yet; the webhook / reconciliation job will complete it
}

async function markFailed(paymentId, reason) {
  return Payment.findOneAndUpdate({ _id: paymentId, status: 'created' }, { $set: { status: 'failed', failureReason: reason }, $unset: { activeKey: '' } }, { new: true });
}

async function cancelPayment(user, paymentId) {
  const p = await Payment.findOneAndUpdate(
    { _id: paymentId, userId: user._id, status: 'created' },
    { $set: { status: 'cancelled', failureReason: 'cancelled_by_user' }, $unset: { activeKey: '' } },
    { new: true }
  );
  if (!p) throw ApiError.notFound('No cancellable payment found', 'PAYMENT_NOT_FOUND');
  return p;
}

/** Refund a verified payment that cannot (or should not) count as a vote. Atomic: cannot double refund. */
async function refundPayment(payment, { reason, initiatedBy, auto = false } = {}) {
  const claimed = await Payment.findOneAndUpdate(
    {
      _id: payment._id, razorpayPaymentId: { $exists: true, $ne: null }, method: 'razorpay',
      $or: [{ status: { $in: ['requires_reconciliation', 'refund_failed'] } }, { status: 'paid', voteId: { $exists: false } }],
    },
    { $set: { status: 'refund_pending', 'refund.reason': reason, 'refund.initiatedBy': initiatedBy, 'refund.initiatedAt': new Date(), 'refund.auto': auto, 'refund.amountPaise': payment.amountPaise } },
    { new: true }
  );
  if (!claimed) throw ApiError.conflict('This payment is not eligible for a refund', 'NOT_REFUNDABLE');
  try {
    const r = await gateway().payments.refund(claimed.razorpayPaymentId, { amount: claimed.amountPaise, speed: 'normal', notes: { reason: String(reason).slice(0, 200) } });
    const processed = r.status === 'processed';
    return Payment.findByIdAndUpdate(claimed._id, { $set: { 'refund.razorpayRefundId': r.id, status: processed ? 'refunded' : 'refund_pending', ...(processed ? { 'refund.processedAt': new Date() } : {}) } }, { new: true });
  } catch (e) {
    await Payment.updateOne({ _id: claimed._id }, { $set: { status: 'refund_failed', failureReason: String(e?.error?.description || e.message).slice(0, 300) } });
    throw ApiError.unavailable('Refund could not be started; it can be retried', 'REFUND_FAILED');
  }
}

/** Razorpay webhook entry point. `raw` is the unparsed Buffer body. */
async function handleWebhook(raw, signature, headerEventId) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw ApiError.unavailable('Webhook secret not configured', 'WEBHOOK_UNAVAILABLE');
  const expected = hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
  if (!signature || !safeEqual(expected, signature)) throw ApiError.unauthorized('Invalid webhook signature', 'INVALID_SIGNATURE');

  const body = JSON.parse(raw.toString('utf8'));
  const eventId = headerEventId || sha256(raw);

  try {
    await WebhookEvent.create({ eventId, event: body.event });
  } catch (e) {
    if (e.code !== 11000) throw e;
    const prior = await WebhookEvent.findOneAndUpdate(
      { eventId, $or: [{ status: 'failed' }, { status: 'processing', receivedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }] },
      { $set: { status: 'processing', receivedAt: new Date() } }
    );
    if (!prior) return { duplicate: true }; // already processed / in flight: acknowledge, do nothing
  }

  try {
    const outcome = await dispatchEvent(body);
    await WebhookEvent.updateOne({ eventId }, { $set: { status: outcome === 'ignored' ? 'ignored' : 'processed', processedAt: new Date() } });
    return { duplicate: false, outcome };
  } catch (e) {
    await WebhookEvent.updateOne({ eventId }, { $set: { status: 'failed', error: String(e.message).slice(0, 300) } });
    throw e; // non-2xx => Razorpay retries later
  }
}

async function dispatchEvent(body) {
  const pay = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const refund = body.payload?.refund?.entity;

  switch (body.event) {
    case 'payment.captured':
    case 'order.paid': {
      const rp = pay;
      if (!rp) return 'ignored';
      const payment = await Payment.findOne({ razorpayOrderId: rp.order_id || order?.id });
      if (!payment) return 'ignored';
      await settleCapturedPayment(payment, rp, { signatureVerified: true });
      return 'processed';
    }
    case 'payment.failed': {
      const payment = pay && (await Payment.findOne({ razorpayOrderId: pay.order_id }));
      if (!payment) return 'ignored';
      await markFailed(payment._id, pay.error_description || 'payment_failed'); // only affects 'created'; never downgrades a paid payment
      return 'processed';
    }
    case 'refund.processed': {
      const payment = refund && (await Payment.findOne({ razorpayPaymentId: refund.payment_id }));
      if (!payment) return 'ignored';
      await Payment.updateOne({ _id: payment._id, status: { $in: ['refund_pending', 'refund_failed'] } }, { $set: { status: 'refunded', 'refund.razorpayRefundId': refund.id, 'refund.processedAt': new Date() } });
      return 'processed';
    }
    case 'refund.failed': {
      const payment = refund && (await Payment.findOne({ razorpayPaymentId: refund.payment_id }));
      if (!payment) return 'ignored';
      await Payment.updateOne({ _id: payment._id, status: 'refund_pending' }, { $set: { status: 'refund_failed' } });
      return 'processed';
    }
    default:
      return 'ignored';
  }
}

module.exports = {
  setGateway, gateway, getVoteAmountPaise, createOrder, verifyClientPayment, settleCapturedPayment,
  cancelPayment, refundPayment, handleWebhook, flagForReconciliation, markFailed, MIN_GATEWAY_PAISE,
};
