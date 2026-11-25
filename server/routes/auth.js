'use strict';
const router = require('express').Router();
const User = require('../models/User');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v } = require('../utils/validate');
const { signToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/common');
const { logActivity } = require('../services/activity');

function sessionPayload(user) {
  return {
    token: signToken(user),
    user: user.toJSON(),
    home: user.role === 'admin' ? '/admin.html' : '/dashboard.html',
  };
}

// POST /api/auth/register
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const val = v(req.body);
  const fullName = val.string('fullName', { required: true, min: 2, max: 100, label: 'Full name' });
  const email = val.email('email', { required: true });
  const password = val.password('password');
  if (req.body.confirmPassword !== req.body.password) val.fail('confirmPassword', 'Passwords do not match');
  val.done();

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists. Try logging in instead.', { email: 'Email already registered' });
  }

  const user = new User({ fullName, email });
  await user.setPassword(password);
  try {
    await user.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('An account with this email already exists.', { email: 'Email already registered' });
    throw err;
  }
  await logActivity(user, 'user.registered', 'User', user._id);
  created(res, sessionPayload(user));
}));

// POST /api/auth/login
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const val = v(req.body);
  const email = val.email('email', { required: true });
  const password = val.string('password', { required: true, max: 128, label: 'Password' });
  val.done();

  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  // Same message for unknown email and wrong password (no account enumeration)
  if (!user || !(await user.checkPassword(password))) {
    throw ApiError.unauthorized('Incorrect email or password');
  }
  if (user.accountStatus !== 'active') {
    throw ApiError.forbidden('This account has been suspended. Contact the platform administrators.');
  }
  user.lastLoginAt = new Date();
  await user.save();
  await logActivity(user, 'user.login', 'User', user._id);
  ok(res, sessionPayload(user));
}));

// GET /api/auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  ok(res, { user: req.user.toJSON() });
}));

module.exports = router;
