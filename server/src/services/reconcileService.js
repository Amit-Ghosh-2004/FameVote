const env = require('../config/env');
const { Payment, Vote, Campaign } = require('../models');
const { issueReceipt } = require('./receiptService');
const { confirmVote } = require('./voteService');
const { settleCapturedPayment, flagForReconciliation, refundPayment, gateway } = require('./paymentService');

const MIN = 60_000;

/** Votes that exist without a receipt (non-transactional deployments / crashes) get their receipt. */
async function repairReceipts() {
  const votes = await Vote.find({ receiptId: { $exists: false }, status: 'confirmed' }).limit(100);
  let fixed = 0;
  for (const vote of votes) {
    const payment = await Payment.findById(vote.paymentId);
    if (!payment) continue;
    const receipt = await issueReceipt(vote, payment);
    await Vote.updateOne({ _id: vote._id }, { $set: { receiptId: receipt._id } });
    await Payment.updateOne({ _id: payment._id }, { $set: { voteId: vote._id, receiptId: receipt._id } });
    fixed += 1;
  }
  return fixed;
}

/** Paid payments that never got a vote (e.g. crash between the two writes). */
async function completeOrphanPaid(now) {
  const orphans = await Payment.find({ status: 'paid', voteId: { $exists: false }, updatedAt: { $lt: new Date(now.getTime() - 2 * MIN) } }).limit(100);
  let done = 0;
  for (const p of orphans) {
    const campaign = await Campaign.findById(p.campaignId);
    const paidAt = p.razorpayPaymentTime || p.paidAt || now;
    try {
      if (!campaign || campaign.status === 'finalized' || paidAt > campaign.endsAt) {
        if (p.method === 'free') await Payment.updateOne({ _id: p._id }, { $set: { status: 'failed', failureReason: 'campaign_closed' }, $unset: { activeKey: '' } });
        else await flagForReconciliation(p._id, campaign?.status === 'finalized' ? 'campaign_finalized' : 'paid_after_campaign_close');
      } else {
        await confirmVote(p);
      }
      done += 1;
    } catch (e) {
      if (e.code === 'ALREADY_VOTED') await flagForReconciliation(p._id, 'duplicate_vote');
      else console.error('[reconcile] orphan payment', String(p._id), e.message);
    }
  }
  return done;
}

/** Unpaid orders past their TTL: ask Razorpay what actually happened before expiring them. */
async function expireStaleOrders(now) {
  const stale = await Payment.find({ status: 'created', expiresAt: { $lt: now } }).limit(100);
  let settled = 0; let expired = 0;
  for (const p of stale) {
    try {
      if (p.razorpayOrderId) {
        const res = await gateway().orders.fetchPayments(p.razorpayOrderId);
        const captured = (res.items || []).find((i) => i.status === 'captured');
        if (captured) { await settleCapturedPayment(p, captured, { signatureVerified: false, now }); settled += 1; continue; }
      }
      await Payment.updateOne({ _id: p._id, status: 'created' }, { $set: { status: 'expired', failureReason: 'order_expired' }, $unset: { activeKey: '' } });
      expired += 1;
    } catch (e) {
      console.error('[reconcile] stale order', String(p._id), e.message); // gateway unreachable: retry next tick, never expire blindly
    }
  }
  return { settled, expired };
}

/** Verified payments that could not become votes are refunded (when AUTO_REFUND is on). */
async function retryRefunds(now) {
  if (!env.AUTO_REFUND) return 0;
  const due = await Payment.find({
    status: { $in: ['requires_reconciliation', 'refund_failed'] }, method: 'razorpay', razorpayPaymentId: { $exists: true },
    $or: [{ 'refund.initiatedAt': { $exists: false } }, { 'refund.initiatedAt': { $lt: new Date(now.getTime() - 10 * MIN) } }],
  }).limit(50);
  let n = 0;
  for (const p of due) {
    try { await refundPayment(p, { reason: p.reconciliationReason || 'reconciliation', auto: true }); n += 1; }
    catch (e) { console.error('[reconcile] refund', String(p._id), e.message); }
  }
  return n;
}

async function runAll(now = new Date()) {
  const receipts = await repairReceipts();
  const orphans = await completeOrphanPaid(now);
  let stale = { settled: 0, expired: 0 };
  try { stale = await expireStaleOrders(now); } catch (e) { console.error('[reconcile] expire', e.message); }
  const refunds = await retryRefunds(now);
  return { receipts, orphans, ...stale, refunds };
}

module.exports = { repairReceipts, completeOrphanPaid, expireStaleOrders, retryRefunds, runAll };
