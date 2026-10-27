const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // "2026-10"
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    cutoffTime: { type: String, default: '23:59:59' },
    // Persisted state machine. The effective state is ALSO derived from the clock
    // (see services/campaignService.effectiveStatus) so correctness never depends on a job having run.
    status: { type: String, enum: ['upcoming', 'active', 'closed', 'finalized'], default: 'upcoming', index: true },
    finalizing: { type: Boolean, default: false },
    finalizingAt: Date,
    finalizedAt: Date,
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    published: { type: Boolean, default: false }, // winners published to the public site
    publishedAt: Date,
  },
  { timestamps: true }
);

campaignSchema.index({ year: -1, month: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
