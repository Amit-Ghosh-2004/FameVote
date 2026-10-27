const mongoose = require('mongoose');

/** Idempotency ledger for Razorpay webhooks: eventId is unique, so a replay is detected atomically. */
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    event: String,
    status: { type: String, enum: ['processing', 'processed', 'failed', 'ignored'], default: 'processing' },
    error: String,
    receivedAt: { type: Date, default: Date.now },
    processedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
