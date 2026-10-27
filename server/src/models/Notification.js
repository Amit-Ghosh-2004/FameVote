const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // null = broadcast
    type: {
      type: String,
      enum: ['vote_confirmed', 'payment_failed', 'payment_refunded', 'nomination_update', 'campaign', 'announcement', 'account'],
      required: true,
    },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, maxlength: 600, default: '' },
    link: String,
    readAt: Date,
    // Broadcasts that came from AI drafts must be approved before they go live.
    status: { type: String, enum: ['draft', 'published'], default: 'published' },
    expiresAt: Date,
  },
  { timestamps: true }
);
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
