'use strict';
const multer = require('multer');
const { UPLOAD } = require('../config/constants');
const { ApiError } = require('../utils/http');

const storage = multer.memoryStorage();

function makeUploader({ maxBytes, mimes, maxFiles = 1 }) {
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: maxFiles, fields: 40, fieldSize: 20000 },
    fileFilter: (req, file, cb) => {
      if (!mimes.includes(file.mimetype)) {
        return cb(ApiError.badRequest(`Unsupported file type. Allowed: ${mimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')}`));
      }
      cb(null, true);
    },
  });
}

const imageUpload = makeUploader({ maxBytes: UPLOAD.maxImageBytes, mimes: UPLOAD.imageMimes });
const docUpload = makeUploader({ maxBytes: UPLOAD.maxDocBytes, mimes: UPLOAD.docMimes, maxFiles: 3 });

/** Detect the real file type from magic bytes — do not trust the client-provided mimetype. */
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function verifyFile(file, allowed) {
  const real = sniffMime(file.buffer);
  if (!real || !allowed.includes(real)) {
    throw ApiError.badRequest('The uploaded file content does not match an allowed file type.');
  }
  return real;
}

module.exports = { imageUpload, docUpload, verifyFile, sniffMime };
