'use strict';
const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const notificationSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 150 },
    message: { type: String, required: true, maxlength: 3000 },
    // Related resource for deep-linking in the UI
    resource: {
      kind: { type: String, enum: ['initiative', 'registration', 'payment', 'verification', 'organization', null], default: null },
      id: { type: ObjectId, default: null },
    },
    link: { type: String, maxlength: 300 },
    read: { type: Boolean, default: false },
    readAt: Date,
    email: {
      status: { type: String, enum: ['skipped', 'queued', 'sent', 'failed'], default: 'skipped' },
      attemptedAt: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

notificationSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
