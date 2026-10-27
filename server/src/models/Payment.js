const mongoose = require('mongoose');
const { STATE_CODES } = require('../utils/states');

/**
 * Payment lifecycle (independent from Vote status):
 *
 *   created ──► paid ──► (vote confirmed, receipt issued)
 *      │          └────► requires_reconciliation ──► refund_pending ──► refunded
 *      ├──► failed
 *      ├──► cancelled
 *      └──► expired
 *
 * "paid" is only ever set after server-side signature + Razorpay API verification
 * (or amount 0 for free transactions). Admins cannot set it manually.
 */
const PAYMENT_STATUSES = [
  'created', 'paid', 'failed', 'cancelled', 'expired',
  'requires_reconciliation', 'refund_pending', 'refunded', 'refund_failed',
];
const ACTIVE_STATUSES = ['created', 'paid'];

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    celebrityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity', required: true },
    state: { type: String, enum: STATE_CODES, required: true },

    amountPaise: { type: Number, required: true, min: 0, max: 700 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    method: { type: String, enum: ['free', 'razorpay'], required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created', index: true },

    // Unique while the payment is "live" (created|paid): blocks parallel payments for the same slot.
    // Cleared (unset) when the payment fails/cancels/expires so the user can retry.
    activeKey: { type: String, unique: true, sparse: true },

    idempotencyKey: { type: String },

    razorpayOrderId: { type: String, unique: true, sparse: true },
    razorpayPaymentId: { type: String, unique: true, sparse: true },
    razorpayPaymentTime: Date, // gateway-reported time the payment was made (trusted for cutoff checks)
    signatureVerified: { type: Boolean, default: false },
    gatewayStatus: String,

    voteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vote' },
    receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt' },

    failureReason: String,
    reconciliationReason: String,
    paidAt: Date,
    refund: {
      razorpayRefundId: String,
      amountPaise: Number,
      reason: String,
      initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      initiatedAt: Date,
      processedAt: Date,
      auto: Boolean,
    },
    expiresAt: Date, // for unpaid orders
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
paymentSchema.index({ campaignId: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
