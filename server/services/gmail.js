'use strict';
/**
 * Gmail API sender using OAuth2 (refresh-token flow) over plain HTTPS — no extra SDK needed.
 * Docs: https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send
 */
const { env } = require('../config/env');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TIMEOUT_MS = 10000;

let cachedToken = null; // { value, expiresAt }

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: env.gmail.clientId,
    client_secret: env.gmail.clientSecret,
    refresh_token: env.gmail.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    cachedToken = null;
    throw new Error(`Gmail token refresh failed (HTTP ${res.status})`);
  }
  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3000) * 1000 };
  return cachedToken.value;
}

function encodeHeader(s) {
  // RFC 2047 encoded-word so Filipino names / emoji survive
  return `=?UTF-8?B?${Buffer.from(String(s), 'utf8').toString('base64')}?=`;
}

function stripCRLF(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}

function buildMime({ to, subject, text, html }) {
  const boundary = `gn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const from = `${encodeHeader(env.gmail.senderName)} <${env.gmail.sender}>`;
  const lines = [
    `From: ${from}`,
    `To: ${stripCRLF(to)}`,
    `Subject: ${encodeHeader(stripCRLF(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderEmail({ title, message, link }) {
  const url = link ? `${env.appUrl}${link}` : env.appUrl;
  const text = `${title}\n\n${message}\n\nOpen GoodNeighbor Health: ${url}\n\n— GoodNeighbor Health\nYou can turn off email notifications in your profile settings.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8f8f8;font-family:Segoe UI,Arial,sans-serif;color:#252525">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <tr><td style="background:#D62828;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">GoodNeighbor Health</td></tr>
    <tr><td style="padding:24px">
      <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h2>
      <p style="margin:0 0 20px;line-height:1.6;white-space:pre-line">${escapeHtml(message)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#D62828;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open GoodNeighbor</a>
    </td></tr>
    <tr><td style="padding:16px 24px;color:#777;font-size:12px;border-top:1px solid #eee">You received this because you have an account on GoodNeighbor Health. You can turn off email notifications in your profile.</td></tr>
  </table></td></tr></table></body></html>`;
  return { text, html };
}

/**
 * Send an email. Returns 'sent' | 'skipped' | 'failed'. Never throws.
 * Logs failures without recipient address or message content.
 */
async function sendEmail({ to, subject, title, message, link }) {
  if (!env.gmail.enabled) return 'skipped';
  try {
    const token = await getAccessToken();
    const { text, html } = renderEmail({ title: title || subject, message, link });
    const raw = buildMime({ to, subject, text, html });
    const res = await fetchWithTimeout(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (res.status === 401) cachedToken = null;
    if (!res.ok) throw new Error(`Gmail send failed (HTTP ${res.status})`);
    return 'sent';
  } catch (err) {
    console.error(`[gmail] Delivery failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    return 'failed';
  }
}

module.exports = { sendEmail, buildMime };
