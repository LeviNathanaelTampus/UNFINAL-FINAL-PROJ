'use strict';
const { v } = require('../utils/validate');
const { ApiError } = require('../utils/http');
const { CATEGORIES, HOSTING_RULES } = require('../config/constants');

/**
 * Parse & validate initiative fields from a request body.
 * Only fields present in the body are returned (so it works for create and partial edit).
 * Structural validation only — completeness for publishing is checked by assertPublishable().
 */
function parseInitiativeInput(body, { requireTitle = false } = {}) {
  const b = body || {};
  const val = v(b);
  const out = {};

  const set = (key, value) => {
    if (value !== undefined) out[key] = value;
  };

  set('title', val.string('title', { required: requireTitle, min: 3, max: 150, label: 'Title' }));
  if ('description' in b) out.description = val.string('description', { max: 8000, label: 'Description' }) || '';
  if ('category' in b) out.category = val.oneOf('category', Object.keys(CATEGORIES), { label: 'Category' }) || null;
  if ('coverImage' in b) out.coverImage = b.coverImage ? val.objectId('coverImage', { label: 'Cover image' }) : null;
  if ('organization' in b) out.organization = b.organization ? val.objectId('organization', { label: 'Organization' }) : null;

  for (const f of ['startAt', 'endAt', 'registrationDeadline']) {
    if (f in b) out[f] = b[f] ? val.date(f, { label: { startAt: 'Start date/time', endAt: 'End date/time', registrationDeadline: 'Registration deadline' }[f] }) : null;
  }

  if ('location' in b) {
    const loc = b.location && typeof b.location === 'object' ? b.location : {};
    const lv = v(loc);
    out.location = {
      name: lv.string('name', { max: 150, label: 'Location name' }) || '',
      address: lv.string('address', { max: 300, label: 'Address' }) || '',
      city: lv.string('city', { max: 100, label: 'City / municipality' }) || '',
      province: lv.string('province', { max: 100, label: 'Province' }) || '',
    };
    Object.entries(lv.errors).forEach(([k, m]) => val.fail(`location.${k}`, m));
  }

  if ('lat' in b || 'lng' in b) {
    const hasLat = b.lat !== '' && b.lat !== null && b.lat !== undefined;
    const hasLng = b.lng !== '' && b.lng !== null && b.lng !== undefined;
    if (hasLat !== hasLng) {
      val.fail('lat', 'Provide both latitude and longitude, or leave both empty');
    } else if (hasLat) {
      const lat = val.number('lat', { min: -90, max: 90, label: 'Latitude' });
      const lng = val.number('lng', { min: -180, max: 180, label: 'Longitude' });
      if (lat !== undefined && lng !== undefined) out.geo = { type: 'Point', coordinates: [lng, lat] };
    } else {
      out.geo = null;
    }
  }

  if ('capacity' in b) out.capacity = b.capacity === '' || b.capacity === null ? null : val.number('capacity', { min: 1, max: 10000, integer: true, label: 'Participant capacity' });
  set('requiresApproval', val.boolean('requiresApproval', { label: 'Requires approval' }));
  if ('requirements' in b) out.requirements = val.stringList('requirements', { maxItems: 20, maxLen: 300, label: 'Requirements' }) || [];
  if ('requiredSkills' in b) out.requiredSkills = val.stringList('requiredSkills', { maxItems: 20, maxLen: 80, label: 'Required skills', split: /[,\n]/ }) || [];
  if ('eligibility' in b) out.eligibility = val.string('eligibility', { max: 500, label: 'Eligibility' }) || '';
  if ('registrationInstructions' in b) out.registrationInstructions = val.string('registrationInstructions', { max: 2000, label: 'Registration instructions' }) || '';
  if ('checklist' in b) out.checklist = val.stringList('checklist', { maxItems: 30, maxLen: 300, label: 'Preparation checklist' }) || [];
  if ('reminders' in b) out.reminders = val.stringList('reminders', { maxItems: 20, maxLen: 300, label: 'Reminders' }) || [];

  if ('payment' in b) {
    const p = b.payment && typeof b.payment === 'object' ? b.payment : {};
    const pv = v(p);
    const isPaid = pv.boolean('isPaid', { label: 'Paid initiative' }) || false;
    out.payment = {
      isPaid,
      fee: isPaid ? pv.number('fee', { min: 0, max: 1000000, label: 'Registration fee' }) : undefined,
      instructions: pv.string('instructions', { max: 2000, label: 'Payment instructions' }) || '',
      gcashName: pv.string('gcashName', { max: 100, label: 'GCash account name' }) || '',
      gcashNumber: pv.string('gcashNumber', { max: 20, label: 'GCash number', pattern: /^[0-9+\-\s]{7,20}$/, patternMsg: 'GCash number should contain digits only (e.g. 09171234567)' }) || '',
      qrImage: p.qrImage ? pv.objectId('qrImage', { label: 'QR image' }) : null,
      bankInstructions: pv.string('bankInstructions', { max: 1000, label: 'Online banking instructions' }) || '',
    };
    if (out.payment.fee !== undefined) out.payment.fee = Math.round(out.payment.fee * 100) / 100;
    Object.entries(pv.errors).forEach(([k, m]) => val.fail(`payment.${k}`, m));
  }

  if ('contact' in b) {
    const c = b.contact && typeof b.contact === 'object' ? b.contact : {};
    const cv = v(c);
    out.contact = {
      name: cv.string('name', { max: 100, label: 'Contact name' }) || '',
      phone: cv.string('phone', { max: 30, label: 'Contact phone' }) || '',
      email: cv.email('email', { label: 'Contact email' }) || '',
    };
    Object.entries(cv.errors).forEach(([k, m]) => val.fail(`contact.${k}`, m));
  }

  val.done();
  return out;
}

/** Collect everything that prevents a document from being published. */
function publishProblems(doc, now = new Date()) {
  const p = {};
  if (!doc.title || doc.title.length < 3) p.title = 'Add a title (at least 3 characters)';
  if (!doc.description || doc.description.length < 30) p.description = 'Add a description of at least 30 characters';
  if (!doc.category) p.category = 'Choose a category';
  if (!doc.startAt) p.startAt = 'Set a start date and time';
  if (!doc.endAt) p.endAt = 'Set an end date and time';
  if (doc.startAt && doc.endAt && doc.endAt <= doc.startAt) p.endAt = 'End date/time must be later than the start date/time';
  if (doc.startAt && doc.startAt <= now) p.startAt = 'Start date/time must be in the future';
  if (doc.registrationDeadline && doc.startAt && doc.registrationDeadline > doc.startAt) {
    p.registrationDeadline = 'Registration deadline must be on or before the start date/time';
  }
  if (!doc.location?.name) p['location.name'] = 'Add a location name (e.g. Barangay hall, school gym)';
  if (!doc.location?.address) p['location.address'] = 'Add the complete address';
  if (!doc.capacity || doc.capacity < 1) p.capacity = 'Set a participant capacity of at least 1';
  if (doc.payment?.isPaid) {
    if (!doc.payment.fee || doc.payment.fee <= 0) p['payment.fee'] = 'Set a registration fee greater than 0 for paid initiatives';
    const hasMethod = doc.payment.gcashNumber || doc.payment.qrImage || doc.payment.bankInstructions || doc.payment.instructions;
    if (!hasMethod) p['payment.instructions'] = 'Add at least one way to pay (GCash, QR Ph code, or bank instructions)';
  }
  return p;
}

/**
 * Schedule sanity checks that apply to drafts too (not just publishing):
 * a new/changed start can't be in the past, the end must come after the start,
 * and the registration deadline must fall on or before the start.
 */
function assertSchedule(doc, { startChanged = true, now = new Date() } = {}) {
  const p = {};
  if (startChanged && doc.startAt && doc.startAt <= now) p.startAt = 'Start date/time must be in the future';
  if (doc.startAt && doc.endAt && doc.endAt <= doc.startAt) p.endAt = 'End date/time must be later than the start date/time';
  if (doc.registrationDeadline && doc.startAt && doc.registrationDeadline > doc.startAt) {
    p.registrationDeadline = 'Registration deadline must be on or before the start date/time';
  }
  if (Object.keys(p).length) throw ApiError.badRequest(Object.values(p)[0], p);
}

function assertPublishable(doc) {
  const problems = publishProblems(doc);
  if (Object.keys(problems).length) {
    throw ApiError.badRequest(`Cannot publish yet: ${Object.values(problems)[0]}`, problems);
  }
}

/** Enforce category-based hosting restrictions (e.g. medical missions need verified professionals). */
function assertCanHostCategory(user, category) {
  const rule = HOSTING_RULES[category];
  if (!rule || !rule.requires || !rule.requires.length) return;
  if (user.role === 'admin') return;
  const ok = user.verification?.status === 'verified' && rule.requires.includes(user.verification.type);
  if (!ok) throw ApiError.forbidden(rule.message);
}

function canHostCategory(user, category) {
  try {
    assertCanHostCategory(user, category);
    return true;
  } catch {
    return false;
  }
}

module.exports = { parseInitiativeInput, publishProblems, assertSchedule, assertPublishable, assertCanHostCategory, canHostCategory };
