const ApiError = require('../utils/ApiError');

/**
 * The HTTP server starts listening before MongoDB is connected. Until it is, API requests get an immediate, explicit
 * 503 + Retry-After instead of hanging in Mongoose's command buffer.
 *
 * Two levels:
 *  - db      : connected. Enough for reads.
 *  - indexes : the unique indexes that enforce business rules (one vote per user/category/campaign, unique receipts, ...)
 *              are built. Required for mutations, because in production indexes are built explicitly after listen
 *              (autoIndex is off) and a vote accepted before the unique index exists could race into a duplicate.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Mutations that never create or race on unique data: they may proceed as soon as the DB is connected.
const NO_INDEX_NEEDED = [/^\/auth\/login\/?$/, /^\/auth\/logout\/?$/, /^\/admin\/auth\/(login|logout)\/?$/, /^\/faq\/ask\/?$/];

/** `path` is the path relative to the /api mount (what Express exposes as req.path inside app.use('/api', ...)). */
function needsIndexes(method, path) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) return false;
  return !NO_INDEX_NEEDED.some((re) => re.test(path));
}

/** Pure decision used by the middleware and by the tests. Returns null when the request may proceed. */
function decide({ method, path }, { db, indexes }, retryAfterSeconds = 5) {
  if (!db) return { status: 503, code: 'DB_NOT_READY', message: 'The service is starting up. Please retry in a few seconds.', retryAfter: retryAfterSeconds };
  if (!indexes && needsIndexes(method, path)) return { status: 503, code: 'DB_INITIALISING', message: 'The service is finishing its start-up checks. Please retry in a few seconds.', retryAfter: retryAfterSeconds };
  return null;
}

/** requireReady(getReadiness) -> express middleware. getReadiness() must be synchronous and cheap. */
const requireReady = (getReadiness, { retryAfterSeconds = 5 } = {}) => (req, res, next) => {
  const blocked = decide({ method: req.method, path: req.path }, getReadiness(), retryAfterSeconds);
  if (!blocked) return next();
  res.set('Retry-After', String(blocked.retryAfter));
  const err = ApiError.unavailable(blocked.message, blocked.code);
  return next(err);
};

/** Body for /health and /health/ready: liveness is always true when this code runs; readiness is reported separately. */
function healthPayload({ db, indexes }, extra = {}) {
  return { status: db ? 'ok' : 'starting', live: true, ready: Boolean(db), db: Boolean(db), indexes: Boolean(indexes), ...extra };
}

module.exports = { requireReady, decide, needsIndexes, healthPayload };
