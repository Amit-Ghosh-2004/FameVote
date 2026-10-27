const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const limiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max: env.isTest ? 10_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(ApiError.tooMany(message)),
  });

const globalLimiter = limiter(15 * 60 * 1000, 600, 'Too many requests, please slow down.');
const authLimiter = limiter(15 * 60 * 1000, 20, 'Too many attempts. Try again in a few minutes.');
const voteLimiter = limiter(60 * 1000, 20, 'Too many voting requests. Please wait a moment.');
const aiLimiter = limiter(60 * 1000, 15, 'AI rate limit reached. Please wait a minute.');
const uploadLimiter = limiter(60 * 1000, 20, 'Too many uploads. Please wait a minute.');

/**
 * CSRF defence for cookie auth: every state-changing request must carry a custom header.
 * Browsers cannot attach custom headers cross-site without a CORS preflight, which our
 * origin allowlist rejects. Razorpay webhooks are exempt (they use HMAC signatures instead).
 */
function requireClientHeader(req, _res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safe || req.path.startsWith('/webhooks/') || env.isTest) return next();
  if (req.get('x-fv-client') !== 'web') return next(ApiError.forbidden('Missing client header', 'CSRF'));
  next();
}

/** Strips Mongo operators from user input ($-prefixed and dotted keys) to prevent NoSQL injection. */
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}
function mongoSanitize(req, _res, next) {
  if (req.body) req.body = sanitize(req.body);
  if (req.query) {
    const clean = sanitize(req.query);
    Object.keys(req.query).forEach((k) => delete req.query[k]);
    Object.assign(req.query, clean);
  }
  if (req.params) req.params = sanitize(req.params);
  next();
}

/**
 * Cache policy. Everything under /api is private and uncacheable by default (sessions, votes, receipts, admin).
 * Public read-only endpoints opt in with publicCache(seconds), which lets browsers and a CDN reuse the response briefly.
 */
const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
const publicCache = (seconds, swr = seconds * 3) => (_req, res, next) => {
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${swr}`);
  next();
};

module.exports = { noStore, publicCache, globalLimiter, authLimiter, voteLimiter, aiLimiter, uploadLimiter, requireClientHeader, mongoSanitize };
