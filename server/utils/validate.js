'use strict';
/**
 * Small, dependency-free validation helpers.
 * Each `v.*` function returns the cleaned value or records an error on the collector.
 */
const mongoose = require('mongoose');
const { ApiError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanString(s) {
  return String(s).replace(CONTROL_RE, '').trim();
}

class Validator {
  constructor(source) {
    this.src = source || {};
    this.errors = {};
  }

  fail(field, msg) {
    if (!this.errors[field]) this.errors[field] = msg;
    return undefined;
  }

  has(field) {
    const val = this.src[field];
    return val !== undefined && val !== null && val !== '';
  }

  string(field, { required = false, min = 0, max = 2000, label = field, pattern, patternMsg } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') return this.fail(field, `${label} must be text`);
    const val = cleanString(raw);
    if (required && !val) return this.fail(field, `${label} is required`);
    if (val.length < min) return this.fail(field, `${label} must be at least ${min} characters`);
    if (val.length > max) return this.fail(field, `${label} must be at most ${max} characters`);
    if (pattern && val && !pattern.test(val)) return this.fail(field, patternMsg || `${label} is invalid`);
    return val;
  }

  email(field, { required = false, label = 'Email' } = {}) {
    const val = this.string(field, { required, max: 254, label });
    if (val === undefined) return undefined;
    if (!EMAIL_RE.test(val)) return this.fail(field, 'Enter a valid email address');
    return val.toLowerCase();
  }

  password(field, { required = true, label = 'Password' } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    if (typeof raw !== 'string') return this.fail(field, `${label} must be text`);
    if (raw.length < 8) return this.fail(field, `${label} must be at least 8 characters`);
    if (raw.length > 128) return this.fail(field, `${label} must be at most 128 characters`);
    if (!/[A-Za-z]/.test(raw) || !/\d/.test(raw)) return this.fail(field, `${label} must contain at least one letter and one number`);
    return raw;
  }

  number(field, { required = false, min, max, integer = false, label = field } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return this.fail(field, `${label} must be a number`);
    if (integer && !Number.isInteger(n)) return this.fail(field, `${label} must be a whole number`);
    if (min !== undefined && n < min) return this.fail(field, `${label} must be at least ${min}`);
    if (max !== undefined && n > max) return this.fail(field, `${label} must be at most ${max}`);
    return n;
  }

  boolean(field, { required = false, label = field } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    if (typeof raw === 'boolean') return raw;
    if (['true', '1', 'on', 'yes'].includes(String(raw).toLowerCase())) return true;
    if (['false', '0', 'off', 'no'].includes(String(raw).toLowerCase())) return false;
    return this.fail(field, `${label} must be true or false`);
  }

  date(field, { required = false, label = field } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return this.fail(field, `${label} must be a valid date`);
    return d;
  }

  oneOf(field, allowed, { required = false, label = field } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    const val = String(raw);
    if (!allowed.includes(val)) return this.fail(field, `${label} must be one of: ${allowed.join(', ')}`);
    return val;
  }

  objectId(field, { required = false, label = field } = {}) {
    const raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${label} is required`);
      return undefined;
    }
    if (!mongoose.isValidObjectId(String(raw))) return this.fail(field, `${label} is invalid`);
    return String(raw);
  }

  /** Array of short strings. Accepts an array or a newline/comma separated string. */
  stringList(field, { maxItems = 20, maxLen = 200, label = field, split = /\n/ } = {}) {
    let raw = this.src[field];
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'string') raw = raw.split(split);
    if (!Array.isArray(raw)) return this.fail(field, `${label} must be a list`);
    const out = [];
    for (const item of raw) {
      if (typeof item !== 'string' && typeof item !== 'number') return this.fail(field, `${label} must contain text only`);
      const s = cleanString(item);
      if (!s) continue;
      if (s.length > maxLen) return this.fail(field, `Each ${label} item must be at most ${maxLen} characters`);
      out.push(s);
    }
    if (out.length > maxItems) return this.fail(field, `${label} can have at most ${maxItems} items`);
    return out;
  }

  /** Throw a 400 if any errors were collected */
  done() {
    if (Object.keys(this.errors).length) {
      const first = Object.values(this.errors)[0];
      throw ApiError.badRequest(first, this.errors);
    }
  }
}

const v = (src) => new Validator(src);

function assertObjectId(id, label = 'ID') {
  if (!mongoose.isValidObjectId(String(id))) throw ApiError.badRequest(`Invalid ${label}`);
  return String(id);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Validate page/limit query params. Throws 400 on invalid values. */
function pagination(query, { defaultLimit = 12, maxLimit = 50 } = {}) {
  const errs = {};
  let page = 1;
  let limit = defaultLimit;
  if (query.page !== undefined && query.page !== '') {
    page = Number(query.page);
    if (!Number.isInteger(page) || page < 1 || page > 10000) errs.page = 'page must be a whole number from 1 to 10000';
  }
  if (query.limit !== undefined && query.limit !== '') {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) errs.limit = `limit must be a whole number from 1 to ${maxLimit}`;
  }
  if (Object.keys(errs).length) throw ApiError.badRequest(Object.values(errs)[0], errs);
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { v, Validator, assertObjectId, escapeRegex, pagination, pageMeta, cleanString, EMAIL_RE };
