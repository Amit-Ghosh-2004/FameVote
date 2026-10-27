const env = require('./config/env');
const { connectDB } = require('./config/db');
const { createApp } = require('./app');
const scheduler = require('./jobs/scheduler');

async function main() {
  await connectDB();
  const app = createApp();
  const server = app.listen(env.PORT, () => console.log(`FameVote API listening on :${env.PORT} (${env.NODE_ENV})`));

  // Startup recovery: bring campaign + payment state up to date immediately (idempotent).
  if (env.ENABLE_SCHEDULER) await scheduler.start();

  const shutdown = (sig) => {
    console.log(`${sig} received, shutting down`);
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => { console.error('Fatal startup error', e); process.exit(1); });
