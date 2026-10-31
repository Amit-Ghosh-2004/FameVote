const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { globalLimiter, requireClientHeader, mongoSanitize, noStore } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/error');
const ApiError = require('./utils/ApiError');
const { requireReady, healthPayload } = require('./middleware/readiness');
const db = require('./config/db');
const { invalidateAll } = require('./services/publicCache');

function createApp({ getReadiness = db.getReadiness } = {}) {
  const app = express();
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs / rate limiting

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || env.clientOrigins.includes(origin)) return cb(null, true); // no-origin = server-to-server / curl
        cb(ApiError.forbidden('Origin not allowed', 'CORS_BLOCKED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-FV-Client', 'Idempotency-Key'],
    })
  );
  app.use(compression());

  // Health check (Render) - before rate limiting and auth.
  // Liveness: always 200 while the process runs (so the host sees the service as up while MongoDB wakes). Readiness is in the body
  // and at /health/ready (503 until the database is connected).
  app.get('/health', (_req, res) => res.json(healthPayload(db.getReadiness(), { bootstrap: db.state.bootstrap, uptimeSeconds: Math.round(process.uptime()) })));
  app.get('/health/ready', (_req, res) => { const r = db.getReadiness(); res.status(r.db ? 200 : 503).json(healthPayload(r)); });

  // Razorpay webhooks need the RAW body for signature verification, so mount before express.json().
  app.use('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), require('./routes/webhooks'));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize);
  app.use('/api', noStore, requireReady(getReadiness), globalLimiter, requireClientHeader);

  // Any successful admin write (catalog, settings, campaigns, results) drops the public read cache so changes show at once.
  app.use('/api/admin', (req, res, next) => { if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) invalidateAll(); }); next(); });

  app.use('/api', require('./routes'));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
