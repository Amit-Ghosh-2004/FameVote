const crypto = require('crypto');
const env = require('../config/env');
const { PhoneOtp } = require('../models');
const ApiError = require('../utils/ApiError');
const { hmacHex, safeEqual } = require('../utils/crypto');
const { sendOtp, verifyTwilioOtp } = require('./smsService');

const TTL_MS = 5 * 60_000;
const COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const hashCode = (phone, code) => hmacHex(env.JWT_SECRET, `otp|${phone}|${code}`);
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Creates (or replaces) the code for a phone and sends it. Rate limited per number on top of the per-IP limiter. */
async function requestCode(phone, { now = new Date(), send = sendOtp } = {}) {
  if (!env.phoneLoginEnabled) throw ApiError.unavailable('Phone sign-in is not available right now', 'PHONE_DISABLED');
  const cur = await PhoneOtp.findOne({ phone });
  let windowStart = now; let sent = 1;
  if (cur) {
    if (now - cur.lastSentAt < COOLDOWN_MS) throw ApiError.tooMany(`Please wait ${Math.ceil((COOLDOWN_MS - (now - cur.lastSentAt)) / 1000)} seconds before asking for another code`, 'OTP_COOLDOWN');
    if (now - cur.windowStart < 3600_000) {
      windowStart = cur.windowStart; sent = cur.sentInWindow + 1;
      if (sent > MAX_SENDS_PER_HOUR) throw ApiError.tooMany('Too many codes requested for this number. Try again in an hour.', 'OTP_LIMIT');
    }
  }
  const code = newCode();
  await PhoneOtp.updateOne({ phone }, { $set: { codeHash: hashCode(phone, code), expiresAt: new Date(now.getTime() + TTL_MS), attempts: 0, lastSentAt: now, windowStart, sentInWindow: sent } }, { upsert: true });
  try { await send(phone, code); } catch (e) {
    await PhoneOtp.deleteOne({ phone });
    console.error('[sms] send failed:', e.message);
    throw new ApiError(502, 'We could not send the code. Please try again.', 'SMS_FAILED');
  }
  return { expiresInSeconds: TTL_MS / 1000, resendInSeconds: COOLDOWN_MS / 1000 };
}

/** Checks a code. A correct code is consumed; a wrong one counts an attempt and the code dies after MAX_ATTEMPTS. */
async function verifyCode(phone, code, { now = new Date() } = {}) {
  const bad = () => ApiError.badRequest('That code is wrong or has expired', 'INVALID_OTP');
  const doc = await PhoneOtp.findOne({ phone });
  if (!doc || doc.expiresAt <= now || doc.attempts >= MAX_ATTEMPTS) throw bad();
  if (env.SMS_PROVIDER === 'twilio') {
    let approved;
    try {
      approved = await verifyTwilioOtp(phone, code);
    } catch (e) {
      // A provider/network failure is not an incorrect user code; preserve the record for retry.
      console.error('[sms] verification request failed:', e.message);
      throw ApiError.unavailable(
        'OTP verification is temporarily unavailable. Please try again.',
        'OTP_PROVIDER_UNAVAILABLE'
      );
    }
    if (!approved) {
      await PhoneOtp.updateOne(
        { phone, codeHash: doc.codeHash },
        { $inc: { attempts: 1 } }
      );
      throw bad();
    }
  } else if (!safeEqual(doc.codeHash, hashCode(phone, code))) {
    await PhoneOtp.updateOne(
      { phone, codeHash: doc.codeHash },
      { $inc: { attempts: 1 } }
    );
    throw bad();
  }

  // Consume atomically so one code cannot be used twice, even by two parallel requests.
  const used = await PhoneOtp.deleteOne({ phone, codeHash: doc.codeHash });
  if (!used.deletedCount) throw bad();
}

module.exports = { requestCode, verifyCode, hashCode, TTL_MS, COOLDOWN_MS, MAX_ATTEMPTS };
