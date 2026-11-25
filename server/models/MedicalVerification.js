'use strict';
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const verificationSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    professionalType: { type: String, enum: ['licensed', 'student'], required: true },
    profession: { type: String, required: true, trim: true, maxlength: 100 },

    // Licensed professionals — sensitive. Never returned to non-admins, never sent to AI, never logged.
    prcLicenseNumber: { type: String, trim: true, maxlength: 30, select: false },
    licenseExpiry: { type: Date, select: false },

    // Students
    school: { type: String, trim: true, maxlength: 150 },
    yearLevel: { type: String, trim: true, maxlength: 50 },

    notes: { type: String, trim: true, maxlength: 1000 },
    documents: {
      type: [{ fileId: ObjectId, contentType: String, originalName: String }],
      select: false,
    },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

// Only one pending request per user at a time
verificationSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_verification' }
);

verificationSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('MedicalVerification', verificationSchema);
