'use strict';
const router = require('express').Router();
const User = require('../models/User');
const Initiative = require('../models/Initiative');
const Registration = require('../models/Registration');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const { asyncHandler, ok, ApiError } = require('../utils/http');
const { v, assertObjectId } = require('../utils/validate');
const { requireAuth, signToken } = require('../middleware/auth');
const { writeLimiter, authLimiter } = require('../middleware/common');
const { assertOwnPublicImage } = require('../utils/gridfs');
const { initiativeCard } = require('../utils/serialize');
const { logActivity } = require('../services/activity');

// GET /api/users/me — full own profile
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const orgs = await Organization.find({ 'members.user': req.user._id, status: 'active' }).select('name logo type verificationStatus members').lean();
  ok(res, {
    user: req.user.toJSON(),
    organizations: orgs.map((o) => ({
      _id: o._id, name: o.name, logo: o.logo, type: o.type, verificationStatus: o.verificationStatus,
      role: (o.members.find((m) => String(m.user) === String(req.user._id)) || {}).role,
    })),
  });
}));

// PATCH /api/users/me — update own profile
router.patch('/me', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const val = v(b);
  const u = req.user;
  if ('fullName' in b) u.fullName = val.string('fullName', { required: true, min: 2, max: 100, label: 'Full name' });
  if ('phone' in b) u.phone = val.string('phone', { max: 30, label: 'Phone', pattern: /^[0-9+()\-\s]*$/, patternMsg: 'Phone may only contain digits, spaces, +, -, ( and )' }) || '';
  if ('bio' in b) u.bio = val.string('bio', { max: 1000, label: 'Bio' }) || '';
  if ('city' in b) u.city = val.string('city', { max: 100, label: 'City' }) || '';
  if ('experience' in b) u.experience = val.string('experience', { max: 2000, label: 'Volunteer experience' }) || '';
  if ('interests' in b) u.interests = val.stringList('interests', { maxItems: 20, maxLen: 60, label: 'Interests', split: /[,\n]/ }) || [];
  if ('skills' in b) u.skills = val.stringList('skills', { maxItems: 30, maxLen: 60, label: 'Skills', split: /[,\n]/ }) || [];
  if ('emailNotifications' in b) u.emailNotifications = val.boolean('emailNotifications', { label: 'Email notifications' });
  if ('avatar' in b) {
    if (b.avatar) {
      const id = val.objectId('avatar', { label: 'Profile picture' });
      if (id && !(await assertOwnPublicImage(id, u._id))) val.fail('avatar', 'Profile picture upload not found');
      u.avatar = id;
    } else {
      u.avatar = null;
    }
  }
  val.done();
  await u.save();
  ok(res, { user: u.toJSON() });
}));

// POST /api/users/me/password — change password (invalidates other sessions)
router.post('/me/password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const val = v(req.body);
  const current = val.string('currentPassword', { required: true, max: 128, label: 'Current password' });
  const next = val.password('newPassword', { label: 'New password' });
  if (req.body.confirmPassword !== req.body.newPassword) val.fail('confirmPassword', 'Passwords do not match');
  val.done();
  const user = await User.findById(req.user._id).select('+passwordHash +tokenVersion');
  if (!(await user.checkPassword(current))) throw ApiError.badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' });
  await user.setPassword(next);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await logActivity(user, 'user.password_changed', 'User', user._id);
  ok(res, { token: signToken(user), message: 'Password updated' });
}));

// GET /api/users/me/dashboard — personalised overview
router.get('/me/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const now = new Date();

  const activeRegs = await Registration.find({ user: uid, status: { $in: ['pending', 'approved'] } })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({ path: 'initiative', populate: { path: 'host', select: User.PUBLIC_FIELDS } });

  const live = activeRegs.filter((r) => r.initiative && r.initiative.status === 'published' && r.initiative.endAt > now);
  const upcoming = live
    .sort((a, b) => a.initiative.startAt - b.initiative.startAt)
    .slice(0, 5)
    .map((r) => ({ _id: r._id, status: r.status, paymentStatus: r.paymentStatus, initiative: initiativeCard(r.initiative) }));

  const paymentAttention = live
    .filter((r) => ['unpaid', 'pending', 'rejected'].includes(r.paymentStatus))
    .map((r) => ({ _id: r._id, status: r.status, paymentStatus: r.paymentStatus, initiative: { _id: r.initiative._id, title: r.initiative.title, fee: r.initiative.payment?.fee } }));

  const [totalRegistrations, attended, hosted, unread, notifications, recentDocs] = await Promise.all([
    Registration.countDocuments({ user: uid }),
    Registration.countDocuments({ user: uid, status: 'attended' }),
    Initiative.countDocuments({ host: uid, deletedAt: null }),
    Notification.countDocuments({ user: uid, read: false }),
    Notification.find({ user: uid }).sort({ createdAt: -1 }).limit(5),
    Initiative.find({ status: 'published', deletedAt: null, startAt: { $gt: now } })
      .sort({ publishedAt: -1 })
      .limit(6)
      .populate('host', User.PUBLIC_FIELDS)
      .populate('organization', 'name logo verificationStatus type'),
  ]);

  ok(res, {
    stats: {
      upcoming: live.filter((r) => r.status === 'approved').length,
      pending: live.filter((r) => r.status === 'pending').length,
      totalRegistrations,
      attended,
      hosted,
    },
    upcoming,
    paymentAttention,
    notifications: { unread, latest: notifications },
    recentInitiatives: recentDocs.map(initiativeCard),
  });
}));

// GET /api/users/:id — public profile
router.get('/:id', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'user ID');
  const user = await User.findById(id);
  if (!user || user.accountStatus !== 'active' || user.role === 'admin') throw ApiError.notFound('User not found');
  const [hosted, attended] = await Promise.all([
    Initiative.find({ host: id, status: { $in: ['published', 'cancelled'] }, deletedAt: null })
      .sort({ startAt: -1 })
      .limit(12)
      .populate('host', User.PUBLIC_FIELDS)
      .populate('organization', 'name logo verificationStatus type'),
    Registration.countDocuments({ user: id, status: 'attended' }),
  ]);
  ok(res, { user: user.toPublic(), hosted: hosted.map(initiativeCard), stats: { attended, hosted: hosted.length } });
}));

module.exports = router;
