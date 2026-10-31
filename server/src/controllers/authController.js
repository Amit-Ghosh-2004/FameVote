const bcrypt = require('bcryptjs');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sha256, randomToken } = require('../utils/crypto');
const { issueSession, clearSession } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/emailService');
const { audit } = require('../services/auditService');
const { verifyGoogleCredential } = require('../services/googleAuthService');
const otp = require('../services/otpService');
const { placeholderEmail } = require('../utils/phone');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
// Constant-time-ish dummy hash so unknown emails cost the same as wrong passwords.
// A precomputed cost-12 bcrypt hash of a throwaway string (not a secret). It used to be computed with bcrypt.hashSync at
// require time, which blocked start-up for ~360 ms on every boot.
const DUMMY_HASH = '$2a$12$pNCReNtJsGuP4VZliJaOleqtaMKXpruhNCww8B7RFlg0NtozgDJZy';

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, state } = req.body;
  if (await User.exists({ email })) {
    // Do not reveal whether the email exists beyond what registration inherently needs.
    throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const user = await User.create({ name, email, state, emailVerified: true, passwordHash: await bcrypt.hash(password, 12) });
  issueSession(res, user);
  res.status(201).json({ success: true, data: { user: user.toSafeJSON() }, message: 'Account created successfully.' });
});

async function doLogin(req, res, { admin }) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const locked = user?.lockUntil && user.lockUntil > new Date();
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  if (!user || locked || !ok || user.status !== 'active') {
    if (user && !locked && !ok) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILED) { user.lockUntil = new Date(Date.now() + LOCK_MS); user.failedLogins = 0; }
      await user.save();
    }
    if (locked) throw ApiError.tooMany('Too many failed attempts. Try again in 15 minutes.', 'ACCOUNT_LOCKED');
    if (user && ok && user.status === 'suspended') throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (admin && !['moderator', 'admin', 'superadmin'].includes(user.role)) {
    // Same message as bad credentials: do not reveal that the account exists but is not an admin.
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  user.failedLogins = 0; user.lockUntil = undefined; user.lastLoginAt = new Date();
  if (!user.emailVerified) { user.emailVerified = true; user.verifyTokenHash = undefined; user.verifyTokenExpires = undefined; }
  await user.save();
  issueSession(res, user, { admin });
  if (admin) { req.user = user; await audit(req, 'admin.login', { entity: 'User', entityId: user._id }); }
  res.json({ success: true, data: { user: user.toSafeJSON() } });
}

exports.login = asyncHandler((req, res) => doLogin(req, res, { admin: false }));
exports.adminLogin = asyncHandler((req, res) => doLogin(req, res, { admin: true }));

/**
 * Google Sign-In (ID-token flow). The browser obtains a Google-signed ID token; we verify its signature,
 * audience and expiry server-side and trust only the verified claims.
 */
exports.googleLogin = asyncHandler(async (req, res) => {
  const g = await verifyGoogleCredential(req.body.credential);
  let user = await User.findOne({ $or: [{ googleId: g.sub }, { email: g.email }] }).select('+googleId +passwordHash');
  let created = false; let passwordRemoved = false;
  if (!user) {
    user = await User.create({ name: g.name, email: g.email, state: req.body.state, emailVerified: true, googleId: g.sub, authProviders: ['google'] });
    created = true;
  } else {
    if (user.status !== 'active') throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    if (user.googleId && user.googleId !== g.sub) throw ApiError.conflict('This email is linked to a different Google account', 'GOOGLE_MISMATCH');
    if (!user.googleId) {
      // Accounts are no longer e-mail verified, so a password account for this address may have been pre-registered by
      // someone who does not own it. Google has proven ownership of the address, so linking is safe only if the old
      // password (and every session issued with it) stops working. The owner can set a new one via "Forgot password".
      if (user.role !== 'user') throw ApiError.conflict('Staff accounts must sign in with their password.', 'ACCOUNT_LINK_REQUIRED');
      if (user.passwordHash) {
        user.passwordHash = undefined; user.tokenVersion += 1;
        user.authProviders = user.authProviders.filter((p) => p !== 'password');
        passwordRemoved = true;
      }
      user.googleId = g.sub;
      user.emailVerified = true; // Google has independently verified this email.
      if (!user.authProviders.includes('google')) user.authProviders.push('google');
    }
    user.lastLoginAt = new Date();
    await user.save();
  }
  issueSession(res, user);
  res.status(created ? 201 : 200).json({ success: true, data: { user: user.toSafeJSON(), created, passwordRemoved } });
});

/** Phone sign-in step 1: text a 6-digit code. The reply never says whether the number already has an account. */
exports.phoneSend = asyncHandler(async (req, res) => {
  const out = await otp.requestCode(req.body.phone);
  res.json({ success: true, data: out, message: 'Code sent' });
});

/** Phone sign-in step 2: a correct code logs the number in, creating the account on first use. */
exports.phoneVerify = asyncHandler(async (req, res) => {
  const { phone, code, name, state } = req.body;
  await otp.verifyCode(phone, code);
  let user = await User.findOne({ phone }).select('+phone');
  let created = false;
  if (!user) {
    user = await User.create({
      name: name || `Fan ${phone.slice(-4)}`, email: placeholderEmail(phone), phone, state, emailVerified: true, authProviders: ['phone'],
    });
    created = true;
  } else {
    if (user.status !== 'active') throw ApiError.forbidden('This account is suspended', 'ACCOUNT_SUSPENDED');
    if (user.role !== 'user') throw ApiError.forbidden('Staff accounts must sign in with their password.', 'STAFF_PASSWORD_ONLY');
    user.lastLoginAt = new Date();
    await user.save();
  }
  issueSession(res, user);
  res.status(created ? 201 : 200).json({ success: true, data: { user: user.toSafeJSON(), created } });
});

exports.logout = (admin) => (_req, res) => { clearSession(res, { admin }); res.json({ success: true }); };

/** Guest-friendly session probe: always 200, `user: null` for visitors (no 401 noise in the browser console). */
exports.session = (req, res) => res.json({ success: true, data: { user: req.user ? req.user.toSafeJSON() : null } });

exports.me = (req, res) => res.json({ success: true, data: { user: req.user.toSafeJSON() } });

exports.forgotPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user && user.status === 'active') {
    const token = randomToken(32);
    user.resetTokenHash = sha256(token);
    user.resetTokenExpires = new Date(Date.now() + 3600 * 1000);
    await user.save();
    await sendPasswordResetEmail(user, token).catch((e) => console.error('[email] reset failed', e.message));
  }
  // Always the same response: no account enumeration.
  res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({ resetTokenHash: sha256(req.body.token), resetTokenExpires: { $gt: new Date() } })
    .select('+resetTokenHash +resetTokenExpires +passwordHash');
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired', 'INVALID_TOKEN');
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.resetTokenHash = undefined; user.resetTokenExpires = undefined;
  user.tokenVersion += 1; // invalidates every existing session
  user.failedLogins = 0; user.lockUntil = undefined;
  await user.save();
  res.json({ success: true, message: 'Password updated. Please log in.' });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, state } = req.body;
  if (name) req.user.name = name;
  if (state) req.user.state = state; // past votes keep their own state snapshot
  await req.user.save();
  res.json({ success: true, data: { user: req.user.toSafeJSON() } });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  // Google-only accounts have no password yet: they may set one without a current password, once signed in.
  if (!user.passwordHash) {
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    if (!user.authProviders.includes('password')) user.authProviders.push('password');
    await user.save();
    return res.json({ success: true, message: 'Password set' });
  }
  if (!req.body.currentPassword || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  user.tokenVersion += 1;
  await user.save();
  issueSession(res, user);
  res.json({ success: true, message: 'Password changed' });
});
