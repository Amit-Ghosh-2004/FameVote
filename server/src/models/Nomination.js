const mongoose = require('mongoose');
const { GENDERS } = require('../utils/gender');
const { STATE_CODES } = require('../utils/states');

const nominationSchema = new mongoose.Schema(
  {
    nominatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // the admin for admin-created entries
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameNormalized: { type: String, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    gender: { type: String, enum: GENDERS, default: 'other' },
    state: { type: String, enum: [...STATE_CODES, null], default: null },
    reason: { type: String, trim: true, maxlength: 1000, default: '' },
    socialUrl: { type: String, trim: true, maxlength: 300 }, // ADMIN ONLY, never shown to the public
    source: { type: String, enum: ['user', 'admin'], default: 'user' },
    links: [{ type: String, maxlength: 300 }],
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'duplicate'], default: 'pending', index: true },
    possibleDuplicates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity' }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, maxlength: 500 },
    celebrityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity' }, // set when approved
    aiSummary: String, // admin-visible draft only
  },
  { timestamps: true }
);

// A user cannot nominate the same name in the same category twice while it is pending.
nominationSchema.index({ nominatedBy: 1, nameNormalized: 1, categoryId: 1 });

module.exports = mongoose.model('Nomination', nominationSchema);
