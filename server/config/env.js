'use strict';
require('dotenv').config();

// Optional: override the DNS servers Node uses. Some Windows setups (VPNs, local DNS proxies
// on 127.0.0.1) refuse the SRV lookups that mongodb+srv:// connection strings need.
// Lives here so the server AND the scripts (create-admin, etc.) both get it.
// Example in .env:  DNS_SERVERS=8.8.8.8,1.1.1.1
if (process.env.DNS_SERVERS) {
  require('dns').setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
}

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGODB_URI || '',

  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    receiptAnalysis: bool(process.env.GEMINI_RECEIPT_ANALYSIS, false),
    requestsPerHour: parseInt(process.env.AI_REQUESTS_PER_HOUR, 10) || 20,
  },

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
    sender: process.env.GMAIL_SENDER || '',
    senderName: process.env.GMAIL_SENDER_NAME || 'GoodNeighbor Health',
  },
};

env.gemini.enabled = Boolean(env.gemini.apiKey);
env.gmail.enabled = Boolean(
  env.gmail.clientId && env.gmail.clientSecret && env.gmail.refreshToken && env.gmail.sender
);

function assertRequired() {
  const missing = [];
  if (!env.mongoUri) missing.push('MONGODB_URI');
  if (!env.jwtSecret || env.jwtSecret === 'change-me-to-a-long-random-string') missing.push('JWT_SECRET');
  if (missing.length) {
    console.error(`[config] Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
    process.exit(1);
  }
  if (env.jwtSecret.length < 32) {
    console.warn('[config] JWT_SECRET is shorter than 32 characters; use a longer random value.');
  }
}

module.exports = { env, assertRequired };
