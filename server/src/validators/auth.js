const { z } = require('zod');
const { STATE_CODES } = require('../utils/states');

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const { normalizePhone } = require('../utils/phone');
const emptyToUndef0 = (v) => (v === '' || v === null ? undefined : v);
const email = z.string().trim().toLowerCase().email().max(254);

exports.register = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  password,
  state: z.enum(STATE_CODES).optional(),
});
exports.login = z.object({ email, password: z.string().min(1).max(128) });
const phone = z.string().trim().min(8).max(20).transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number (10 digits for India, or with a country code)' });
  return p;
});
exports.phoneSend = z.object({ phone });
exports.phoneVerify = z.object({
  phone,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  name: z.preprocess(emptyToUndef0, z.string().trim().min(2).max(80).optional()),
  state: z.preprocess(emptyToUndef0, z.enum(STATE_CODES).optional()),
});
exports.token = z.object({ token: z.string().min(20).max(200) });
exports.forgot = z.object({ email });
exports.reset = z.object({ token: z.string().min(20).max(200), password });
exports.profile = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  state: z.enum(STATE_CODES).optional(),
});
exports.changePassword = z.object({ currentPassword: z.string().max(128).optional(), newPassword: password });
// Google Identity Services sends { credential } (an ID token, a JWT). Accept the common alias names too, treat an empty or
// unknown state as "not provided" (it only seeds a new account's state), and keep the length bounds generous but finite.
const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);
exports.google = z.preprocess(
  (b) => {
    const o = b && typeof b === 'object' ? { ...b } : {};
    o.credential = o.credential ?? o.idToken ?? o.id_token ?? o.token;
    const st = typeof o.state === 'string' ? o.state.trim().toUpperCase() : o.state;
    o.state = STATE_CODES.includes(st) ? st : undefined;
    return o;
  },
  z.object({ credential: z.string().trim().min(20, 'Google credential is missing').max(8192), state: z.preprocess(emptyToUndef, z.enum(STATE_CODES).optional()) })
);
