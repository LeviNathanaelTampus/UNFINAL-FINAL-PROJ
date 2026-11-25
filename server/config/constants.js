'use strict';

const CATEGORIES = {
  medical_mission: 'Medical Mission',
  blood_donation: 'Blood Donation Drive',
  health_awareness: 'Health Awareness Campaign',
  health_education_seminar: 'Healthcare Education Seminar',
  community_wellness: 'Community Wellness Program',
  healthcare_outreach: 'Healthcare Outreach',
  other: 'Other Healthcare Initiative',
};

/**
 * Hosting rules per category.
 *  - requires: list of verification types that may host. Empty/undefined = anyone.
 *    'licensed' = verified licensed healthcare professional (PRC)
 *    'student'  = verified medical/health-sciences student
 * Adjust here to change platform rules.
 */
const HOSTING_RULES = {
  medical_mission: {
    requires: ['licensed'],
    message: 'Only verified licensed healthcare professionals can host medical missions. Submit your PRC credentials from your profile to get verified.',
  },
  health_education_seminar: {
    requires: ['licensed', 'student'],
    message: 'Healthcare education seminars can be hosted by verified healthcare professionals or verified medical/health-sciences students.',
  },
};

const INITIATIVE_STATUS = ['draft', 'published', 'cancelled'];

const REGISTRATION_STATUS = ['pending', 'approved', 'declined', 'cancelled', 'attended', 'absent'];
// Statuses that hold a slot / count as "active" (prevent duplicate registration)
const ACTIVE_REGISTRATION_STATUS = ['pending', 'approved', 'attended', 'absent'];
const SLOT_HOLDING_STATUS = ['pending', 'approved', 'attended', 'absent'];

// Allowed registration status transitions and who may perform them
const REGISTRATION_TRANSITIONS = {
  pending: { approved: 'host', declined: 'host', cancelled: 'volunteer' },
  approved: { cancelled: 'volunteer', attended: 'host', absent: 'host' },
  attended: { absent: 'host' }, // attendance correction
  absent: { attended: 'host' }, // attendance correction
  declined: {},
  cancelled: {},
};

const PAYMENT_STATUS = ['pending', 'confirmed', 'rejected'];
const REG_PAYMENT_STATUS = ['not_required', 'unpaid', 'pending', 'confirmed', 'rejected'];
const PAYMENT_PROVIDERS = { gcash: 'GCash', qrph: 'QR Ph', bank: 'Online Banking', other: 'Other' };

const VERIFICATION_STATUS = ['not_submitted', 'pending', 'verified', 'rejected'];
const PROFESSIONAL_TYPES = { licensed: 'Licensed Healthcare Professional', student: 'Medical / Health Sciences Student' };

const ORG_TYPES = {
  healthcare: 'Healthcare Organization',
  student: 'Student Organization',
  community: 'Community Organization',
  ngo: 'Non-Government Organization',
  other: 'Other',
};

const NOTIFICATION_TYPES = [
  'registration_submitted', 'registration_approved', 'registration_declined', 'registration_cancelled',
  'new_registration', 'payment_submitted', 'payment_confirmed', 'payment_rejected',
  'initiative_cancelled', 'initiative_updated', 'announcement', 'attendance',
  'verification_approved', 'verification_rejected', 'organization', 'platform',
];

const UPLOAD = {
  maxImageBytes: 5 * 1024 * 1024,
  maxDocBytes: 8 * 1024 * 1024,
  imageMimes: ['image/jpeg', 'image/png', 'image/webp'],
  docMimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
};

// Default map center: Cagayan de Oro City
const DEFAULT_CENTER = { lat: 8.4542, lng: 124.6319 };

module.exports = {
  CATEGORIES, HOSTING_RULES, INITIATIVE_STATUS, REGISTRATION_STATUS, ACTIVE_REGISTRATION_STATUS,
  SLOT_HOLDING_STATUS, REGISTRATION_TRANSITIONS, PAYMENT_STATUS, REG_PAYMENT_STATUS, PAYMENT_PROVIDERS,
  VERIFICATION_STATUS, PROFESSIONAL_TYPES, ORG_TYPES, NOTIFICATION_TYPES, UPLOAD, DEFAULT_CENTER,
};
