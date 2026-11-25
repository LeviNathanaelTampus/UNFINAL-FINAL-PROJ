'use strict';
const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_PROVIDERS } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const paymentSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    initiative: { type: ObjectId, ref: 'Initiative', required: true, index: true },
    registration: { type: ObjectId, ref: 'Registration', required: true, index: true },

    amount: { type: Number, required: true, min: 0, max: 1000000 },
    provider: { type: String, enum: Object.keys(PAYMENT_PROVIDERS), required: true },
    referenceNumber: { type: String, required: true, trim: true, maxlength: 64 },
    // Normalised (uppercase, alphanumeric only) for duplicate detection
    referenceKey: { type: String, required: true },
    // true while pending/confirmed — the partial unique index only applies to these.
    // A rejected payment releases its reference (e.g. host rejected a typo) so it can be resubmitted.
    referenceLocked: { type: Boolean, default: true },
    paidAt: Date,
    receipt: { type: ObjectId, required: true }, // GridFS privateFiles id

    status: { type: String, enum: PAYMENT_STATUS, default: 'pending', index: true },
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: { type: String, maxlength: 500 },

    // Optional Gemini pre-read. Advisory only — never used to confirm a payment.
    aiAnalysis: {
      status: { type: String, enum: ['not_run', 'pending', 'done', 'failed'], default: 'not_run' },
      extracted: {
        referenceNumber: String,
        amount: Number,
        transactionDate: String,
        provider: String,
      },
      flags: [{ type: String, maxlength: 200 }],
      analyzedAt: Date,
    },
  },
  { timestamps: true }
);

paymentSchema.index(
  { provider: 1, referenceKey: 1 },
  { unique: true, partialFilterExpression: { referenceLocked: true }, name: 'unique_active_reference' }
);

paymentSchema.statics.normalizeReference = (ref) => String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

paymentSchema.pre('save', function lockRef(next) {
  this.referenceLocked = this.status !== 'rejected';
  next();
});

paymentSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    delete ret.referenceKey;
    delete ret.referenceLocked;
    return ret;
  },
});

module.exports = mongoose.model('Payment', paymentSchema);
