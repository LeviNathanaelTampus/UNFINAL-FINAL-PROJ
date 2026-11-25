'use strict';
const router = require('express').Router();
const Payment = require('../models/Payment');
const Registration = require('../models/Registration');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v, assertObjectId, pagination, pageMeta } = require('../utils/validate');
const { requireAuth, isAdmin } = require('../middleware/auth');
const { writeLimiter, uploadLimiter } = require('../middleware/common');
const { imageUpload, verifyFile } = require('../middleware/upload');
const { saveFile, deleteFile, findFile, streamFile } = require('../utils/gridfs');
const { isHostOf, loadManageableInitiative } = require('../services/access');
const { notify } = require('../services/notify');
const { logActivity } = require('../services/activity');
const { analyzeReceipt } = require('../services/gemini');
const { env } = require('../config/env');
const { PAYMENT_PROVIDERS, UPLOAD } = require('../config/constants');

async function loadPayment(id) {
  const pid = assertObjectId(id, 'payment ID');
  const p = await Payment.findById(pid).populate('initiative').populate('registration');
  if (!p) throw ApiError.notFound('Payment not found');
  return p;
}

function payOut(p) {
  const o = typeof p.toJSON === 'function' ? p.toJSON() : { ...p };
  delete o.referenceKey;
  delete o.referenceLocked;
  if (o.initiative && o.initiative.title) o.initiative = { _id: o.initiative._id, title: o.initiative.title };
  if (o.registration && o.registration.status) o.registration = { _id: o.registration._id, status: o.registration.status };
  return o;
}

/** Background, advisory-only receipt analysis. Never changes payment status. */
async function runReceiptAnalysis(paymentId, file, fee) {
  try {
    await Payment.updateOne({ _id: paymentId }, { $set: { 'aiAnalysis.status': 'pending' } });
    const ex = await analyzeReceipt(file.buffer, file.mimetype);
    const pay = await Payment.findById(paymentId);
    if (!pay) return;
    const flags = [];
    if (!ex.looksLikeReceipt) flags.push('Image may not be a payment receipt');
    if (!ex.referenceNumber) flags.push('Reference number not visible on receipt');
    else if (Payment.normalizeReference(ex.referenceNumber) !== pay.referenceKey) flags.push(`Reference on receipt (${ex.referenceNumber}) differs from the submitted reference`);
    if (ex.amount == null) flags.push('Amount not visible on receipt');
    else {
      if (Math.abs(ex.amount - pay.amount) > 0.009) flags.push(`Amount on receipt (₱${ex.amount}) differs from the submitted amount (₱${pay.amount})`);
      if (fee && Math.abs(ex.amount - fee) > 0.009) flags.push(`Amount on receipt (₱${ex.amount}) differs from the registration fee (₱${fee})`);
    }
    if (ex.provider && ex.provider !== pay.provider) flags.push(`Receipt looks like ${PAYMENT_PROVIDERS[ex.provider]}, but ${PAYMENT_PROVIDERS[pay.provider]} was selected`);
    if (ex.referenceNumber) {
      const key = Payment.normalizeReference(ex.referenceNumber);
      const dup = await Payment.exists({ _id: { $ne: pay._id }, referenceKey: key, status: { $in: ['pending', 'confirmed'] } });
      if (dup) flags.push('The reference on this receipt was already used in another submission');
    }
    pay.aiAnalysis = { status: 'done', extracted: { referenceNumber: ex.referenceNumber, amount: ex.amount, transactionDate: ex.transactionDate, provider: ex.provider }, flags, analyzedAt: new Date() };
    await pay.save();
  } catch (err) {
    console.error(`[payments] Receipt analysis failed: ${err.message}`);
    await Payment.updateOne({ _id: paymentId }, { $set: { 'aiAnalysis.status': 'failed', 'aiAnalysis.analyzedAt': new Date() } }).catch(() => {});
  }
}

// POST /api/payments (multipart) fields: registrationId, provider, referenceNumber, amount, paidAt; file: receipt
router.post('/', requireAuth, uploadLimiter, imageUpload.single('receipt'), asyncHandler(async (req, res) => {
  const val = v(req.body);
  const registrationId = val.objectId('registrationId', { required: true, label: 'Registration' });
  const provider = val.oneOf('provider', Object.keys(PAYMENT_PROVIDERS), { required: true, label: 'Payment method' });
  const referenceNumber = val.string('referenceNumber', { required: true, min: 4, max: 64, label: 'Reference number', pattern: /^[A-Za-z0-9\-\s]+$/, patternMsg: 'Reference number may only contain letters, numbers, spaces and dashes' });
  const amount = val.number('amount', { required: true, min: 1, max: 1000000, label: 'Amount' });
  const paidAt = val.date('paidAt', { label: 'Payment date' });
  if (!req.file) val.fail('receipt', `Attach a screenshot or photo of your receipt (JPG, PNG or WEBP, max ${UPLOAD.maxImageBytes / 1024 / 1024} MB)`);
  val.done();
  if (paidAt && paidAt > new Date(Date.now() + 24 * 3600 * 1000)) throw ApiError.badRequest('Payment date cannot be in the future', { paidAt: 'Invalid date' });
  const mime = verifyFile(req.file, UPLOAD.imageMimes);

  const reg = await Registration.findById(registrationId).populate('initiative');
  if (!reg || String(reg.user) !== String(req.user._id)) throw ApiError.notFound('Registration not found');
  const init = reg.initiative;
  if (!init?.payment?.isPaid) throw ApiError.badRequest('This initiative is free — no payment is needed');
  if (!['pending', 'approved'].includes(reg.status)) throw ApiError.badRequest('Payments can only be submitted for active registrations');
  if (['cancelled', 'completed'].includes(init.displayStatus)) throw ApiError.badRequest(`This initiative is ${init.displayStatus}`);
  if (reg.paymentStatus === 'confirmed') throw ApiError.badRequest('Your payment has already been confirmed');
  if (await Payment.exists({ registration: reg._id, status: 'pending' })) {
    throw ApiError.conflict('You already have a payment waiting for the host to review');
  }

  const referenceKey = Payment.normalizeReference(referenceNumber);
  if (referenceKey.length < 4) throw ApiError.badRequest('Reference number is too short', { referenceNumber: 'Too short' });
  const dup = await Payment.exists({ provider, referenceKey, referenceLocked: true });
  if (dup) {
    await logActivity(req.user, 'payment.duplicate_reference_blocked', 'Registration', reg._id, { provider });
    throw ApiError.conflict('This transaction reference number has already been submitted. Each payment must have its own reference number.', { referenceNumber: 'Already used' });
  }

  const receiptId = await saveFile('private', { buffer: req.file.buffer, mimetype: mime }, { owner: req.user._id, purpose: 'receipt', registration: reg._id });
  let payment;
  try {
    payment = await Payment.create({
      user: req.user._id,
      initiative: init._id,
      registration: reg._id,
      amount: Math.round(amount * 100) / 100,
      provider,
      referenceNumber,
      referenceKey,
      paidAt,
      receipt: receiptId,
      aiAnalysis: { status: env.gemini.enabled && env.gemini.receiptAnalysis ? 'pending' : 'not_run' },
    });
  } catch (err) {
    await deleteFile('private', receiptId);
    if (err.code === 11000) throw ApiError.conflict('This transaction reference number has already been submitted.', { referenceNumber: 'Already used' });
    throw err;
  }
  await Registration.updateOne({ _id: reg._id }, { $set: { paymentStatus: 'pending' } });
  await logActivity(req.user, 'payment.submitted', 'Payment', payment._id, { initiative: String(init._id), amount: payment.amount, provider });

  notify(init.host, {
    type: 'payment_submitted',
    title: `Payment to review: ${init.title}`,
    message: `${req.user.fullName} submitted a ${PAYMENT_PROVIDERS[provider]} payment of ₱${payment.amount}. Review the receipt and confirm it from the participant list.`,
    resource: { kind: 'payment', id: payment._id },
    link: `/manage.html?id=${init._id}&tab=payments`,
    email: false,
  });
  notify(req.user._id, {
    type: 'payment_submitted',
    title: `Payment submitted: ${init.title}`,
    message: 'Your payment proof was received and is waiting for the host to verify it. Your payment stays pending until the host confirms it.',
    resource: { kind: 'payment', id: payment._id },
    link: `/initiative.html?id=${init._id}`,
    email: false,
  });

  if (env.gemini.enabled && env.gemini.receiptAnalysis) {
    const file = { buffer: req.file.buffer, mimetype: mime };
    setImmediate(() => runReceiptAnalysis(payment._id, file, init.payment.fee));
  }
  created(res, payOut(payment));
}));

// GET /api/payments/mine
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 20 });
  const filter = { user: req.user._id };
  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-aiAnalysis').populate('initiative', 'title'),
    Payment.countDocuments(filter),
  ]);
  ok(res, items.map(payOut), pageMeta(page, limit, total));
}));

// GET /api/payments/initiative/:id?status= — host view
router.get('/initiative/:id', requireAuth, asyncHandler(async (req, res) => {
  const init = await loadManageableInitiative(req, req.params.id);
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const status = v(req.query).oneOf('status', ['pending', 'confirmed', 'rejected', 'all']) || 'all';
  const filter = { initiative: init._id };
  if (status !== 'all') filter.status = status;
  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ status: 1, createdAt: -1 }).skip(skip).limit(limit)
      .populate('user', 'fullName email avatar')
      .populate('reviewedBy', 'fullName')
      .populate('registration', 'status'),
    Payment.countDocuments(filter),
  ]);
  ok(res, { fee: init.payment?.fee, aiEnabled: env.gemini.enabled && env.gemini.receiptAnalysis, items: items.map(payOut) }, pageMeta(page, limit, total));
}));

async function review(req, res, decision) {
  const p = await loadPayment(req.params.id);
  if (!isHostOf(req.user, p.initiative) && !isAdmin(req.user)) throw ApiError.forbidden('Only the initiative host can review payments');
  if (p.status !== 'pending') throw ApiError.badRequest(`This payment was already ${p.status}`);
  let reason = '';
  if (decision === 'rejected') {
    const val = v(req.body);
    reason = val.string('reason', { required: true, min: 3, max: 500, label: 'Reason' });
    val.done();
  }
  const updated = await Payment.findOneAndUpdate(
    { _id: p._id, status: 'pending' },
    { $set: { status: decision, referenceLocked: decision !== 'rejected', reviewedBy: req.user._id, reviewedAt: new Date(), rejectionReason: reason || undefined } },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('This payment was just reviewed. Refresh to see the latest status.');
  await Registration.updateOne({ _id: p.registration._id }, { $set: { paymentStatus: decision } });
  await logActivity(req.user, `payment.${decision}`, 'Payment', p._id, { initiative: String(p.initiative._id) });
  notify(p.user, {
    type: decision === 'confirmed' ? 'payment_confirmed' : 'payment_rejected',
    title: decision === 'confirmed' ? `Payment confirmed: ${p.initiative.title}` : `Payment not accepted: ${p.initiative.title}`,
    message: decision === 'confirmed'
      ? `The host confirmed your payment of ₱${p.amount}.`
      : `The host could not verify your payment.\nReason: ${reason}\nYou can submit a new payment proof from the initiative page.`,
    resource: { kind: 'payment', id: p._id },
    link: `/initiative.html?id=${p.initiative._id}`,
  });
  ok(res, payOut(updated));
}

// POST /api/payments/:id/confirm — host manual confirmation
router.post('/:id/confirm', requireAuth, writeLimiter, asyncHandler((req, res) => review(req, res, 'confirmed')));
// POST /api/payments/:id/reject { reason }
router.post('/:id/reject', requireAuth, writeLimiter, asyncHandler((req, res) => review(req, res, 'rejected')));

// GET /api/payments/:id/receipt — uploader, host, or admin only
router.get('/:id/receipt', requireAuth, asyncHandler(async (req, res) => {
  const p = await loadPayment(req.params.id);
  const allowed = String(p.user) === String(req.user._id) || isHostOf(req.user, p.initiative) || isAdmin(req.user);
  if (!allowed) throw ApiError.forbidden('You cannot view this receipt');
  const file = await findFile('private', p.receipt);
  if (!file) throw ApiError.notFound('Receipt file not found');
  streamFile('private', file, res);
}));

module.exports = router;
