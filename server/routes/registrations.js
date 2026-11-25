'use strict';
const router = require('express').Router();
const Registration = require('../models/Registration');
const Initiative = require('../models/Initiative');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v, assertObjectId, pagination, pageMeta } = require('../utils/validate');
const { requireAuth, isAdmin } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/common');
const { initiativeCard } = require('../utils/serialize');
const { isHostOf } = require('../services/access');
const { transition, reserveSlot, releaseSlot } = require('../services/registrationFlow');
const { notify } = require('../services/notify');
const { logActivity } = require('../services/activity');

const link = (initiativeId) => `/initiative.html?id=${initiativeId}`;

async function loadRegistration(id) {
  const rid = assertObjectId(id, 'registration ID');
  const reg = await Registration.findById(rid).populate('initiative');
  if (!reg || !reg.initiative) throw ApiError.notFound('Registration not found');
  return reg;
}

function assertHostOrAdmin(req, reg) {
  if (!isHostOf(req.user, reg.initiative) && !isAdmin(req.user)) throw ApiError.forbidden('Only the initiative host can manage this registration');
}

// POST /api/registrations { initiativeId, note }
router.post('/', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const val = v(req.body);
  const initiativeId = val.objectId('initiativeId', { required: true, label: 'Initiative' });
  const note = val.string('note', { max: 500, label: 'Message to host' });
  val.done();

  const initiative = await Initiative.findById(initiativeId);
  if (!initiative || initiative.deletedAt || initiative.status === 'draft') throw ApiError.notFound('Initiative not found');
  if (isHostOf(req.user, initiative)) throw ApiError.badRequest('You are the host of this initiative');
  if (req.user.role === 'admin') throw ApiError.badRequest('Administrator accounts cannot register as volunteers');

  const display = initiative.displayStatus;
  const reasons = {
    cancelled: 'This initiative has been cancelled',
    completed: 'This initiative has already ended',
    ongoing: 'This initiative has already started',
    closed: 'Registration for this initiative has closed',
    full: 'This initiative is full',
  };
  if (reasons[display]) throw ApiError.badRequest(reasons[display]);

  const existing = await Registration.findOne({ user: req.user._id, initiative: initiativeId, isActive: true });
  if (existing) throw ApiError.conflict('You are already registered for this initiative', { registrationId: String(existing._id) });

  const reserved = await reserveSlot(initiativeId);
  if (!reserved) throw ApiError.conflict('Sorry, the last slot was just taken. This initiative is now full.');

  const isPaid = Boolean(initiative.payment?.isPaid);
  const status = initiative.requiresApproval ? 'pending' : 'approved';
  let reg;
  try {
    reg = await Registration.create({
      user: req.user._id,
      initiative: initiativeId,
      status,
      paymentStatus: isPaid ? 'unpaid' : 'not_required',
      note,
      history: [{ from: null, to: status, by: req.user._id, note: 'Registered' }],
      ...(status === 'approved' ? { decidedAt: new Date() } : {}),
    });
  } catch (err) {
    await releaseSlot(initiativeId);
    if (err.code === 11000) throw ApiError.conflict('You are already registered for this initiative');
    throw err;
  }

  await logActivity(req.user, 'registration.created', 'Registration', reg._id, { initiative: String(initiativeId), status });

  const payMsg = isPaid ? `\nThis initiative has a registration fee of ₱${initiative.payment.fee}. Please submit your payment proof from the initiative page.` : '';
  notify(req.user._id, {
    type: 'registration_submitted',
    title: status === 'approved' ? `You're registered: ${initiative.title}` : `Registration received: ${initiative.title}`,
    message: (status === 'approved'
      ? 'Your slot is confirmed. See the initiative page for the schedule, location and preparation checklist.'
      : 'Your application was sent to the host. You will be notified once it is approved or declined.') + payMsg,
    resource: { kind: 'registration', id: reg._id },
    link: link(initiativeId),
  });
  notify(initiative.host, {
    type: 'new_registration',
    title: `New ${status === 'pending' ? 'application' : 'registration'}: ${initiative.title}`,
    message: `${req.user.fullName} ${status === 'pending' ? 'applied to volunteer and is waiting for your approval' : 'registered as a volunteer'}. ${reserved.slotsTaken}/${reserved.capacity} slots taken.`,
    resource: { kind: 'initiative', id: initiative._id },
    link: `/manage.html?id=${initiative._id}`,
    email: false,
  });

  created(res, reg);
}));

// GET /api/registrations/me?scope=upcoming|past|all&status=
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const val = v(req.query);
  const scope = val.oneOf('scope', ['upcoming', 'past', 'all'], { label: 'Scope' }) || 'all';
  const status = val.oneOf('status', ['pending', 'approved', 'declined', 'cancelled', 'attended', 'absent'], { label: 'Status' });
  val.done();

  const now = new Date();
  const match = { user: req.user._id };
  if (status) match.status = status;

  const pipeline = [
    { $match: match },
    { $lookup: { from: 'initiatives', localField: 'initiative', foreignField: '_id', as: 'init' } },
    { $unwind: '$init' },
  ];
  if (scope === 'upcoming') pipeline.push({ $match: { 'init.endAt': { $gt: now }, 'init.status': 'published' } });
  if (scope === 'past') pipeline.push({ $match: { $or: [{ 'init.endAt': { $lte: now } }, { 'init.status': 'cancelled' }] } });
  pipeline.push({ $sort: scope === 'upcoming' ? { 'init.startAt': 1 } : { 'init.startAt': -1 } });
  pipeline.push({ $facet: { items: [{ $skip: skip }, { $limit: limit }, { $project: { _id: 1 } }], total: [{ $count: 'n' }] } });

  const [agg] = await Registration.aggregate(pipeline);
  const ids = agg.items.map((x) => x._id);
  const regs = await Registration.find({ _id: { $in: ids } })
    .populate({ path: 'initiative', populate: [{ path: 'host', select: User.PUBLIC_FIELDS }, { path: 'organization', select: 'name logo verificationStatus type' }] });
  const order = new Map(ids.map((id, i) => [String(id), i]));
  regs.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

  ok(res, regs.map((r) => ({
    _id: r._id,
    status: r.status,
    paymentStatus: r.paymentStatus,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    declineReason: r.declineReason,
    cancelledAt: r.cancelledAt,
    cancellationReason: r.cancellationReason,
    attendanceMarkedAt: r.attendance?.markedAt || null,
    initiative: r.initiative ? initiativeCard(r.initiative) : null,
  })), pageMeta(page, limit, agg.total[0]?.n || 0));
}));

// GET /api/registrations/:id
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const reg = await loadRegistration(req.params.id);
  const own = String(reg.user) === String(req.user._id);
  if (!own && !isHostOf(req.user, reg.initiative) && !isAdmin(req.user)) throw ApiError.forbidden();
  const payments = await Payment.find({ registration: reg._id }).sort({ createdAt: -1 }).select('-aiAnalysis').lean();
  const out = reg.toJSON();
  out.initiative = initiativeCard(reg.initiative);
  out.payments = payments.map(({ referenceKey, referenceLocked, ...p }) => p);
  ok(res, out);
}));

// POST /api/registrations/:id/cancel { reason } — volunteer cancels own registration
router.post('/:id/cancel', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const reg = await loadRegistration(req.params.id);
  if (String(reg.user) !== String(req.user._id)) throw ApiError.forbidden('You can only cancel your own registrations');
  if (reg.initiative.startAt && new Date() >= reg.initiative.startAt) throw ApiError.badRequest('This initiative has already started; registrations can no longer be cancelled. Please contact the host.');
  const reason = v(req.body).string('reason', { max: 500, label: 'Reason' }) || '';

  const updated = await transition(reg, 'cancelled', req.user, {
    role: 'volunteer',
    note: reason || 'Cancelled by volunteer',
    set: { cancelledAt: new Date(), cancelledBy: req.user._id, cancellationReason: reason },
  });
  await logActivity(req.user, 'registration.cancelled', 'Registration', reg._id);
  notify(req.user._id, {
    type: 'registration_cancelled',
    title: `Registration cancelled: ${reg.initiative.title}`,
    message: 'Your registration was cancelled. Your history is kept, and you can register again while slots are available.',
    resource: { kind: 'registration', id: reg._id },
    link: link(reg.initiative._id),
    email: false,
  });
  notify(reg.initiative.host, {
    type: 'registration_cancelled',
    title: `Volunteer cancelled: ${reg.initiative.title}`,
    message: `${req.user.fullName} cancelled their registration.${reason ? ` Reason: ${reason}` : ''}${reg.paymentStatus === 'confirmed' ? '\nThis volunteer had a confirmed payment — coordinate any refund directly.' : ''}`,
    resource: { kind: 'initiative', id: reg.initiative._id },
    link: `/manage.html?id=${reg.initiative._id}`,
    email: false,
  });
  ok(res, updated);
}));

// POST /api/registrations/:id/approve — host
router.post('/:id/approve', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const reg = await loadRegistration(req.params.id);
  assertHostOrAdmin(req, reg);
  if (['cancelled', 'completed'].includes(reg.initiative.displayStatus)) throw ApiError.badRequest(`This initiative is ${reg.initiative.displayStatus}`);
  const updated = await transition(reg, 'approved', req.user, {
    role: isAdmin(req.user) ? 'admin' : 'host',
    set: { decidedAt: new Date(), decidedBy: req.user._id },
  });
  await logActivity(req.user, 'registration.approved', 'Registration', reg._id);
  notify(reg.user, {
    type: 'registration_approved',
    title: `Approved: ${reg.initiative.title}`,
    message: `Your application was approved by the host. See you there!${reg.paymentStatus === 'unpaid' ? `\nReminder: please submit your payment of ₱${reg.initiative.payment?.fee} from the initiative page.` : ''}`,
    resource: { kind: 'registration', id: reg._id },
    link: link(reg.initiative._id),
  });
  ok(res, updated);
}));

// POST /api/registrations/:id/decline { reason } — host
router.post('/:id/decline', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const reg = await loadRegistration(req.params.id);
  assertHostOrAdmin(req, reg);
  const reason = v(req.body).string('reason', { max: 500, label: 'Reason' }) || '';
  const updated = await transition(reg, 'declined', req.user, {
    role: isAdmin(req.user) ? 'admin' : 'host',
    note: reason,
    set: { decidedAt: new Date(), decidedBy: req.user._id, declineReason: reason },
  });
  await logActivity(req.user, 'registration.declined', 'Registration', reg._id);
  notify(reg.user, {
    type: 'registration_declined',
    title: `Application not approved: ${reg.initiative.title}`,
    message: `The host was unable to accept your application this time.${reason ? `\nReason: ${reason}` : ''}${reg.paymentStatus === 'confirmed' ? '\nYour payment record is preserved; please coordinate with the host regarding a refund.' : ''}`,
    resource: { kind: 'registration', id: reg._id },
    link: link(reg.initiative._id),
  });
  ok(res, updated);
}));

// POST /api/registrations/:id/attendance { status: attended|absent } — host
router.post('/:id/attendance', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const reg = await loadRegistration(req.params.id);
  assertHostOrAdmin(req, reg);
  const val = v(req.body);
  const status = val.oneOf('status', ['attended', 'absent'], { required: true, label: 'Attendance' });
  val.done();
  const init = reg.initiative;
  if (init.status !== 'published') throw ApiError.badRequest('Attendance can only be recorded for active initiatives');
  if (!init.startAt || new Date() < init.startAt) throw ApiError.badRequest('Attendance can be recorded once the initiative has started');
  if (reg.status === status) return ok(res, reg);

  const isCorrection = ['attended', 'absent'].includes(reg.status);
  const updated = await transition(reg, status, req.user, {
    role: isAdmin(req.user) ? 'admin' : 'host',
    note: isCorrection ? 'Attendance corrected' : 'Attendance recorded',
    set: { 'attendance.markedAt': new Date(), 'attendance.markedBy': req.user._id },
  });
  await logActivity(req.user, isCorrection ? 'attendance.corrected' : 'attendance.marked', 'Registration', reg._id, { status });
  if (status === 'attended') {
    notify(reg.user, {
      type: 'attendance',
      title: `Thank you for volunteering: ${init.title}`,
      message: 'Your attendance has been recorded and added to your participation history.',
      resource: { kind: 'registration', id: reg._id },
      link: '/history.html',
      email: false,
    });
  }
  ok(res, updated);
}));

module.exports = router;
