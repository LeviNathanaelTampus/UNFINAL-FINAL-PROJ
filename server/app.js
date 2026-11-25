'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { env } = require('./config/env');
const { isDbReady } = require('./config/db');
const { sanitizeInput, requireDb, apiLimiter, notFoundApi, errorHandler } = require('./middleware/common');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render/Railway/Nginx so rate limiting sees real IPs

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://unpkg.com'],
        'style-src': ["'self'", 'https://unpkg.com', 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
        // Nominatim (OpenStreetMap) for address search / reverse lookup on the map picker
        'connect-src': ["'self'", 'https://nominatim.openstreetmap.org'],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': env.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // Helmet's default is "no-referrer", but OpenStreetMap's tile policy requires a Referer
    // (tiles return "Referer is required" without one). This sends only the origin cross-site.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// CORS: same-origin by default. Only listed origins may call the API cross-origin.
app.use(
  '/api',
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  })
);

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(sanitizeInput);

// Health check (no DB needed)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      database: isDbReady() ? 'connected' : 'unavailable',
      ai: env.gemini.enabled ? 'enabled' : 'disabled',
      email: env.gmail.enabled ? 'enabled' : 'disabled',
    },
  });
});

app.use('/api', apiLimiter);
app.use('/api/meta', require('./routes/meta')); // static reference data, works without DB
app.use('/api', requireDb);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/initiatives', require('./routes/initiatives'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/verifications', require('./routes/verifications'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/files', require('./routes/files'));
app.use('/api', notFoundApi);

// Static frontend
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'], maxAge: env.isProd ? '1h' : 0 }));
app.use((req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

app.use(errorHandler);

module.exports = app;
