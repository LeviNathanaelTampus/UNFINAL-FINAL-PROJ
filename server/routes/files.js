'use strict';
const router = require('express').Router();
const { asyncHandler, created, ApiError } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/common');
const { imageUpload, verifyFile } = require('../middleware/upload');
const { saveFile, findFile, streamFile } = require('../utils/gridfs');
const { assertObjectId } = require('../utils/validate');
const { UPLOAD } = require('../config/constants');

const PURPOSES = ['cover', 'avatar', 'logo', 'qr'];

// POST /api/files/images (multipart: image, purpose) — public images only (covers, avatars, logos, payment QR codes)
router.post('/images', requireAuth, uploadLimiter, imageUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload (JPG, PNG or WEBP, max 5 MB)');
  const purpose = PURPOSES.includes(req.body.purpose) ? req.body.purpose : 'cover';
  const mime = verifyFile(req.file, UPLOAD.imageMimes);
  const id = await saveFile('public', { buffer: req.file.buffer, mimetype: mime }, { owner: req.user._id, purpose });
  created(res, { fileId: id, url: `/api/files/public/${id}` });
}));

// GET /api/files/public/:id — public images
router.get('/public/:id', asyncHandler(async (req, res) => {
  const id = assertObjectId(req.params.id, 'file ID');
  const file = await findFile('public', id);
  if (!file) throw ApiError.notFound('Image not found');
  streamFile('public', file, res, { cache: 'public, max-age=86400, immutable' });
}));

module.exports = router;
