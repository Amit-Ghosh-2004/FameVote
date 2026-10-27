const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const env = require('./config/env');
const { globalLimiter, requireClientHeader, mongoSanitize, noStore } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/error');
const ApiError = require('./utils/ApiError');

function createApp() {
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
  app.get('/health', (_req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', db: ok, time: new Date().toISOString() });
  });

  // Razorpay webhooks need the RAW body for signature verification, so mount before express.json().
  app.use('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), require('./routes/webhooks'));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize);
  app.use('/api', noStore, globalLimiter, requireClientHeader);

  app.use('/api', require('./routes'));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
