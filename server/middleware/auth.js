'use strict';
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { ApiError } = require('../utils/http');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion || 0 }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Your session has expired. Please log in again.', { code: 'TOKEN_EXPIRED' });
    throw new ApiError(401, 'Invalid session. Please log in again.', { code: 'TOKEN_INVALID' });
  }
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user) throw new ApiError(401, 'Account not found. Please log in again.', { code: 'TOKEN_INVALID' });
  if ((user.tokenVersion || 0) !== (payload.tv || 0)) {
    throw new ApiError(401, 'Your session is no longer valid. Please log in again.', { code: 'TOKEN_INVALID' });
  }
  if (user.accountStatus !== 'active') {
    throw new ApiError(403, 'This account has been suspended. Contact the platform administrators.', { code: 'ACCOUNT_SUSPENDED' });
  }
  return user;
}

/** Requires a valid JWT. Sets req.user (Mongoose doc). Role always comes from the DB, never the client. */
async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) throw ApiError.unauthorized();
    req.user = await resolveUser(token);
    next();
  } catch (e) {
    next(e);
  }
}

/** Attaches req.user if a valid token is present, otherwise continues anonymously. */
async function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    req.user = await resolveUser(token);
  } catch {
    req.user = null;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role !== 'admin') return next(ApiError.forbidden('Administrator access required'));
  next();
}

const isAdmin = (user) => Boolean(user && user.role === 'admin');

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin, isAdmin };
