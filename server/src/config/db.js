const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);
// Production never builds indexes implicitly in the background of every instance start: ensureIndexes() below does it
// explicitly, idempotently, and AFTER the HTTP server is listening. (Dev/test keep Mongoose's automatic build.)
// NOTE: this must run before the models are compiled, which is why every entry point requires this file first.
mongoose.set('autoIndex', !env.isProd);

/** Models whose unique indexes ARE business rules (one vote per slot, unique receipts, ...). Mutations wait for these. */
const CRITICAL_MODELS = ['User', 'Category', 'Celebrity', 'Campaign', 'Vote', 'Payment', 'Receipt', 'RankingSnapshot', 'Favorite', 'Settings', 'WebhookEvent', 'PhoneOtp'];

/** Live state read by /health and the readiness middleware. Plain object so it is trivial to fake in tests. */
const state = {
  startedAt: Date.now(),
  connectAttempts: 0,
  lastError: null,
  indexesReady: false,
  indexErrors: [],
  bootstrap: 'pending', // pending | running | done | skipped | failed  (see services/bootstrapService)
};

const isDbReady = () => mongoose.connection.readyState === 1;
const getReadiness = () => ({ db: isDbReady(), indexes: state.indexesReady });

function connectOptions() {
  const o = {
    appName: 'famevote-api',
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: env.MONGO_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.MONGO_SOCKET_TIMEOUT_MS,
    maxIdleTimeMS: 120_000,
  };
  // Wire compression is opt-in: it trades CPU (small free-tier instances) for bandwidth. 'zlib' needs no extra package.
  if (env.MONGO_COMPRESSORS) o.compressors = env.MONGO_COMPRESSORS;
  return o;
}

/** Exponential backoff with a cap: 1s, 2s, 4s, 8s, 15s, 15s ... (no tight retry loops against Atlas). */
const backoffMs = (attempt, { base = 1000, cap = 15_000 } = {}) => Math.min(cap, base * 2 ** Math.max(0, attempt));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

/**
 * Runs createIndexes() for each model with bounded parallelism. Idempotent: existing identical indexes are no-ops, and
 * nothing is ever dropped (we deliberately do NOT call syncIndexes). Never throws; returns { built, failed }.
 */
async function ensureIndexes(models = Object.values(mongoose.models), { concurrency = 4, log = console } = {}) {
  const queue = [...models];
  const built = []; const failed = [];
  async function worker() {
    while (queue.length) {
      const m = queue.shift();
      try { await m.createIndexes(); built.push(m.modelName); } catch (e) {
        failed.push({ model: m.modelName, error: e.message });
        log.error?.(`[db] index build failed for ${m.modelName}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, worker));
  return { built, failed };
}

/** Pure decision: are the indexes that enforce business rules all in place? */
const criticalIndexesOk = (failed, critical = CRITICAL_MODELS) => !failed.some((f) => critical.includes(f.model));

async function runEnsureIndexes() {
  const { failed } = await ensureIndexes();
  state.indexErrors = failed;
  state.indexesReady = criticalIndexesOk(failed);
  return state.indexesReady;
}

let stopped = false;
const stopBackground = () => { stopped = true; };

/**
 * Non-blocking startup path used by server.js: keeps trying to connect (with backoff) and then builds indexes, retrying
 * those too until the critical ones are in place. Resolves once connected AND indexed (or when stopBackground() is called).
 * `onConnected` runs right after the first successful connect (the bootstrap hooks in here).
 */
async function connectInBackground({ uri = env.MONGODB_URI, onConnected, log = console } = {}) {
  let attempt = 0;
  while (!stopped && !isDbReady()) {
    state.connectAttempts += 1;
    try {
      await mongoose.connect(uri, connectOptions());
    } catch (e) {
      state.lastError = e.message;
      const wait = backoffMs(attempt++);
      log.error?.(`[db] connect attempt ${state.connectAttempts} failed (${e.message.split('\n')[0]}); retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  if (stopped) return;
  state.lastError = null;
  log.log?.(`[db] connected after ${state.connectAttempts} attempt(s)`);

  const hooks = Promise.resolve(onConnected?.()).catch((e) => log.error?.('[db] onConnected hook failed', e));
  let idx = 0;
  while (!stopped && !(await runEnsureIndexes())) {
    const wait = backoffMs(idx++, { base: 5000, cap: 60_000 });
    log.error?.(`[db] critical indexes are not ready yet; mutations stay 503. Retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  if (state.indexesReady) log.log?.('[db] indexes ready');
  await hooks;
}

/**
 * Blocking connect used by CLI scripts (seed, images:*). Same options, then the explicit index build, so a script run with
 * NODE_ENV=production still gets its unique indexes even though autoIndex is off.
 */
async function connectDB(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, connectOptions());
  const { failed } = await ensureIndexes();
  if (failed.length) throw new Error(`Index build failed: ${failed.map((f) => `${f.model}: ${f.error}`).join('; ')}`);
  state.indexesReady = true;
  return mongoose.connection;
}

async function disconnect() {
  stopBackground();
  try { await mongoose.disconnect(); } catch { /* already closed */ }
}

module.exports = { connectDB, connectInBackground, ensureIndexes, criticalIndexesOk, backoffMs, connectOptions, isDbReady, getReadiness, state, disconnect, stopBackground, CRITICAL_MODELS };
