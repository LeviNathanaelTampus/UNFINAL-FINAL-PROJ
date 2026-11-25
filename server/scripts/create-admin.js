'use strict';
/**
 * Create (or promote) an administrator account.
 *
 *   npm run create-admin -- --email admin@example.com --name "Platform Admin"
 *
 * You will be prompted for a password (or set ADMIN_PASSWORD in the environment).
 * Admin accounts are separate from regular accounts and can only be created with this script.
 */
const readline = require('readline');
const mongoose = require('mongoose');
const { env, assertRequired } = require('../config/env');
const User = require('../models/User');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  assertRequired();
  const email = (arg('email') || (await ask('Admin email: '))).trim().toLowerCase();
  const name = (arg('name') || (await ask('Full name: '))).trim();
  const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 8 chars, letters + numbers): ', true));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Invalid email');
  if (name.length < 2) throw new Error('Name is too short');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Password must be 8+ characters with letters and numbers');

  await mongoose.connect(env.mongoUri);
  let user = await User.findOne({ email }).select('+passwordHash');
  if (user) {
    user.role = 'admin';
    user.accountStatus = 'active';
    console.log(`Promoting existing account ${email} to administrator.`);
  } else {
    user = new User({ email, fullName: name, role: 'admin' });
  }
  await user.setPassword(password);
  await user.save();
  console.log(`✔ Administrator ready: ${email}. Log in at ${env.appUrl}/login.html`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(`✖ ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
