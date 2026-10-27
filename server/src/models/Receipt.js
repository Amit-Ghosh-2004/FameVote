const mongoose = require('mongoose');

/**
 * A receipt is an immutable snapshot of one confirmed vote + its payment.
 * It never exists without both a confirmed Vote and a paid (or free) Payment.
 */
const receiptSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true }, // FV-202610-XXXXXXXX
    verificationRef: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    voteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vote', required: true, unique: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },

    snapshot: {
      userName: String,
      userMasked: String,
      celebrityId: mongoose.Schema.Types.ObjectId,
      celebrityCode: String,
      celebrityName: String,
      categoryId: mongoose.Schema.Types.ObjectId,
      categoryName: String,
      campaignLabel: String, // "October 2026"
      state: String,
      stateName: String,
      amountPaise: Number,
      currency: { type: String, default: 'INR' },
      transactionStatus: String,
      razorpayPaymentId: String,
      paymentMethod: String,
    },
    issuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Receipts are immutable.
const block = function (next) { next(new Error('Receipts are immutable')); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']
  .forEach((op) => receiptSchema.pre(op, block));

module.exports = mongoose.model('Receipt', receiptSchema);
