'use strict';
/**
 * Notification service.
 * In-app notifications are always created first (source of truth).
 * Email is best-effort, sent in the background, and never blocks or fails the main request.
 */
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendEmail } = require('./gmail');
const { env } = require('../config/env');

/**
 * @param {Array|string|ObjectId} recipients  user ids
 * @param {{type:string,title:string,message:string,resource?:{kind,id},link?:string,email?:boolean}} n
 */
async function notify(recipients, n) {
  const ids = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const wantsEmail = n.email !== false && env.gmail.enabled;

  let docs = [];
  try {
    docs = await Notification.insertMany(
      ids.map((user) => ({
        user,
        type: n.type,
        title: String(n.title).slice(0, 150),
        message: String(n.message).slice(0, 3000),
        resource: n.resource || { kind: null, id: null },
        link: n.link,
        email: { status: wantsEmail ? 'queued' : 'skipped' },
      })),
      { ordered: false }
    );
  } catch (err) {
    console.error(`[notify] Failed to create notifications (${n.type}): ${err.message}`);
    return [];
  }

  if (wantsEmail) {
    // Background — do not await
    setImmediate(() => deliverEmails(docs, n).catch((e) => console.error(`[notify] Email batch error: ${e.message}`)));
  }
  return docs;
}

async function deliverEmails(docs, n) {
  const users = await User.find({ _id: { $in: docs.map((d) => d.user) } }).select('email emailNotifications accountStatus').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  for (const doc of docs) {
    const u = byId.get(String(doc.user));
    let status = 'skipped';
    if (u && u.emailNotifications !== false && u.accountStatus === 'active') {
      status = await sendEmail({ to: u.email, subject: `GoodNeighbor: ${n.title}`, title: n.title, message: n.message, link: n.link });
    }
    await Notification.updateOne({ _id: doc._id }, { $set: { 'email.status': status, 'email.attemptedAt': new Date() } }).catch(() => {});
  }
}

module.exports = { notify };
