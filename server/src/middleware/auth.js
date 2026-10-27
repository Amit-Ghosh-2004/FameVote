const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const USER_COOKIE = 'fv_token';
const ADMIN_COOKIE = 'fv_admin_token';
const ROLE_LEVEL = { user: 0, moderator: 1, admin: 2, superadmin: 3 };
const USER_TTL_MS = 7 * 24 * 3600 * 1000;
const ADMIN_TTL_MS = 8 * 3600 * 1000;

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: env.isProd,
    // Frontend (Vercel) and API (Render) are different sites in production, so SameSite=None is required.
    // CSRF is mitigated by the CORS allowlist + the required custom header (middleware/csrf.js).
    sameSite: env.isProd ? 'none' : 'lax',
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge,
    path: '/',
  };
}

function issueSession(res, user, { admin = false } = {}) {
  const token = jwt.sign({ sub: String(user._id), tv: user.tokenVersion, adm: admin }, admin ? env.ADMIN_JWT_SECRET : env.JWT_SECRET, {
    expiresIn: admin ? '8h' : '7d',
  });
  res.cookie(admin ? ADMIN_COOKIE : USER_COOKIE, token, cookieOptions(admin ? ADMIN_TTL_MS : USER_TTL_MS));
}

function clearSession(res, { admin = false } = {}) {
  const { maxAge, ...opts } = cookieOptions(0);
  res.clearCookie(admin ? ADMIN_COOKIE : USER_COOKIE, opts);
}

async function loadUser(req, { admin }) {
  const token = req.cookies?.[admin ? ADMIN_COOKIE : USER_COOKIE];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, admin ? env.ADMIN_JWT_SECRET : env.JWT_SECRET);
  } catch {
    return null;
  }
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) return null;
  if (admin && ROLE_LEVEL[user.role] < ROLE_LEVEL.moderator) return null;
  return user;
}

/**
 * requireAuth({ admin, minRole })
 *  - admin:true reads the separate admin cookie (the admin portal has its own session).
 *  - minRole: 'moderator' | 'admin' | 'superadmin'
 */
const requireAuth = ({ admin = false, minRole = null, verified = false } = {}) =>
  asyncHandler(async (req, _res, next) => {
    const user = await loadUser(req, { admin });
    if (!user) throw ApiError.unauthorized();
    if (minRole && ROLE_LEVEL[user.role] < ROLE_LEVEL[minRole]) throw ApiError.forbidden();
    req.user = user;
    next();
  });

const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = (await loadUser(req, { admin: false })) || undefined;
  next();
});

/** Never fails: attaches req.user when a valid session cookie exists, otherwise leaves it undefined (guest). */
const optionalSession = ({ admin = false } = {}) =>
  asyncHandler(async (req, _res, next) => {
    req.user = (await loadUser(req, { admin })) || undefined;
    next();
  });

module.exports = { requireAuth, optionalAuth, optionalSession, issueSession, clearSession, ROLE_LEVEL, USER_COOKIE, ADMIN_COOKIE };
