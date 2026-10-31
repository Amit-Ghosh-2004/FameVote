const mongoose = require('mongoose');

/** Singleton platform settings (key = "global"). */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    // Vote transaction amount in whole rupees. 0 = free. Admin-configurable 0..7 only.
    voteAmountInr: { type: Number, default: 0, min: 0, max: 7, validate: { validator: Number.isInteger, message: 'Amount must be a whole number of rupees' } },
    // When true, voters choose their own amount (whole rupees 0..7); voteAmountInr is then just the default.
    allowCustomAmount: { type: Boolean, default: true },
    cutoffTime: { type: String, default: '23:59:59' },
    banners: [
      {
        title: String,
        subtitle: String,
        image: { url: String, publicId: String },
        link: String,
        active: { type: Boolean, default: true },
      },
    ],
    announcements: [
      {
        message: { type: String, maxlength: 300 },
        active: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Written by services/bootstrapService: which seed lineup has already been synced (so boots skip the work).
    bootstrap: { seedVersion: String, at: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

settingsSchema.statics.get = async function () {
  return this.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('Settings', settingsSchema);
