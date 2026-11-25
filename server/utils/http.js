'use strict';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
  static badRequest(msg, details) { return new ApiError(400, msg || 'Invalid request', details); }
  static unauthorized(msg) { return new ApiError(401, msg || 'Please log in to continue'); }
  static forbidden(msg) { return new ApiError(403, msg || 'You do not have permission to do this'); }
  static notFound(msg) { return new ApiError(404, msg || 'Not found'); }
  static conflict(msg, details) { return new ApiError(409, msg || 'Conflict', details); }
  static unavailable(msg) { return new ApiError(503, msg || 'Service temporarily unavailable'); }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function ok(res, data, meta, status = 200) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function created(res, data) {
  return ok(res, data, undefined, 201);
}

module.exports = { ApiError, asyncHandler, ok, created };
