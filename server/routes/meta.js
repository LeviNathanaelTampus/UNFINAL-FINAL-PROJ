'use strict';
const router = require('express').Router();
const { ok } = require('../utils/http');
const { CATEGORIES, HOSTING_RULES, PAYMENT_PROVIDERS, ORG_TYPES, DEFAULT_CENTER, UPLOAD } = require('../config/constants');
const { env } = require('../config/env');

// GET /api/meta — static reference data for the frontend
router.get('/', (req, res) => {
  ok(res, {
    categories: CATEGORIES,
    hostingRules: Object.fromEntries(Object.entries(HOSTING_RULES).map(([k, r]) => [k, { requires: r.requires, message: r.message }])),
    paymentProviders: PAYMENT_PROVIDERS,
    organizationTypes: ORG_TYPES,
    defaultCenter: DEFAULT_CENTER,
    uploads: { maxImageMB: UPLOAD.maxImageBytes / 1048576, maxDocMB: UPLOAD.maxDocBytes / 1048576 },
    features: { ai: env.gemini.enabled, receiptAnalysis: env.gemini.enabled && env.gemini.receiptAnalysis, email: env.gmail.enabled },
  });
});

module.exports = router;
