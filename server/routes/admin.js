'use strict';
const router = require('express').Router();
const User = require('../models/User');
const Initiative = require('../models/Initiative');
const Registration = require('../models/Registration');
const Payment = require('../models/Payment');
const MedicalVerification = require('../models/MedicalVerification');
const Organization = require('../models/Organization');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const { asyncHandler, ok, ApiError } = require('../utils/http');
const { v, assertObjectId, escapeRegex, pagination, pageMeta } = require('../utils/validate');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/common');
const { findFile, streamFile } = require('../utils/gridfs');
const { initiativeCard } = require('../utils/serialize');
const { notify } = require('../services/notify');
const { logActivity } = require('../services/activity');
const { CATEGORIES } = require('../config/constants');

// Every admin route requires an authenticated administrator (role read from DB)
router.use(requireAuth, requireAdmin);

/* ─── Overview ─── */
router.get('/stats', asyncHandler(async (req, res) => {
  const now = new Date();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [
    users, suspended, newUsers, verifiedPros, initiativesTotal, published, drafts, cancelled, completed, upcoming,
    pendingVerifications, regAgg, payAgg, orgs, emailFailed,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', accountStatus: 'suspended' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: since } }),
    User.countDocuments({ 'verification.status': 'verified' }),
    Initiative.countDocuments({ deletedAt: null }),
    Initiative.countDocuments({ deletedAt: null, status: 'published' }),
    Initiative.countDocuments({ deletedAt: null, status: 'draft' }),
    Initiative.countDocuments({ deletedAt: null, status: 'cancelled' }),
    Initiative.countDocuments({ deletedAt: null, status: 'published', endAt: { $lte: now } }),
    Initiative.countDocuments({ deletedAt: null, status: 'published', startAt: { $gt: now } }),
    MedicalVerification.countDocuments({ status: 'pending' }),
    Registration.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Organization.countDocuments({ status: 'active' }),
    Notification.countDocuments({ 'email.status': 'failed', createdAt: { $gte: since } }),
  ]);
  const registrations = Object.fromEntries(regAgg.map((r) => [r._id, r.n]));
  const payments = Object.fromEntries(payAgg.map((p) => [p._id, { count: p.n, amount: p.amount }]));
  ok(res, {
    users: { total: users, suspended, newLast30Days: newUsers, verifiedProfessionals: verifiedPros },
    initiatives: { total: initiativesTotal, published, drafts, cancelled, completed, upcoming },
    pendingVerifications,
    registrations: { total: Object.values(registrations).reduce((a, b) => a + b, 0), ...registrations },
    payments,
    organizations: orgs,
    emailFailuresLast30Days: emailFailed,
  });
}));

/* ─── Users ─── */
router.get('/users', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const val = v(req.query);
  const q = val.string('q', { max: 100 });
  const status = val.oneOf('status', ['active', 'suspended']);
  const role = val.oneOf('role', ['user', 'admin']);
  const verification = val.oneOf('verification', ['not_submitted', 'pending', 'verified', 'rejected']);
  val.done();
  const filter = {};
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ fullName: re }, { email: re }];
  }
  if (status) filter.accountStatus = status;
  if (role) filter.role = role;
  if (verification) filter['verification.status'] = verification;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  ok(res, items, pageMeta(page, limit, total));
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'user ID');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  const [registrations, hosted, activity, verifications] = await Promise.all([
    Registration.aggregate([{ $match: { user: user._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Initiative.countDocuments({ host: user._id, deletedAt: null }),
    ActivityLog.find({ actor: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    MedicalVerification.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).select('professionalType profession status createdAt reviewedAt rejectionReason').lean(),
  ]);
  ok(res, {
    user,
    registrations: Object.fromEntries(registrations.map((r) => [r._id, r.n])),
    hosted,
    activity,
    verifications,
  });
}));

router.patch('/users/:id/status', writeLimiter, asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'user ID');
  const val = v(req.body);
  const status = val.oneOf('status', ['active', 'suspended'], { required: true, label: 'Status' });
  const reason = val.string('reason', { max: 500, label: 'Reason' });
  if (status === 'suspended' && !reason) val.fail('reason', 'Give a reason for suspending this account');
  val.done();
  if (id === String(req.user._id)) throw ApiError.badRequest('You cannot change your own account status');
  const user = await User.findById(id).select('+tokenVersion');
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'admin') throw ApiError.badRequest('Administrator accounts cannot be suspended here');
  user.accountStatus = status;
  user.suspendedReason = status === 'suspended' ? reason : undefined;
  if (status === 'suspended') user.tokenVersion = (user.tokenVersion || 0) + 1; // end active sessions
  await user.save();
  await logActivity(req.user, status === 'suspended' ? 'admin.user_suspended' : 'admin.user_reactivated', 'User', user._id);
  ok(res, user);
}));

/* ─── Medical professional verification ─── */
router.get('/verifications', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const status = v(req.query).oneOf('status', ['pending', 'verified', 'rejected', 'all']) || 'pending';
  const filter = status === 'all' ? {} : { status };
  const [items, total] = await Promise.all([
    MedicalVerification.find(filter).sort({ createdAt: status === 'pending' ? 1 : -1 }).skip(skip).limit(limit)
      .populate('user', 'fullName email avatar')
      .populate('reviewedBy', 'fullName'),
    MedicalVerification.countDocuments(filter),
  ]);
  ok(res, items, pageMeta(page, limit, total));
}));

router.get('/verifications/:id', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'verification ID');
  const item = await MedicalVerification.findById(id)
    .select('+prcLicenseNumber +licenseExpiry +documents')
    .populate('user', 'fullName email phone avatar city createdAt verification')
    .populate('reviewedBy', 'fullName');
  if (!item) throw ApiError.notFound('Verification request not found');
  await logActivity(req.user, 'admin.verification_viewed', 'MedicalVerification', item._id);
  ok(res, item);
}));

router.get('/verifications/:id/documents/:fileId', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'verification ID');
  const fileId = assertObjectId(req.params.fileId, 'file ID');
  const item = await MedicalVerification.findById(id).select('+documents');
  if (!item || !item.documents.some((d) => String(d.fileId) === fileId)) throw ApiError.notFound('Document not found');
  const file = await findFile('private', fileId);
  if (!file) throw ApiError.notFound('Document file not found');
  streamFile('private', file, res);
}));

async function decideVerification(req, res, decision) {
  const id = assertObjectId(req.params.id, 'verification ID');
  let reason;
  if (decision === 'rejected') {
    const val = v(req.body);
    reason = val.string('reason', { required: true, min: 5, max: 1000, label: 'Rejection reason' });
    val.done();
  }
  const item = await MedicalVerification.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: decision, reviewedBy: req.user._id, reviewedAt: new Date(), rejectionReason: reason } },
    { new: true }
  );
  if (!item) throw ApiError.conflict('This request is no longer pending (it may have been reviewed already)');
  const user = await User.findById(item.user);
  if (user) {
    if (decision === 'verified') {
      user.verification = { status: 'verified', type: item.professionalType, profession: item.profession, verifiedAt: new Date() };
    } else if (user.verification?.status !== 'verified') {
      user.verification = { status: 'rejected', type: item.professionalType, profession: item.profession };
    }
    await user.save();
  }
  await logActivity(req.user, `admin.verification_${decision}`, 'MedicalVerification', item._id, { user: String(item.user) });
  notify(item.user, decision === 'verified'
    ? { type: 'verification_approved', title: 'You are now a verified professional', message: `Your ${item.professionalType === 'student' ? 'student' : 'professional'} verification as ${item.profession} was approved. A verified badge now appears beside your name.`, resource: { kind: 'verification', id: item._id }, link: '/profile.html' }
    : { type: 'verification_rejected', title: 'Verification not approved', message: `Your verification request was not approved.\nReason: ${reason}\nYou can submit a new request from your profile.`, resource: { kind: 'verification', id: item._id }, link: '/profile.html' });
  ok(res, item);
}

router.post('/verifications/:id/approve', writeLimiter, asyncHandler((req, res) => decideVerification(req, res, 'verified')));
router.post('/verifications/:id/reject', writeLimiter, asyncHandler((req, res) => decideVerification(req, res, 'rejected')));

// Revoke a previously granted verification (e.g. license expired)
router.post('/users/:id/revoke-verification', writeLimiter, asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'user ID');
  const val = v(req.body);
  const reason = val.string('reason', { required: true, min: 5, max: 500, label: 'Reason' });
  val.done();
  const user = await User.findById(id);
  if (!user || user.verification?.status !== 'verified') throw ApiError.badRequest('This user is not verified');
  user.verification = { status: 'not_submitted', type: null, profession: undefined };
  await user.save();
  await logActivity(req.user, 'admin.verification_revoked', 'User', user._id);
  notify(user._id, { type: 'verification_rejected', title: 'Professional verification removed', message: `An administrator removed your verified status.\nReason: ${reason}`, link: '/profile.html' });
  ok(res, user);
}));

/* ─── Initiatives monitoring ─── */
router.get('/initiatives', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const val = v(req.query);
  const q = val.string('q', { max: 100 });
  const status = val.oneOf('status', ['draft', 'published', 'cancelled', 'all']) || 'published';
  const category = val.oneOf('category', Object.keys(CATEGORIES));
  const includeDeleted = val.boolean('includeDeleted');
  val.done();
  const filter = {};
  if (!includeDeleted) filter.deletedAt = null;
  if (status !== 'all') filter.status = status;
  if (category) filter.category = category;
  if (q) filter.title = new RegExp(escapeRegex(q), 'i');
  const [items, total] = await Promise.all([
    Initiative.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('host', `${User.PUBLIC_FIELDS} email`).populate('organization', 'name logo verificationStatus type'),
    Initiative.countDocuments(filter),
  ]);
  ok(res, items.map((d) => ({ ...initiativeCard(d), hostEmail: d.host?.email, deletedAt: d.deletedAt })), pageMeta(page, limit, total));
}));

/* ─── Organizations ─── */
router.get('/organizations', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const val = v(req.query);
  const q = val.string('q', { max: 100 });
  const status = val.oneOf('status', ['active', 'deactivated', 'all']) || 'all';
  val.done();
  const filter = {};
  if (status !== 'all') filter.status = status;
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  const [items, total] = await Promise.all([
    Organization.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'fullName email'),
    Organization.countDocuments(filter),
  ]);
  ok(res, items.map((o) => ({ ...o.toJSON(), memberCount: o.members.length, members: undefined })), pageMeta(page, limit, total));
}));

router.patch('/organizations/:id', writeLimiter, asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'organization ID');
  const val = v(req.body);
  const status = val.oneOf('status', ['active', 'deactivated'], { label: 'Status' });
  const verificationStatus = val.oneOf('verificationStatus', ['unverified', 'verified'], { label: 'Verification' });
  const reason = val.string('reason', { max: 500, label: 'Reason' });
  if (status === 'deactivated' && !reason) val.fail('reason', 'Give a reason for deactivating this organization');
  val.done();
  const org = await Organization.findById(id);
  if (!org) throw ApiError.notFound('Organization not found');
  if (status) {
    org.status = status;
    org.deactivatedReason = status === 'deactivated' ? reason : undefined;
  }
  if (verificationStatus) org.verificationStatus = verificationStatus;
  await org.save(); // initiatives keep their organization reference (history preserved)
  await logActivity(req.user, 'admin.organization_updated', 'Organization', org._id, { status, verificationStatus });
  const owners = org.members.filter((m) => ['owner', 'admin'].includes(m.role)).map((m) => m.user);
  if (status || verificationStatus) {
    notify(owners, {
      type: 'organization',
      title: `${org.name}: ${status === 'deactivated' ? 'deactivated' : verificationStatus === 'verified' ? 'verified' : 'status updated'}`,
      message: status === 'deactivated' ? `An administrator deactivated ${org.name}. Reason: ${reason}` : `An administrator updated the status of ${org.name}.`,
      resource: { kind: 'organization', id: org._id },
      link: `/organization.html?id=${org._id}`,
    });
  }
  ok(res, org);
}));

/* ─── Platform monitoring ─── */
router.get('/activity', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 30, maxLimit: 100 });
  const val = v(req.query);
  const action = val.string('action', { max: 80 });
  const actor = val.objectId('actor');
  val.done();
  const filter = {};
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (actor) filter.actor = actor;
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'fullName email role'),
    ActivityLog.countDocuments(filter),
  ]);
  ok(res, items, pageMeta(page, limit, total));
}));

router.get('/payments', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const status = v(req.query).oneOf('status', ['pending', 'confirmed', 'rejected', 'all']) || 'all';
  const filter = status === 'all' ? {} : { status };
  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('amount provider status createdAt reviewedAt initiative user aiAnalysis.flags')
      .populate('user', 'fullName').populate('initiative', 'title'),
    Payment.countDocuments(filter),
  ]);
  ok(res, items, pageMeta(page, limit, total));
}));

module.exports = router;
