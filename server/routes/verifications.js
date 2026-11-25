'use strict';
const router = require('express').Router();
const MedicalVerification = require('../models/MedicalVerification');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/common');
const { docUpload, verifyFile } = require('../middleware/upload');
const { saveFile, deleteFile } = require('../utils/gridfs');
const { logActivity } = require('../services/activity');
const { UPLOAD } = require('../config/constants');

// POST /api/verifications (multipart) — submit professional credentials for admin review.
// PRC numbers and documents are stored privately, visible only to administrators, never sent to AI.
router.post('/', requireAuth, uploadLimiter, docUpload.array('documents', 3), asyncHandler(async (req, res) => {
  const user = req.user;
  if (user.role === 'admin') throw ApiError.badRequest('Administrator accounts do not need verification');
  const val = v(req.body);
  const professionalType = val.oneOf('professionalType', ['licensed', 'student'], { required: true, label: 'Type' });
  const profession = val.string('profession', { required: true, min: 2, max: 100, label: professionalType === 'student' ? 'Program / course' : 'Profession' });
  let prcLicenseNumber;
  let licenseExpiry;
  let school;
  let yearLevel;
  if (professionalType === 'licensed') {
    prcLicenseNumber = val.string('prcLicenseNumber', { required: true, min: 5, max: 20, label: 'PRC license number', pattern: /^[0-9A-Za-z-]+$/, patternMsg: 'PRC license number may only contain letters, digits and dashes' });
    licenseExpiry = val.date('licenseExpiry', { label: 'License expiry date' });
    if (licenseExpiry && licenseExpiry < new Date()) val.fail('licenseExpiry', 'This license appears to be expired');
  } else if (professionalType === 'student') {
    school = val.string('school', { required: true, min: 2, max: 150, label: 'School' });
    yearLevel = val.string('yearLevel', { max: 50, label: 'Year level' });
  }
  const notes = val.string('notes', { max: 1000, label: 'Notes' });
  const files = req.files || [];
  if (!files.length) val.fail('documents', professionalType === 'student' ? 'Upload a photo of your school ID or certificate of enrolment' : 'Upload a photo of your PRC ID (front) or certificate of registration');
  val.done();

  const types = files.map((f) => verifyFile(f, UPLOAD.docMimes));

  if (await MedicalVerification.exists({ user: user._id, status: 'pending' })) {
    throw ApiError.conflict('You already have a verification request under review');
  }

  const saved = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const id = await saveFile('private', { buffer: files[i].buffer, mimetype: types[i] }, { owner: user._id, purpose: 'verification' });
      saved.push({ fileId: id, contentType: types[i], originalName: String(files[i].originalname || '').slice(0, 100) });
    }
    const request = await MedicalVerification.create({
      user: user._id, professionalType, profession, prcLicenseNumber, licenseExpiry, school, yearLevel, notes, documents: saved,
    });
    if (user.verification?.status !== 'verified') {
      user.verification = { status: 'pending', type: professionalType, profession };
      await user.save();
    }
    await logActivity(user, 'verification.submitted', 'MedicalVerification', request._id, { professionalType });
    created(res, { _id: request._id, status: request.status, professionalType, profession, createdAt: request.createdAt });
  } catch (err) {
    await Promise.all(saved.map((s) => deleteFile('private', s.fileId)));
    if (err.code === 11000) throw ApiError.conflict('You already have a verification request under review');
    throw err;
  }
}));

// GET /api/verifications/me — own request history (without PRC number or documents)
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const items = await MedicalVerification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('professionalType profession school yearLevel status rejectionReason reviewedAt createdAt')
    .lean();
  ok(res, { current: req.user.verification, requests: items });
}));

module.exports = router;
