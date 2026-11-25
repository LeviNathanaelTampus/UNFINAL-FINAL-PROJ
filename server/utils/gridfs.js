'use strict';
/**
 * GridFS file storage.
 *  - "publicFiles" bucket: cover images, avatars, org logos, payment QR codes (readable by anyone)
 *  - "privateFiles" bucket: payment receipts, verification documents (served only via authorised routes)
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Readable } = require('stream');

const BUCKETS = { public: 'publicFiles', private: 'privateFiles' };

function bucket(kind) {
  const name = BUCKETS[kind];
  if (!name) throw new Error(`Unknown bucket ${kind}`);
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: name });
}

/**
 * @param {'public'|'private'} kind
 * @param {{buffer:Buffer, mimetype:string}} file
 * @param {object} metadata  e.g. { owner, purpose }
 * @returns {Promise<mongoose.Types.ObjectId>}
 */
function saveFile(kind, file, metadata) {
  return new Promise((resolve, reject) => {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[file.mimetype] || 'bin';
    const filename = `${metadata.purpose || 'file'}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const upload = bucket(kind).openUploadStream(filename, {
      metadata: { ...metadata, contentType: file.mimetype, size: file.buffer.length },
    });
    Readable.from(file.buffer).pipe(upload).on('error', reject).on('finish', () => resolve(upload.id));
  });
}

async function findFile(kind, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const docs = await bucket(kind).find({ _id: new mongoose.Types.ObjectId(String(id)) }).limit(1).toArray();
  return docs[0] || null;
}

function streamFile(kind, fileDoc, res, { cache = 'private, no-store' } = {}) {
  res.setHeader('Content-Type', fileDoc.metadata?.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', fileDoc.length);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (fileDoc.metadata?.contentType === 'application/pdf') {
    res.setHeader('Content-Disposition', `inline; filename="${fileDoc.filename}"`);
  }
  bucket(kind).openDownloadStream(fileDoc._id)
    .on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); })
    .pipe(res);
}

async function readFileBuffer(kind, id) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    bucket(kind).openDownloadStream(new mongoose.Types.ObjectId(String(id)))
      .on('data', (c) => chunks.push(c))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function deleteFile(kind, id) {
  try {
    await bucket(kind).delete(new mongoose.Types.ObjectId(String(id)));
  } catch {
    /* already gone */
  }
}

/** Verify a public image file id was uploaded by this user (prevents attaching others' files). */
async function assertOwnPublicImage(id, userId) {
  const f = await findFile('public', id);
  if (!f || String(f.metadata?.owner) !== String(userId)) return false;
  return true;
}

module.exports = { saveFile, findFile, streamFile, readFileBuffer, deleteFile, assertOwnPublicImage };
