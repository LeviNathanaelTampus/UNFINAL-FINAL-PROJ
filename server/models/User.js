'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { VERIFICATION_STATUS } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    suspendedReason: { type: String, maxlength: 500 },

    // Profile
    phone: { type: String, trim: true, maxlength: 30 },
    bio: { type: String, trim: true, maxlength: 1000 },
    city: { type: String, trim: true, maxlength: 100 },
    interests: [{ type: String, trim: true, maxlength: 60 }],
    skills: [{ type: String, trim: true, maxlength: 60 }],
    experience: { type: String, trim: true, maxlength: 2000 },
    avatar: { type: mongoose.Schema.Types.ObjectId },

    // Professional verification summary (details live in MedicalVerification)
    verification: {
      status: { type: String, enum: VERIFICATION_STATUS, default: 'not_submitted' },
      type: { type: String, enum: ['licensed', 'student', null], default: null },
      profession: { type: String, trim: true, maxlength: 100 },
      verifiedAt: Date,
    },

    emailNotifications: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.index({ fullName: 'text', email: 'text' });

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash || '');
};

userSchema.virtual('isVerifiedProfessional').get(function () {
  return this.verification?.status === 'verified';
});

/** Fields safe to show to anyone (no email / phone). */
userSchema.methods.toPublic = function toPublic() {
  return {
    _id: this._id,
    fullName: this.fullName,
    avatar: this.avatar || null,
    bio: this.bio || '',
    city: this.city || '',
    interests: this.interests || [],
    skills: this.skills || [],
    verification: {
      status: this.verification?.status === 'verified' ? 'verified' : 'not_verified',
      type: this.verification?.status === 'verified' ? this.verification.type : null,
      profession: this.verification?.status === 'verified' ? this.verification.profession : null,
    },
    createdAt: this.createdAt,
  };
};

userSchema.set('toJSON', {
  virtuals: true,
  transform(doc, ret) {
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.__v;
    delete ret.id;
    return ret;
  },
});

/** Minimal projection for embedding a host/participant reference. */
userSchema.statics.PUBLIC_FIELDS = 'fullName avatar verification.status verification.type verification.profession';

module.exports = mongoose.model('User', userSchema);
