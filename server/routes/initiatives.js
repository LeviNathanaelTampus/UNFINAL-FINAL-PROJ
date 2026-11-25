'use strict';
const router = require('express').Router();
const Initiative = require('../models/Initiative');
const Registration = require('../models/Registration');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v, assertObjectId, escapeRegex, pagination, pageMeta } = require('../utils/validate');
const { requireAuth, optionalAuth, isAdmin } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/common');
const { assertOwnPublicImage } = require('../utils/gridfs');
const { initiativeOut, initiativeCard, publicUserRef } = require('../utils/serialize');
const {
  parseInitiativeInput, publishProblems, assertSchedule, assertPublishable, assertCanHostCategory, canHostCategory,
} = require('../services/initiativeRules');
const { isHostOf, loadManageableInitiative, assertCanUseOrganization } = require('../services/access');
const { notify } = require('../services/notify');
const { logActivity } = require('../services/activity');
const { CATEGORIES } = require('../config/constants');

const HOST_FIELDS = User.PUBLIC_FIELDS;
const ORG_FIELDS = 'name logo verificationStatus type';

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '');

async function activeRegistrantIds(initiativeId) {
  const regs = await Registration.find({ initiative: initiativeId, status: { $in: ['pending', 'approved'] } }).select('user').lean();
  return regs.map((r) => r.user);
}

/** Verify attached images belong to the uploader. */
async function checkImages(input, userId) {
  if (input.coverImage && !(await assertOwnPublicImage(input.coverImage, userId))) {
    throw ApiError.badRequest('Cover image upload not found', { coverImage: 'Upload the image again' });
  }
  if (input.payment?.qrImage && !(await assertOwnPublicImage(input.payment.qrImage, userId))) {
    throw ApiError.badRequest('QR code image upload not found', { 'payment.qrImage': 'Upload the QR image again' });
  }
}

function applyInput(doc, input) {
  for (const [k, val] of Object.entries(input)) {
    if (k === 'geo') {
      doc.geo = val || undefined;
    } else {
      doc.set(k, val);
    }
  }
}

/* ───────────────────────── Explore ───────────────────────── */

// GET /api/initiatives — public discovery with filters
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const q = req.query;
  const isMap = q.map === '1' || q.map === 'true';
  const { page, limit, skip } = pagination(q, { defaultLimit: isMap ? 100 : 12, maxLimit: isMap ? 200 : 50 });
  const val = v(q);
  const search = val.string('q', { max: 100, label: 'Search' });
  const category = val.oneOf('category', Object.keys(CATEGORIES), { label: 'Category' });
  const from = val.date('from', { label: 'From date' });
  const to = val.date('to', { label: 'To date' });
  const city = val.string('location', { max: 100, label: 'Location' });
  const price = val.oneOf('price', ['free', 'paid'], { label: 'Price' });
  const availability = val.oneOf('availability', ['open', 'all'], { label: 'Availability' });
  const includePast = val.boolean('includePast', { label: 'Include past' });
  const lat = val.number('lat', { min: -90, max: 90, label: 'Latitude' });
  const lng = val.number('lng', { min: -180, max: 180, label: 'Longitude' });
  const radiusKm = val.number('radiusKm', { min: 1, max: 500, label: 'Radius' });
  const hostId = val.objectId('host', { label: 'Host' });
  const orgId = val.objectId('organization', { label: 'Organization' });
  const sort = val.oneOf('sort', ['soonest', 'newest'], { label: 'Sort' }) || 'soonest';
  val.done();

  const now = new Date();
  const filter = { status: 'published', deletedAt: null };
  if (!includePast) filter.endAt = { $gt: now };
  if (category) filter.category = category;
  if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = from;
    if (to) filter.startAt.$lte = to;
  }
  if (price === 'free') filter['payment.isPaid'] = { $ne: true };
  if (price === 'paid') filter['payment.isPaid'] = true;
  if (hostId) filter.host = hostId;
  if (orgId) filter.organization = orgId;
  if (city) {
    const re = new RegExp(escapeRegex(city), 'i');
    filter.$or = [{ 'location.city': re }, { 'location.province': re }, { 'location.address': re }, { 'location.name': re }];
  }
  if (availability === 'open') {
    filter.startAt = { ...(filter.startAt || {}), $gt: now };
    filter.$expr = { $lt: ['$slotsTaken', '$capacity'] };
    filter.$and = [{ $or: [{ registrationDeadline: null }, { registrationDeadline: { $gte: now } }] }];
  }
  if (lat !== undefined && lng !== undefined) {
    filter.geo = { $geoWithin: { $centerSphere: [[lng, lat], (radiusKm || 25) / 6378.1] } };
  }
  if (search) filter.$text = { $search: search };

  const sortSpec = sort === 'newest' ? { publishedAt: -1 } : { startAt: 1 };
  const [docs, total] = await Promise.all([
    Initiative.find(filter).sort(sortSpec).skip(skip).limit(limit).populate('host', HOST_FIELDS).populate('organization', ORG_FIELDS),
    Initiative.countDocuments(filter),
  ]);

  // Mark which ones the viewer already registered for
  let mine = new Map();
  if (req.user && docs.length) {
    const regs = await Registration.find({ user: req.user._id, initiative: { $in: docs.map((d) => d._id) }, isActive: true }).select('initiative status').lean();
    mine = new Map(regs.map((r) => [String(r.initiative), r.status]));
  }
  const items = docs.map((d) => ({ ...initiativeCard(d), myRegistrationStatus: mine.get(String(d._id)) || null }));
  ok(res, items, pageMeta(page, limit, total));
}));

/* ───────────────────────── Host views ───────────────────────── */

// GET /api/initiatives/mine?tab=draft|upcoming|ongoing|completed|cancelled|all
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const tab = v(req.query).oneOf('tab', ['all', 'draft', 'upcoming', 'ongoing', 'completed', 'cancelled']) || 'all';
  const now = new Date();
  const filter = { host: req.user._id, deletedAt: null };
  if (tab === 'draft') filter.status = 'draft';
  if (tab === 'cancelled') filter.status = 'cancelled';
  if (tab === 'upcoming') Object.assign(filter, { status: 'published', startAt: { $gt: now } });
  if (tab === 'ongoing') Object.assign(filter, { status: 'published', startAt: { $lte: now }, endAt: { $gt: now } });
  if (tab === 'completed') Object.assign(filter, { status: 'published', endAt: { $lte: now } });

  const [docs, total] = await Promise.all([
    Initiative.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('host', HOST_FIELDS).populate('organization', ORG_FIELDS),
    Initiative.countDocuments(filter),
  ]);

  const ids = docs.map((d) => d._id);
  const [regCounts, payCounts] = await Promise.all([
    Registration.aggregate([{ $match: { initiative: { $in: ids } } }, { $group: { _id: { i: '$initiative', s: '$status' }, n: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { initiative: { $in: ids }, status: 'pending' } }, { $group: { _id: '$initiative', n: { $sum: 1 } } }]),
  ]);
  const counts = {};
  for (const r of regCounts) {
    const k = String(r._id.i);
    counts[k] = counts[k] || {};
    counts[k][r._id.s] = r.n;
  }
  const pend = new Map(payCounts.map((p) => [String(p._id), p.n]));

  ok(res, docs.map((d) => ({
    ...initiativeCard(d),
    counts: { ...(counts[String(d._id)] || {}), pendingPayments: pend.get(String(d._id)) || 0 },
  })), pageMeta(page, limit, total));
}));

// GET /api/initiatives/mine/stats — host dashboard summary
router.get('/mine/stats', requireAuth, asyncHandler(async (req, res) => {
  const now = new Date();
  const hostId = req.user._id;
  const all = await Initiative.find({ host: hostId, deletedAt: null }).select('status startAt endAt').lean();
  const ids = all.map((i) => i._id);
  const byStatus = { draft: 0, published: 0, upcoming: 0, ongoing: 0, completed: 0, cancelled: 0 };
  for (const i of all) {
    if (i.status === 'draft') byStatus.draft++;
    else if (i.status === 'cancelled') byStatus.cancelled++;
    else {
      byStatus.published++;
      if (i.endAt && i.endAt <= now) byStatus.completed++;
      else if (i.startAt && i.startAt <= now) byStatus.ongoing++;
      else byStatus.upcoming++;
    }
  }
  const [regAgg, pendingPayments] = await Promise.all([
    Registration.aggregate([{ $match: { initiative: { $in: ids } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Payment.countDocuments({ initiative: { $in: ids }, status: 'pending' }),
  ]);
  const reg = Object.fromEntries(regAgg.map((r) => [r._id, r.n]));
  const totalRegistrations = Object.values(reg).reduce((a, b) => a + b, 0);
  const attended = reg.attended || 0;
  const absent = reg.absent || 0;
  ok(res, {
    initiatives: { total: all.length, ...byStatus },
    registrations: {
      total: totalRegistrations,
      pending: reg.pending || 0,
      approved: (reg.approved || 0) + attended + absent,
      declined: reg.declined || 0,
      cancelled: reg.cancelled || 0,
    },
    pendingPayments,
    attendance: { attended, absent, rate: attended + absent ? Math.round((attended / (attended + absent)) * 100) : null },
    canHost: Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, canHostCategory(req.user, c)])),
  });
}));

/* ───────────────────────── Create / edit ───────────────────────── */

// POST /api/initiatives — create a draft (or publish immediately with { publish: true })
router.post('/', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const idemKey = String(req.get('Idempotency-Key') || '').slice(0, 64) || null;
  if (idemKey) {
    const existing = await Initiative.findOne({ host: req.user._id, clientRequestId: idemKey }).populate('host', HOST_FIELDS).populate('organization', ORG_FIELDS);
    if (existing) return ok(res, initiativeOut(existing, { isHost: true }));
  }

  const input = parseInitiativeInput(req.body, { requireTitle: true });
  await checkImages(input, req.user._id);
  if (input.organization) await assertCanUseOrganization(req.user, input.organization);

  const doc = new Initiative({ host: req.user._id, status: 'draft', clientRequestId: idemKey || undefined });
  applyInput(doc, input);
  assertSchedule(doc);

  const publish = req.body.publish === true || req.body.publish === 'true';
  if (publish) {
    assertCanHostCategory(req.user, doc.category);
    assertPublishable(doc);
    doc.status = 'published';
    doc.publishedAt = new Date();
  }

  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000 && idemKey) {
      const existing = await Initiative.findOne({ host: req.user._id, clientRequestId: idemKey });
      if (existing) return ok(res, initiativeOut(existing, { isHost: true }));
    }
    throw err;
  }
  await doc.populate([{ path: 'host', select: HOST_FIELDS }, { path: 'organization', select: ORG_FIELDS }]);
  await logActivity(req.user, publish ? 'initiative.published' : 'initiative.draft_created', 'Initiative', doc._id, { title: doc.title });
  created(res, initiativeOut(doc, { isHost: true }));
}));

// GET /api/initiatives/:id — details (+ viewer context)
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'initiative ID');
  const doc = await Initiative.findById(id).populate('host', HOST_FIELDS).populate('organization', ORG_FIELDS);
  const admin = isAdmin(req.user);
  const host = isHostOf(req.user, doc);
  if (!doc || (doc.deletedAt && !admin)) throw ApiError.notFound('Initiative not found');
  if (doc.status === 'draft' && !host && !admin) throw ApiError.notFound('Initiative not found');

  let myRegistration = null;
  if (req.user) {
    myRegistration = await Registration.findOne({ user: req.user._id, initiative: id }).sort({ createdAt: -1 }).lean();
    if (myRegistration) {
      const pay = await Payment.findOne({ registration: myRegistration._id }).sort({ createdAt: -1 }).select('status amount provider referenceNumber rejectionReason createdAt').lean();
      myRegistration.latestPayment = pay || null;
      delete myRegistration.history;
      delete myRegistration.isActive;
    }
  }
  const isParticipant = Boolean(myRegistration && ['pending', 'approved', 'attended', 'absent'].includes(myRegistration.status));
  const out = initiativeOut(doc, { isHost: host, isAdmin: admin, isParticipant });
  out.viewer = {
    isHost: host,
    isAdmin: admin,
    myRegistration,
    canHostCategory: req.user && doc.category ? canHostCategory(req.user, doc.category) : null,
  };
  if (host || admin) out.publishProblems = doc.status === 'draft' ? publishProblems(doc) : {};
  ok(res, out);
}));

// PATCH /api/initiatives/:id — edit (host/admin)
router.patch('/:id', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  const display = doc.displayStatus;
  if (['cancelled', 'completed'].includes(display)) throw ApiError.badRequest(`This initiative is ${display} and can no longer be edited`);

  const input = parseInitiativeInput(req.body, { requireTitle: false });
  if ('title' in req.body && !input.title) throw ApiError.badRequest('Title is required', { title: 'Title is required' });
  await checkImages(input, doc.host);
  if ('organization' in input && String(input.organization || '') !== String(doc.organization || '')) {
    await assertCanUseOrganization(req.user, input.organization);
  }

  const isPublished = doc.status === 'published';
  const hasParticipants = doc.slotsTaken > 0;
  const changed = (path, newVal) => {
    const cur = doc.get(path);
    const a = cur instanceof Date ? cur.getTime() : cur == null ? null : String(cur);
    const b = newVal instanceof Date ? newVal.getTime() : newVal == null ? null : String(newVal);
    return a !== b;
  };

  if (isPublished) {
    if (display === 'ongoing') {
      const coords = (g) => (g?.coordinates?.length === 2 ? g.coordinates.join(',') : null);
      const tried = [
        ['startAt', 'startAt'], ['endAt', 'endAt'], ['registrationDeadline', 'registrationDeadline'],
        ['capacity', 'capacity'], ['category', 'category'],
      ].some(([k, p]) => k in input && changed(p, input[k]))
        || (input.payment && (Boolean(input.payment.isPaid) !== Boolean(doc.payment?.isPaid) || (doc.payment?.isPaid && input.payment.fee !== doc.payment.fee)))
        || (input.location && (input.location.name !== (doc.location?.name || '') || input.location.address !== (doc.location?.address || '')))
        || ('geo' in input && coords(input.geo) !== coords(doc.geo));
      if (tried) throw ApiError.badRequest('This initiative is already in progress. Schedule, location, capacity, category and payment settings can no longer be changed.');
    }
    if (hasParticipants) {
      if ('category' in input && changed('category', input.category)) throw ApiError.badRequest('Category cannot be changed after volunteers have registered');
      if (input.payment) {
        if (Boolean(input.payment.isPaid) !== Boolean(doc.payment?.isPaid)) throw ApiError.badRequest('You cannot switch between free and paid after volunteers have registered');
        if (doc.payment?.isPaid && input.payment.fee !== doc.payment.fee) throw ApiError.badRequest('The registration fee cannot be changed after volunteers have registered');
      }
    }
    if (input.capacity != null && input.capacity < doc.slotsTaken) {
      throw ApiError.badRequest(`Capacity cannot be lower than the ${doc.slotsTaken} slots already taken`, { capacity: `Must be at least ${doc.slotsTaken}` });
    }
  }

  const scheduleChanged = isPublished && (['startAt', 'endAt'].some((k) => k in input && changed(k, input[k])));
  const locationChanged = isPublished && input.location && (input.location.name !== doc.location?.name || input.location.address !== doc.location?.address);
  const before = { startAt: doc.startAt, endAt: doc.endAt, location: doc.location?.name };
  const startChanged = 'startAt' in input && changed('startAt', input.startAt);

  applyInput(doc, input);
  assertSchedule(doc, { startChanged });

  if (isPublished) {
    assertCanHostCategory(req.user.role === 'admin' ? req.user : await User.findById(doc.host), doc.category);
    const problems = publishProblems(doc);
    if (!scheduleChanged) delete problems.startAt; // existing past start is fine if not being changed
    if (Object.keys(problems).length) throw ApiError.badRequest(Object.values(problems)[0], problems);
  }

  await doc.save();
  await doc.populate([{ path: 'host', select: HOST_FIELDS }, { path: 'organization', select: ORG_FIELDS }]);
  await logActivity(req.user, 'initiative.updated', 'Initiative', doc._id, { scheduleChanged, locationChanged });

  if (scheduleChanged || locationChanged) {
    const parts = [];
    if (scheduleChanged) parts.push(`Schedule: ${fmtDate(doc.startAt)} – ${fmtDate(doc.endAt)} (was ${fmtDate(before.startAt)})`);
    if (locationChanged) parts.push(`Location: ${doc.location.name}, ${doc.location.address} (was ${before.location || 'not set'})`);
    notify(await activeRegistrantIds(doc._id), {
      type: 'initiative_updated',
      title: `Important update: ${doc.title}`,
      message: `The host changed important details of an initiative you registered for.\n${parts.join('\n')}`,
      resource: { kind: 'initiative', id: doc._id },
      link: `/initiative.html?id=${doc._id}`,
    });
  }
  ok(res, initiativeOut(doc, { isHost: true }));
}));

// POST /api/initiatives/:id/publish
router.post('/:id/publish', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  if (doc.status !== 'draft') throw ApiError.badRequest('Only drafts can be published');
  const hostUser = isHostOf(req.user, doc) ? req.user : await User.findById(doc.host);
  assertCanHostCategory(hostUser, doc.category);
  assertPublishable(doc);
  doc.status = 'published';
  doc.publishedAt = new Date();
  await doc.save();
  await doc.populate([{ path: 'host', select: HOST_FIELDS }, { path: 'organization', select: ORG_FIELDS }]);
  await logActivity(req.user, 'initiative.published', 'Initiative', doc._id, { title: doc.title });
  ok(res, initiativeOut(doc, { isHost: true }));
}));

// POST /api/initiatives/:id/cancel { reason }
router.post('/:id/cancel', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  const reason = v(req.body).string('reason', { max: 1000, label: 'Reason' }) || '';
  if (doc.status === 'cancelled') throw ApiError.badRequest('This initiative is already cancelled');
  if (doc.status === 'draft') throw ApiError.badRequest('Drafts cannot be cancelled — delete the draft instead');
  if (doc.displayStatus === 'completed') throw ApiError.badRequest('Completed initiatives cannot be cancelled');

  doc.status = 'cancelled';
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user._id;
  doc.cancellationReason = reason;
  await doc.save();

  // Preserve registration records: mark active ones as cancelled (with history), keep payments untouched.
  const regs = await Registration.find({ initiative: doc._id, status: { $in: ['pending', 'approved'] } });
  const recipients = [];
  for (const r of regs) {
    r.history.push({ from: r.status, to: 'cancelled', by: req.user._id, note: 'Initiative cancelled' });
    r.status = 'cancelled';
    r.cancelledAt = new Date();
    r.cancelledBy = req.user._id;
    r.cancellationReason = 'Initiative cancelled by host';
    await r.save();
    recipients.push(r.user);
  }
  const byAdmin = !isHostOf(req.user, doc);
  await logActivity(req.user, byAdmin ? 'initiative.cancelled_by_admin' : 'initiative.cancelled', 'Initiative', doc._id, { affected: recipients.length });

  const confirmedPayers = await Payment.distinct('user', { initiative: doc._id, status: 'confirmed' });
  const payerSet = new Set(confirmedPayers.map(String));
  const base = `"${doc.title}" scheduled for ${fmtDate(doc.startAt)} has been cancelled${byAdmin ? ' by the platform administrators' : ' by the host'}.${reason ? `\nReason: ${reason}` : ''}`;
  const payers = recipients.filter((u) => payerSet.has(String(u)));
  const others = recipients.filter((u) => !payerSet.has(String(u)));
  const common = { type: 'initiative_cancelled', title: `Cancelled: ${doc.title}`, resource: { kind: 'initiative', id: doc._id }, link: `/initiative.html?id=${doc._id}` };
  notify(others, { ...common, message: base });
  notify(payers, { ...common, message: `${base}\nYour payment record is preserved. Please coordinate with the host regarding a refund.` });
  if (byAdmin) {
    notify(doc.host, { ...common, title: `Your initiative was cancelled by an administrator`, message: base });
  }

  await doc.populate([{ path: 'host', select: HOST_FIELDS }, { path: 'organization', select: ORG_FIELDS }]);
  ok(res, initiativeOut(doc, { isHost: true }));
}));

// DELETE /api/initiatives/:id — soft-delete a draft
router.delete('/:id', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  if (doc.status !== 'draft') throw ApiError.badRequest('Only drafts can be deleted. Published initiatives can be cancelled instead, which preserves their history.');
  doc.deletedAt = new Date();
  await doc.save();
  await logActivity(req.user, 'initiative.draft_deleted', 'Initiative', doc._id);
  ok(res, { deleted: true });
}));

/* ───────────────────────── Participants & announcements ───────────────────────── */

// GET /api/initiatives/:id/participants?status=
router.get('/:id/participants', requireAuth, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const status = v(req.query).oneOf('status', ['all', 'pending', 'approved', 'declined', 'cancelled', 'attended', 'absent', 'roster']) || 'all';
  const filter = { initiative: doc._id };
  if (status === 'roster') filter.status = { $in: ['approved', 'attended', 'absent'] };
  else if (status !== 'all') filter.status = status;

  const [regs, total, counts] = await Promise.all([
    Registration.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'fullName email phone avatar skills interests city verification.status verification.type verification.profession')
      .populate('attendance.markedBy', 'fullName'),
    Registration.countDocuments(filter),
    Registration.aggregate([{ $match: { initiative: doc._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  const payments = await Payment.find({ registration: { $in: regs.map((r) => r._id) } })
    .sort({ createdAt: -1 })
    .select('registration status amount provider referenceNumber paidAt receipt createdAt rejectionReason aiAnalysis reviewedAt')
    .lean();
  const latestPay = new Map();
  const payCount = new Map();
  for (const p of payments) {
    const k = String(p.registration);
    if (!latestPay.has(k)) latestPay.set(k, p);
    payCount.set(k, (payCount.get(k) || 0) + 1);
  }

  const items = regs.map((r) => {
    const u = r.user || {};
    return {
      _id: r._id,
      status: r.status,
      paymentStatus: r.paymentStatus,
      note: r.note,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      declineReason: r.declineReason,
      cancelledAt: r.cancelledAt,
      cancellationReason: r.cancellationReason,
      attendance: r.attendance?.markedAt ? { markedAt: r.attendance.markedAt, markedBy: r.attendance.markedBy?.fullName || null } : null,
      user: {
        ...publicUserRef(u),
        email: u.email,
        phone: u.phone || '',
        skills: u.skills || [],
        city: u.city || '',
      },
      latestPayment: latestPay.get(String(r._id)) || null,
      paymentSubmissions: payCount.get(String(r._id)) || 0,
    };
  });

  ok(res, {
    initiative: { _id: doc._id, title: doc.title, capacity: doc.capacity, slotsTaken: doc.slotsTaken, slotsAvailable: doc.slotsAvailable, displayStatus: doc.displayStatus, startAt: doc.startAt, endAt: doc.endAt, isPaid: Boolean(doc.payment?.isPaid), fee: doc.payment?.fee, requiresApproval: doc.requiresApproval },
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    items,
  }, pageMeta(page, limit, total));
}));

// POST /api/initiatives/:id/announcements { title, message }
router.post('/:id/announcements', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const doc = await loadManageableInitiative(req, req.params.id);
  if (doc.status !== 'published') throw ApiError.badRequest('Announcements can only be sent for published initiatives');
  const val = v(req.body);
  const title = val.string('title', { required: true, min: 3, max: 150, label: 'Title' });
  const message = val.string('message', { required: true, min: 5, max: 3000, label: 'Message' });
  const audience = val.oneOf('audience', ['approved', 'all'], { label: 'Audience' }) || 'all';
  val.done();

  doc.announcements.push({ title, message, author: req.user._id });
  await doc.save();
  const statuses = audience === 'approved' ? ['approved', 'attended', 'absent'] : ['pending', 'approved', 'attended', 'absent'];
  const regs = await Registration.find({ initiative: doc._id, status: { $in: statuses } }).select('user').lean();
  notify(regs.map((r) => r.user), {
    type: 'announcement',
    title: `${doc.title}: ${title}`,
    message,
    resource: { kind: 'initiative', id: doc._id },
    link: `/initiative.html?id=${doc._id}`,
  });
  await logActivity(req.user, 'initiative.announcement', 'Initiative', doc._id, { recipients: regs.length });
  created(res, { announcement: doc.announcements[doc.announcements.length - 1], recipients: regs.length });
}));

module.exports = router;
