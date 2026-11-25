'use strict';
const router = require('express').Router();
const Notification = require('../models/Notification');
const { asyncHandler, ok, ApiError } = require('../utils/http');
const { v, assertObjectId, pagination, pageMeta } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/notifications?unread=true
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const unreadOnly = v(req.query).boolean('unread');
  const filter = { user: req.user._id };
  if (unreadOnly) filter.read = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-email'),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  ok(res, items, { ...pageMeta(page, limit, total), unread });
}));

// GET /api/notifications/unread-count
router.get('/unread-count', asyncHandler(async (req, res) => {
  ok(res, { unread: await Notification.countDocuments({ user: req.user._id, read: false }) });
}));

// POST /api/notifications/read-all
router.post('/read-all', asyncHandler(async (req, res) => {
  const r = await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true, readAt: new Date() } });
  ok(res, { updated: r.modifiedCount });
}));

// POST /api/notifications/:id/read
router.post('/:id/read', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'notification ID');
  const n = await Notification.findOneAndUpdate({ _id: id, user: req.user._id }, { $set: { read: true, readAt: new Date() } }, { new: true }).select('-email');
  if (!n) throw ApiError.notFound('Notification not found');
  ok(res, n);
}));

module.exports = router;
