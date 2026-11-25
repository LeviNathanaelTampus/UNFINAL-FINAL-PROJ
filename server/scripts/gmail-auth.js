'use strict';
/**
 * One-time helper to obtain a Gmail API refresh token.
 *
 * 1. In Google Cloud Console: enable the Gmail API, configure the OAuth consent screen,
 *    and create an OAuth client ID of type "Desktop app" (or "Web application" with
 *    redirect URI http://localhost:5577/oauth2callback).
 * 2. Put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env
 * 3. Run:  npm run gmail-auth
 * 4. Open the printed URL, sign in with the sending Gmail account, approve.
 * 5. Copy the printed GMAIL_REFRESH_TOKEN into .env
 */
const http = require('http');
const { env } = require('../config/env');

const PORT = 5577;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

if (!env.gmail.clientId || !env.gmail.clientSecret) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: env.gmail.clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/oauth2callback') { res.writeHead(404); return res.end(); }
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code received. Check the terminal.'); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.gmail.clientId, client_secret: env.gmail.clientSecret, redirect_uri: REDIRECT, grant_type: 'authorization_code',
      }),
    });
    const json = await r.json();
    if (!json.refresh_token) throw new Error(json.error_description || 'No refresh token returned (try removing the app from your Google account permissions and run again)');
    res.end('Success! You can close this tab and return to the terminal.');
    console.log('\nAdd this line to your .env:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}\n`);
  } catch (err) {
    res.end('Failed. See terminal.');
    console.error(`Token exchange failed: ${err.message}`);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser and sign in with the Gmail account that will send notifications:\n');
  console.log(authUrl);
  console.log(`\nWaiting for Google to redirect to ${REDIRECT} …`);
});
