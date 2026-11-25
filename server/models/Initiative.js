'use strict';
const mongoose = require('mongoose');
const { CATEGORIES, INITIATIVE_STATUS } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 150 },
    message: { type: String, required: true, maxlength: 3000 },
    author: { type: ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const initiativeSchema = new mongoose.Schema(
  {
    host: { type: ObjectId, ref: 'User', required: true, index: true },
    organization: { type: ObjectId, ref: 'Organization', default: null, index: true },

    // Basic information
    title: { type: String, trim: true, maxlength: 150, required: true },
    description: { type: String, trim: true, maxlength: 8000, default: '' },
    category: { type: String, enum: [...Object.keys(CATEGORIES), null], default: null, index: true },
    coverImage: { type: ObjectId, default: null },

    // Schedule (stored as absolute instants; UI uses Asia/Manila)
    startAt: { type: Date, index: true },
    endAt: { type: Date },
    registrationDeadline: { type: Date },

    // Location
    location: {
      name: { type: String, trim: true, maxlength: 150 },
      address: { type: String, trim: true, maxlength: 300 },
      city: { type: String, trim: true, maxlength: 100 },
      province: { type: String, trim: true, maxlength: 100 },
    },
    // GeoJSON Point [lng, lat] — only set when coordinates are provided
    geo: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined },
    },

    // Participation
    capacity: { type: Number, min: 1, max: 10000 },
    slotsTaken: { type: Number, default: 0, min: 0 },
    requiresApproval: { type: Boolean, default: true },
    requirements: [{ type: String, maxlength: 300 }],
    requiredSkills: [{ type: String, maxlength: 80 }],
    eligibility: { type: String, maxlength: 500 },
    registrationInstructions: { type: String, maxlength: 2000 },

    // Payment
    payment: {
      isPaid: { type: Boolean, default: false },
      fee: { type: Number, min: 0, max: 1000000 },
      instructions: { type: String, maxlength: 2000 },
      gcashName: { type: String, maxlength: 100 },
      gcashNumber: { type: String, maxlength: 20 },
      qrImage: { type: ObjectId, default: null },
      bankInstructions: { type: String, maxlength: 1000 },
    },

    // Additional information
    checklist: [{ type: String, maxlength: 300 }],
    reminders: [{ type: String, maxlength: 300 }],
    contact: {
      name: { type: String, maxlength: 100 },
      phone: { type: String, maxlength: 30 },
      email: { type: String, maxlength: 254 },
    },

    announcements: [announcementSchema],

    status: { type: String, enum: INITIATIVE_STATUS, default: 'draft', index: true },
    publishedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: ObjectId, ref: 'User' },
    cancellationReason: { type: String, maxlength: 1000 },

    // Soft deletion (drafts removed by host). Never hard-delete published history.
    deletedAt: { type: Date, default: null, index: true },

    // Idempotency key for create requests retried over unstable connections
    clientRequestId: { type: String, maxlength: 64 },
  },
  { timestamps: true }
);

initiativeSchema.index({ geo: '2dsphere' }, { sparse: true });
initiativeSchema.index({ status: 1, deletedAt: 1, startAt: 1 });
initiativeSchema.index({ host: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } });
initiativeSchema.index(
  { title: 'text', description: 'text', 'location.name': 'text', 'location.address': 'text', 'location.city': 'text' },
  { weights: { title: 5, 'location.name': 3, 'location.city': 3, description: 1, 'location.address': 1 }, name: 'initiative_text' }
);

/**
 * Derived, time-aware status shown to users:
 * draft | cancelled | completed | ongoing | full | closed | open
 */
function computeDisplayStatus(doc, now = new Date()) {
  if (doc.deletedAt) return 'deleted';
  if (doc.status === 'draft') return 'draft';
  if (doc.status === 'cancelled') return 'cancelled';
  if (doc.endAt && now >= doc.endAt) return 'completed';
  if (doc.startAt && now >= doc.startAt) return 'ongoing';
  if (doc.capacity && doc.slotsTaken >= doc.capacity) return 'full';
  if (doc.registrationDeadline && now > doc.registrationDeadline) return 'closed';
  return 'open';
}

initiativeSchema.virtual('displayStatus').get(function () {
  return computeDisplayStatus(this);
});
initiativeSchema.virtual('slotsAvailable').get(function () {
  if (!this.capacity) return null;
  return Math.max(0, this.capacity - (this.slotsTaken || 0));
});
initiativeSchema.virtual('coordinates').get(function () {
  const c = this.geo?.coordinates;
  if (!c || c.length !== 2) return null;
  return { lat: c[1], lng: c[0] };
});

initiativeSchema.set('toJSON', {
  virtuals: true,
  transform(doc, ret) {
    delete ret.__v;
    delete ret.id;
    delete ret.clientRequestId;
    delete ret.geo;
    return ret;
  },
});

const Initiative = mongoose.model('Initiative', initiativeSchema);
Initiative.computeDisplayStatus = computeDisplayStatus;
module.exports = Initiative;
