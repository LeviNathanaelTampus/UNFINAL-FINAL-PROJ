'use strict';
const Registration = require('../models/Registration');
const Initiative = require('../models/Initiative');
const { ApiError } = require('../utils/http');
const { REGISTRATION_TRANSITIONS, ACTIVE_REGISTRATION_STATUS, SLOT_HOLDING_STATUS } = require('../config/constants');

/**
 * Atomically move a registration from its current status to `to`.
 * Guards against invalid transitions and concurrent edits (compare-and-set on status).
 * Releases the initiative slot when leaving a slot-holding status.
 */
async function transition(reg, to, actor, { role, note, set = {} } = {}) {
  const from = reg.status;
  const allowed = REGISTRATION_TRANSITIONS[from] || {};
  if (!allowed[to]) {
    throw ApiError.badRequest(`A registration that is "${from}" cannot be changed to "${to}"`);
  }
  if (role && allowed[to] !== role && role !== 'admin') {
    throw ApiError.forbidden(allowed[to] === 'host' ? 'Only the initiative host can do this' : 'Only the volunteer can do this');
  }

  const updated = await Registration.findOneAndUpdate(
    { _id: reg._id, status: from },
    {
      $set: { status: to, isActive: ACTIVE_REGISTRATION_STATUS.includes(to), ...set },
      $push: { history: { from, to, by: actor?._id || null, at: new Date(), note: note ? String(note).slice(0, 300) : undefined } },
    },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('This registration was just updated by someone else. Refresh and try again.');

  const heldBefore = SLOT_HOLDING_STATUS.includes(from);
  const heldAfter = SLOT_HOLDING_STATUS.includes(to);
  if (heldBefore && !heldAfter) {
    await Initiative.updateOne({ _id: reg.initiative?._id || reg.initiative, slotsTaken: { $gt: 0 } }, { $inc: { slotsTaken: -1 } });
  }
  return updated;
}

/**
 * Reserve a slot atomically. Returns the updated initiative or throws if full/unavailable.
 */
async function reserveSlot(initiativeId) {
  const now = new Date();
  const updated = await Initiative.findOneAndUpdate(
    {
      _id: initiativeId,
      status: 'published',
      deletedAt: null,
      startAt: { $gt: now },
      $expr: { $lt: ['$slotsTaken', '$capacity'] },
    },
    { $inc: { slotsTaken: 1 } },
    { new: true }
  );
  return updated;
}

async function releaseSlot(initiativeId) {
  await Initiative.updateOne({ _id: initiativeId, slotsTaken: { $gt: 0 } }, { $inc: { slotsTaken: -1 } });
}

module.exports = { transition, reserveSlot, releaseSlot };
