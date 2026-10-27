const mongoose = require('mongoose');

/**
 * Immutable ranking snapshot written when a campaign is finalized.
 * One document per (campaign, category, scope, state, revision).
 * Corrections never edit a snapshot: they add revision+1 with a reason + audit entry.
 */
const entrySchema = new mongoose.Schema(
  {
    rank: Number, // competition ranking: ties share a rank (1,2,2,4)
    celebrityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity' },
    celebrityCode: String,
    name: String,
    image: String,
    votes: Number,
    movement: Number, // positions moved vs previous finalized campaign (+ = up); null if n/a
  },
  { _id: false }
);

const snapshotSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    scope: { type: String, enum: ['national', 'state'], required: true },
    // '' for national. Gender boards reuse this field so the unique index and old snapshots stay valid:
    // '~female' = national women's board, 'TN~female' = Tamil Nadu women's board. Never matches a real state code.
    state: { type: String, default: '' },
    limit: Number, // 15 for national, 10 for state
    entries: [entrySchema],
    totalValidVotes: Number,
    revision: { type: Number, default: 1 },
    correctionReason: String,
    correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalizedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

snapshotSchema.index({ campaignId: 1, categoryId: 1, scope: 1, state: 1, revision: 1 }, { unique: true });

const block = function (next) { next(new Error('Ranking snapshots are immutable; create a new revision instead')); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']
  .forEach((op) => snapshotSchema.pre(op, block));

module.exports = mongoose.model('RankingSnapshot', snapshotSchema);
