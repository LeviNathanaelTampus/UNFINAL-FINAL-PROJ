'use strict';
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, maxlength: 80, index: true },
    resourceType: { type: String, maxlength: 40 },
    resourceId: { type: ObjectId, default: null },
    // Non-sensitive context only (never passwords, tokens, PRC numbers, payment references)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
