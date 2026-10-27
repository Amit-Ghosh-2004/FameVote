const mongoose = require('mongoose');

/** One live one-time code per phone number. Only a keyed hash of the code is stored; the document expires itself. */
const schema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  windowStart: { type: Date, default: Date.now },
  sentInWindow: { type: Number, default: 1 },
});
module.exports = mongoose.model('PhoneOtp', schema);
