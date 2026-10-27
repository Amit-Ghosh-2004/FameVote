const mongoose = require('mongoose');
const { STATE_CODES } = require('../utils/states');

const voteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    celebrityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity', required: true, index: true },
    // Voter's state at the moment of voting. Immutable; drives state rankings.
    state: { type: String, enum: STATE_CODES, required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
    receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt' },
    // confirmed = counts; disqualified = removed from totals after documented fraud review
    status: { type: String, enum: ['confirmed', 'disqualified'], default: 'confirmed' },
    disqualifiedReason: { type: String, maxlength: 500 },
    disqualifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    disqualifiedAt: Date,
    ipHash: String,
  },
  { timestamps: true }
);

// THE core rule, enforced by the database: one vote per user per category per campaign.
// Status is deliberately NOT part of the key: a disqualified vote still occupies the slot,
// so disqualification can never be abused to let someone vote twice.
voteSchema.index({ userId: 1, campaignId: 1, categoryId: 1 }, { unique: true });

// Ranking aggregation paths
voteSchema.index({ campaignId: 1, categoryId: 1, status: 1, celebrityId: 1 });
voteSchema.index({ campaignId: 1, categoryId: 1, status: 1, state: 1, celebrityId: 1 });

module.exports = mongoose.model('Vote', voteSchema);
