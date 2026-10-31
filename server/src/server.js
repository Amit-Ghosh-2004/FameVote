const env = require('./config/env');
const db = require('./config/db');
const { createApp } = require('./app');
const scheduler = require('./jobs/scheduler');
const { bootstrap } = require('./services/bootstrapService');

/**
 * Start-up order, chosen so a cold or slow MongoDB Atlas never keeps the API from answering:
 *   1. listen immediately  (/health answers at once; API calls get a fast 503 + Retry-After until the DB is ready)
 *   2. connect to MongoDB in the background with capped back-off, then build indexes
 *   3. once connected: bootstrap (categories, campaigns, sample lineup) and start the scheduler
 */
function main() {
  const app = createApp();
  const server = app.listen(env.PORT, () => console.log(`FameVote API listening on :${env.PORT} (${env.NODE_ENV}) after ${Math.round(process.uptime() * 1000)} ms`));

  db.connectInBackground({
    onConnected: async () => {
      db.state.bootstrap = 'running';
      const r = await bootstrap();
      db.state.bootstrap = r.skipped ? 'skipped' : r.ok ? 'done' : 'failed';
      if (env.ENABLE_SCHEDULER) await scheduler.start(); // startup recovery: campaign + payment state brought up to date (idempotent)
    },
  }).catch((e) => console.error('[db] background connect stopped', e));

  const shutdown = (sig) => {
    console.log(`${sig} received, shutting down`);
    scheduler.stop();
    server.close(() => db.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
