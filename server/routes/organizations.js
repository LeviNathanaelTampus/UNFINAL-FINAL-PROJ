'use strict';
const router = require('express').Router();
const Organization = require('../models/Organization');
const Initiative = require('../models/Initiative');
const User = require('../models/User');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v, assertObjectId, escapeRegex, pagination, pageMeta } = require('../utils/validate');
const { requireAuth, optionalAuth, isAdmin } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/common');
const { assertOwnPublicImage } = require('../utils/gridfs');
const { initiativeCard, publicUserRef } = require('../utils/serialize');
const { notify } = require('../services/notify');
const { logActivity } = require('../services/activity');
const { ORG_TYPES } = require('../config/constants');

function parseOrg(body, { create }) {
  const val = v(body);
  const out = {};
  if (create || 'name' in body) out.name = val.string('name', { required: true, min: 2, max: 120, label: 'Organization name' });
  if ('description' in body) out.description = val.string('description', { max: 3000, label: 'Description' }) || '';
  if (create || 'type' in body) out.type = val.oneOf('type', Object.keys(ORG_TYPES), { required: true, label: 'Organization type' });
  if ('location' in body) out.location = val.string('location', { max: 200, label: 'Location' }) || '';
  if ('logo' in body) out.logo = body.logo ? val.objectId('logo', { label: 'Logo' }) : null;
  if ('contact' in body) {
    const cv = v(body.contact && typeof body.contact === 'object' ? body.contact : {});
    out.contact = {
      email: cv.email('email', { label: 'Contact email' }) || '',
      phone: cv.string('phone', { max: 30, label: 'Contact phone' }) || '',
      website: cv.string('website', { max: 300, label: 'Website', pattern: /^https?:\/\/[^\s]+$/i, patternMsg: 'Website must start with http:// or https://' }) || '',
    };
    Object.entries(cv.errors).forEach(([k, m]) => val.fail(`contact.${k}`, m));
  }
  val.done();
  return out;
}

async function loadOrg(id) {
  const oid = assertObjectId(id, 'organization ID');
  const org = await Organization.findById(oid).populate('members.user', 'fullName avatar email verification.status verification.type verification.profession');
  if (!org) throw ApiError.notFound('Organization not found');
  return org;
}

function assertOrgManager(req, org, roles = ['owner', 'admin']) {
  if (isAdmin(req.user)) return;
  if (!roles.includes(org.roleOf(req.user._id))) throw ApiError.forbidden(roles.length === 1 ? 'Only the organization owner can do this' : 'Only organization owners and admins can do this');
  if (org.status !== 'active') throw ApiError.forbidden('This organization has been deactivated');
}

function orgOut(org, viewer) {
  const o = org.toJSON();
  const myRole = viewer ? org.roleOf(viewer._id) : null;
  const canSeeEmails = Boolean(myRole && ['owner', 'admin'].includes(myRole)) || isAdmin(viewer);
  o.members = org.members.map((m) => ({
    role: m.role,
    joinedAt: m.joinedAt,
    user: { ...publicUserRef(m.user), ...(canSeeEmails ? { email: m.user?.email } : {}) },
  }));
  o.memberCount = org.members.length;
  o.myRole = myRole;
  return o;
}

// GET /api/organizations?q=&type=
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pagination(req.query, { defaultLimit: 12 });
  const val = v(req.query);
  const q = val.string('q', { max: 100 });
  const type = val.oneOf('type', Object.keys(ORG_TYPES));
  val.done();
  const filter = { status: 'active' };
  if (type) filter.type = type;
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  const [items, total] = await Promise.all([
    Organization.find(filter).sort({ verificationStatus: -1, name: 1 }).skip(skip).limit(limit).select('-members -nameKey'),
    Organization.countDocuments(filter),
  ]);
  ok(res, items, pageMeta(page, limit, total));
}));

// POST /api/organizations
router.post('/', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const input = parseOrg(req.body, { create: true });
  if (input.logo && !(await assertOwnPublicImage(input.logo, req.user._id))) throw ApiError.badRequest('Logo upload not found');
  const nameKey = Organization.makeKey(input.name);
  if (await Organization.exists({ nameKey })) throw ApiError.conflict('An organization with this name already exists. Ask its owner to add you as a member.', { name: 'Name already taken' });
  let org;
  try {
    org = await Organization.create({ ...input, nameKey, createdBy: req.user._id, members: [{ user: req.user._id, role: 'owner' }] });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('An organization with this name already exists.', { name: 'Name already taken' });
    throw err;
  }
  await logActivity(req.user, 'organization.created', 'Organization', org._id, { name: org.name });
  await org.populate('members.user', 'fullName avatar email verification.status verification.type verification.profession');
  created(res, orgOut(org, req.user));
}));

// GET /api/organizations/:id
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const org = await loadOrg(req.params.id);
  if (org.status !== 'active' && !isAdmin(req.user) && !org.roleOf(req.user?._id)) throw ApiError.notFound('Organization not found');
  const initiatives = await Initiative.find({ organization: org._id, status: 'published', deletedAt: null })
    .sort({ startAt: -1 }).limit(12).populate('host', User.PUBLIC_FIELDS).populate('organization', 'name logo verificationStatus type');
  ok(res, { ...orgOut(org, req.user), initiatives: initiatives.map(initiativeCard) });
}));

// PATCH /api/organizations/:id
router.patch('/:id', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const org = await loadOrg(req.params.id);
  assertOrgManager(req, org);
  const input = parseOrg(req.body, { create: false });
  if (input.logo && String(input.logo) !== String(org.logo) && !(await assertOwnPublicImage(input.logo, req.user._id))) throw ApiError.badRequest('Logo upload not found');
  if (input.name) {
    const nameKey = Organization.makeKey(input.name);
    if (nameKey !== org.nameKey && (await Organization.exists({ nameKey }))) throw ApiError.conflict('An organization with this name already exists.', { name: 'Name already taken' });
    org.nameKey = nameKey;
  }
  Object.entries(input).forEach(([k, val]) => org.set(k, val));
  await org.save();
  await logActivity(req.user, 'organization.updated', 'Organization', org._id);
  ok(res, orgOut(org, req.user));
}));

// POST /api/organizations/:id/members { email, role }
router.post('/:id/members', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const org = await loadOrg(req.params.id);
  assertOrgManager(req, org);
  const val = v(req.body);
  const email = val.email('email', { required: true, label: 'Member email' });
  const role = val.oneOf('role', ['member', 'admin'], { label: 'Role' }) || 'member';
  val.done();
  if (role === 'admin' && org.roleOf(req.user._id) !== 'owner' && !isAdmin(req.user)) throw ApiError.forbidden('Only the owner can add organization admins');
  const user = await User.findOne({ email, accountStatus: 'active', role: 'user' });
  if (!user) throw ApiError.notFound('No active GoodNeighbor account uses that email. Ask them to sign up first.');
  if (org.roleOf(user._id)) throw ApiError.conflict('This person is already a member');
  org.members.push({ user: user._id, role });
  await org.save();
  await org.populate('members.user', 'fullName avatar email verification.status verification.type verification.profession');
  await logActivity(req.user, 'organization.member_added', 'Organization', org._id, { member: String(user._id), role });
  notify(user._id, {
    type: 'organization', title: `You were added to ${org.name}`,
    message: `${req.user.fullName} added you to ${org.name} as ${role === 'admin' ? 'an admin' : 'a member'}.`,
    resource: { kind: 'organization', id: org._id }, link: `/organization.html?id=${org._id}`, email: false,
  });
  ok(res, orgOut(org, req.user));
}));

// PATCH /api/organizations/:id/members/:userId { role } — owner only
router.patch('/:id/members/:userId', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const org = await loadOrg(req.params.id);
  assertOrgManager(req, org, ['owner']);
  const uid = assertObjectId(req.params.userId, 'user ID');
  const val = v(req.body);
  const role = val.oneOf('role', ['member', 'admin', 'owner'], { required: true, label: 'Role' });
  val.done();
  const m = org.members.find((x) => String(x.user._id) === uid);
  if (!m) throw ApiError.notFound('Member not found');
  if (role === 'owner') {
    // Transfer ownership
    org.members.forEach((x) => { if (x.role === 'owner') x.role = 'admin'; });
  } else if (m.role === 'owner') {
    throw ApiError.badRequest('Transfer ownership to someone else first');
  }
  m.role = role;
  await org.save();
  await logActivity(req.user, 'organization.member_role', 'Organization', org._id, { member: uid, role });
  ok(res, orgOut(org, req.user));
}));

// DELETE /api/organizations/:id/members/:userId — remove member or leave
router.delete('/:id/members/:userId', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const org = await loadOrg(req.params.id);
  const uid = assertObjectId(req.params.userId, 'user ID');
  const self = uid === String(req.user._id);
  if (!self) assertOrgManager(req, org);
  const m = org.members.find((x) => String(x.user._id) === uid);
  if (!m) throw ApiError.notFound('Member not found');
  if (m.role === 'owner') throw ApiError.badRequest('The owner cannot be removed. Transfer ownership first.');
  if (!self && m.role === 'admin' && org.roleOf(req.user._id) !== 'owner' && !isAdmin(req.user)) throw ApiError.forbidden('Only the owner can remove admins');
  org.members = org.members.filter((x) => String(x.user._id) !== uid);
  await org.save();
  await logActivity(req.user, self ? 'organization.left' : 'organization.member_removed', 'Organization', org._id, { member: uid });
  ok(res, orgOut(org, req.user));
}));

module.exports = router;
