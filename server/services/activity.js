'use strict';
const ActivityLog = require('../models/ActivityLog');

/**
 * Record an important action. Never throws — logging must not break the main operation.
 * Do NOT pass sensitive values (passwords, tokens, PRC numbers, payment references) in metadata.
 */
async function logActivity(actor, action, resourceType, resourceId, metadata = {}) {
  try {
    await ActivityLog.create({
      actor: actor ? actor._id || actor : null,
      action,
      resourceType,
      resourceId: resourceId || null,
      metadata,
    });
  } catch (err) {
    console.error(`[activity] Failed to log ${action}: ${err.message}`);
  }
}

module.exports = { logActivity };
