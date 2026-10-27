const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    celebrityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Celebrity', required: true },
  },
  { timestamps: true }
);
favoriteSchema.index({ userId: 1, celebrityId: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
