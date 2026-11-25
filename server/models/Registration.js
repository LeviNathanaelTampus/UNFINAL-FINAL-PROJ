'use strict';
const mongoose = require('mongoose');
const { REGISTRATION_STATUS, ACTIVE_REGISTRATION_STATUS, REG_PAYMENT_STATUS } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const historySchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    by: { type: ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    note: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    initiative: { type: ObjectId, ref: 'Initiative', required: true, index: true },
    status: { type: String, enum: REGISTRATION_STATUS, default: 'pending', index: true },
    // Kept in sync with status; used by the partial unique index to block duplicate active registrations
    isActive: { type: Boolean, default: true },
    paymentStatus: { type: String, enum: REG_PAYMENT_STATUS, default: 'not_required', index: true },
    note: { type: String, trim: true, maxlength: 500 }, // volunteer's message to host

    decidedAt: Date,
    decidedBy: { type: ObjectId, ref: 'User' },
    declineReason: { type: String, maxlength: 500 },

    cancelledAt: Date,
    cancelledBy: { type: ObjectId, ref: 'User' },
    cancellationReason: { type: String, maxlength: 500 },

    attendance: {
      markedAt: Date,
      markedBy: { type: ObjectId, ref: 'User' },
    },

    history: [historySchema],
  },
  { timestamps: true }
);

// One active registration per user per initiative (re-registration after cancel creates a new doc)
registrationSchema.index(
  { user: 1, initiative: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active_registration' }
);
registrationSchema.index({ initiative: 1, status: 1 });

registrationSchema.pre('save', function syncActive(next) {
  this.isActive = ACTIVE_REGISTRATION_STATUS.includes(this.status);
  next();
});

registrationSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    delete ret.isActive;
    return ret;
  },
});

module.exports = mongoose.model('Registration', registrationSchema);
