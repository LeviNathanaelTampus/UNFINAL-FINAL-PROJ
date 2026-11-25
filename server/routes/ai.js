'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { asyncHandler, ok, ApiError } = require('../utils/http');
const { v } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { planInitiative, AiUnavailableError } = require('../services/gemini');
const { logActivity } = require('../services/activity');
const { env } = require('../config/env');
const { CATEGORIES } = require('../config/constants');

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.gemini.requestsPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ai:${req.user._id}`,
  message: { success: false, error: { message: 'You have reached the hourly limit for AI suggestions. You can keep filling in the form manually.' } },
});

// GET /api/ai/status
router.get('/status', (req, res) => ok(res, { enabled: env.gemini.enabled, receiptAnalysis: env.gemini.enabled && env.gemini.receiptAnalysis }));

// POST /api/ai/plan — AI Initiative Planning Assistant. Returns editable suggestions; never saves or publishes.
router.post('/plan', requireAuth, aiLimiter, asyncHandler(async (req, res) => {
  if (!env.gemini.enabled) throw ApiError.unavailable('The AI assistant is not available right now. You can continue filling in the form manually.');
  const val = v(req.body);
  const input = {
    category: val.oneOf('category', Object.keys(CATEGORIES), { required: true, label: 'Category' }),
    title: val.string('title', { max: 150, label: 'Title' }),
    goal: val.string('goal', { required: true, min: 10, max: 1000, label: 'What you want to do' }),
    audience: val.string('audience', { max: 300, label: 'Audience' }),
    location: val.string('location', { max: 200, label: 'Location' }),
    expectedVolunteers: val.number('expectedVolunteers', { min: 1, max: 10000, integer: true, label: 'Expected volunteers' }),
    duration: val.string('duration', { max: 100, label: 'Duration' }),
    notes: val.string('notes', { max: 1000, label: 'Notes' }),
  };
  val.done();
  try {
    const suggestions = await planInitiative(input);
    await logActivity(req.user, 'ai.plan_generated', 'User', req.user._id, { category: input.category });
    ok(res, { suggestions, notice: 'AI-generated suggestions. Review and edit before using them.' });
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      throw ApiError.unavailable(`${err.message} You can continue filling in the form manually — nothing you entered was lost.`);
    }
    throw err;
  }
}));

module.exports = router;
