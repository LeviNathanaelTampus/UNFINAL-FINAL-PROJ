'use strict';
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../utils/http');
const { isDbReady } = require('../config/db');

/** Strip keys that could be used for MongoDB operator injection ($gt, a.b) from body/query. */
function stripDangerousKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
    } else {
      stripDangerousKeys(obj[key], depth + 1);
    }
  }
}

function sanitizeInput(req, res, next) {
  stripDangerousKeys(req.body);
  stripDangerousKeys(req.params);
  // req.query is a getter in newer Express; mutate in place
  if (req.query) stripDangerousKeys(req.query);
  next();
}

/** Fail fast with 503 rather than hanging when the database is down. */
function requireDb(req, res, next) {
  if (!isDbReady()) return next(ApiError.unavailable('The database is temporarily unavailable. Your request was not saved — please try again shortly.'));
  next();
}

const limiterMessage = (msg) => ({ success: false, error: { message: msg } });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limiterMessage('Too many attempts. Please wait a few minutes and try again.'),
});

const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : req.ip),
  message: limiterMessage('Too many requests. Please slow down and try again shortly.'),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : req.ip),
  message: limiterMessage('Upload limit reached. Please try again later.'),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limiterMessage('Too many requests. Please slow down.'),
});

function notFoundApi(req, res, next) {
  next(ApiError.notFound('API endpoint not found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.expose ? err.message : 'Something went wrong on our side. Please try again.';
  let details = err.expose ? err.details : undefined;

  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    details = {};
    for (const [k, e] of Object.entries(err.errors)) details[k] = e.message;
    message = Object.values(details)[0] || 'Invalid data';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = 'This record already exists.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request is too large';
  } else if (err.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload error: ${err.message}`;
  } else if (/MongoServerSelectionError|MongoNetworkError|MongoNotConnectedError/.test(err.name || '')) {
    status = 503;
    message = 'The database is temporarily unavailable. Your request was not saved — please try again shortly.';
  }

  if (status >= 500) {
    // Never log request bodies (may contain passwords, PRC numbers, payment refs)
    console.error(`[error] ${req.method} ${req.originalUrl} → ${status}: ${err.name}: ${err.message}`);
    if (err.stack && process.env.NODE_ENV !== 'production') console.error(err.stack);
  }

  res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}

module.exports = {
  sanitizeInput, requireDb, authLimiter, writeLimiter, uploadLimiter, apiLimiter, notFoundApi, errorHandler,
};
