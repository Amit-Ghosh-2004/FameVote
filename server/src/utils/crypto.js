const crypto = require('crypto');
const env = require('../config/env');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const hmacHex = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');

/** Receipt verification reference: HMAC over the immutable identifiers of the vote. */
function receiptVerificationRef({ receiptNo, voteId, userId, celebrityId }) {
  return hmacHex(env.RECEIPT_HMAC_SECRET, `${receiptNo}|${voteId}|${userId}|${celebrityId}`)
    .slice(0, 24)
    .toUpperCase();
}

const maskEmail = (email = '') => {
  const [u, d] = email.split('@');
  if (!d) return '***';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(u.length - 2, 2))}@${d}`;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { sha256, randomToken, safeEqual, hmacHex, receiptVerificationRef, maskEmail, escapeRegex };
