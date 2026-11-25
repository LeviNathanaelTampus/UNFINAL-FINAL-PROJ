'use strict';
const Initiative = require('../models/Initiative');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { ApiError } = require('../utils/http');
const { assertObjectId } = require('../utils/validate');
const { isAdmin } = require('../middleware/auth');

const isHostOf = (user, initiative) => Boolean(user && initiative && String(initiative.host?._id || initiative.host) === String(user._id));

/** Load an initiative the current user may manage (host or admin). */
async function loadManageableInitiative(req, id, { populate = false } = {}) {
  const iid = assertObjectId(id, 'initiative ID');
  let q = Initiative.findById(iid);
  if (populate) q = q.populate('host', User.PUBLIC_FIELDS).populate('organization', 'name logo verificationStatus type');
  const doc = await q;
  if (!doc || (doc.deletedAt && !isAdmin(req.user))) throw ApiError.notFound('Initiative not found');
  if (!isHostOf(req.user, doc) && !isAdmin(req.user)) {
    throw ApiError.forbidden('Only the host of this initiative can manage it');
  }
  return doc;
}

/** Ensure the user can post an initiative under this organization (owner/admin member of an active org). */
async function assertCanUseOrganization(user, orgId) {
  if (!orgId) return null;
  const org = await Organization.findById(orgId);
  if (!org || org.status !== 'active') throw ApiError.badRequest('Organization not found or inactive', { organization: 'Organization not available' });
  const role = org.roleOf(user._id);
  if (!['owner', 'admin'].includes(role) && !isAdmin(user)) {
    throw ApiError.forbidden('Only organization owners and admins can host initiatives under this organization');
  }
  return org;
}

module.exports = { isHostOf, loadManageableInitiative, assertCanUseOrganization };
