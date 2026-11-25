'use strict';
const mongoose = require('mongoose');
const { ORG_TYPES } = require('../config/constants');

const { ObjectId } = mongoose.Schema.Types;

const memberSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    // Lowercased, whitespace-collapsed name to prevent duplicates
    nameKey: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 3000 },
    type: { type: String, enum: Object.keys(ORG_TYPES), default: 'other' },
    logo: { type: ObjectId, default: null },
    contact: {
      email: { type: String, trim: true, maxlength: 254 },
      phone: { type: String, trim: true, maxlength: 30 },
      website: { type: String, trim: true, maxlength: 300 },
    },
    location: { type: String, trim: true, maxlength: 200 },
    members: [memberSchema],
    createdBy: { type: ObjectId, ref: 'User', required: true },

    verificationStatus: { type: String, enum: ['unverified', 'verified'], default: 'unverified', index: true },
    status: { type: String, enum: ['active', 'deactivated'], default: 'active', index: true },
    deactivatedReason: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

organizationSchema.index({ 'members.user': 1 });
organizationSchema.index({ name: 'text', description: 'text' });

organizationSchema.statics.makeKey = (name) => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

organizationSchema.methods.roleOf = function roleOf(userId) {
  const m = this.members.find((x) => String(x.user?._id || x.user) === String(userId));
  return m ? m.role : null;
};

organizationSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    delete ret.nameKey;
    return ret;
  },
});

module.exports = mongoose.model('Organization', organizationSchema);
