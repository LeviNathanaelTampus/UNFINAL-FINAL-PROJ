'use strict';
/**
 * Initiative group chat.
 *
 * Who can read & post: the host, volunteers whose registration is approved
 * (or later marked attended/absent), and platform admins (shown as "Moderator").
 * Pending, declined and cancelled registrants — and everyone else — get 403.
 * Moderation: authors can delete their own messages; the host and admins can delete any.
 * Clients poll GET /:id?after=<lastMessageId> every few seconds (no websockets needed).
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Initiative = require('../models/Initiative');
const Registration = require('../models/Registration');
const User = require('../models/User');
const { ChatMessage, ChatRead } = require('../models/ChatMessage');
const { asyncHandler, ok, created, ApiError } = require('../utils/http');
const { v, assertObjectId } = require('../utils/validate');
const { requireAuth, isAdmin } = require('../middleware/auth');
const { isHostOf } = require('../services/access');
const { publicUserRef } = require('../utils/serialize');

const MEMBER_STATUSES = ['approved', 'attended', 'absent'];
const PAGE = 50;

// Max 15 messages per minute per user, across all chats
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `chat:${req.user._id}`,
  message: { success: false, error: { message: 'You are sending messages too quickly. Please wait a moment.' } },
});

/** Load the initiative and work out the caller's role in its chat (or throw 403/404). */
async function loadChatContext(req, idParam) {
  const iid = assertObjectId(idParam, 'initiative ID');
  const initiative = await Initiative.findById(iid).select('title host status deletedAt startAt endAt');
  if (!initiative || initiative.deletedAt) throw ApiError.notFound('Initiative not found');
  if (initiative.status === 'draft') throw ApiError.forbidden('Group chat opens once the initiative is published');

  const admin = isAdmin(req.user);
  const host = isHostOf(req.user, initiative);
  let member = host || admin;
  if (!member) {
    member = Boolean(await Registration.exists({ initiative: iid, user: req.user._id, status: { $in: MEMBER_STATUSES } }));
  }
  if (!member) throw ApiError.forbidden('The group chat is only for the host and approved volunteers of this initiative');

  const readOnly = initiative.status === 'cancelled';
  return { initiative, admin, host, canModerate: host || admin, readOnly };
}

function messageOut(m, { me, hostId }) {
  const deleted = Boolean(m.deletedAt);
  const authorId = String(m.author?._id || m.author);
  const role = authorId === String(hostId) ? 'host' : m.author?.role === 'admin' ? 'moderator' : null;
  return {
    _id: m._id,
    text: deleted ? '' : m.text,
    deleted,
    createdAt: m.createdAt,
    author: { ...publicUserRef(m.author), role },
    mine: authorId === String(me),
  };
}

async function markRead(userId, initiativeId) {
  await ChatRead.updateOne({ user: userId, initiative: initiativeId }, { $set: { lastReadAt: new Date() } }, { upsert: true });
}

// GET /api/chat/unread — unread counts for every chat the user belongs to (dashboard / badges)
router.get('/unread', requireAuth, asyncHandler(async (req, res) => {
  const [regs, hosted] = await Promise.all([
    Registration.find({ user: req.user._id, status: { $in: MEMBER_STATUSES } }).select('initiative').lean(),
    Initiative.find({ host: req.user._id, status: 'published', deletedAt: null }).select('_id').lean(),
  ]);
  const ids = [...new Set([...regs.map((r) => String(r.initiative)), ...hosted.map((i) => String(i._id))])]
    .map((s) => new mongoose.Types.ObjectId(s));
  if (!ids.length) return ok(res, { total: 0, chats: [] });

  const reads = await ChatRead.find({ user: req.user._id, initiative: { $in: ids } }).lean();
  const lastRead = new Map(reads.map((r) => [String(r.initiative), r.lastReadAt]));
  const counts = await Promise.all(ids.map(async (iid) => {
    const n = await ChatMessage.countDocuments({
      initiative: iid,
      author: { $ne: req.user._id },
      deletedAt: null,
      createdAt: { $gt: lastRead.get(String(iid)) || new Date(0) },
    });
    return { initiative: iid, unread: n };
  }));
  const chats = counts.filter((c) => c.unread > 0);
  ok(res, { total: chats.reduce((s, c) => s + c.unread, 0), chats });
}));

// GET /api/chat/:id?after=<msgId>   → new messages since the last one the client has (polling)
// GET /api/chat/:id?before=<msgId>  → older page (scrolling up)
// GET /api/chat/:id                 → latest page
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const ctx = await loadChatContext(req, req.params.id);
  const filter = { initiative: ctx.initiative._id };
  const { after, before } = req.query;
  if (after) filter._id = { $gt: assertObjectId(after, 'message ID') };
  else if (before) filter._id = { $lt: assertObjectId(before, 'message ID') };

  const rows = await ChatMessage.find(filter)
    .sort({ _id: after ? 1 : -1 })
    .limit(PAGE + 1)
    .populate('author', `${User.PUBLIC_FIELDS} role`)
    .lean();
  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  if (!after) page.reverse(); // always return oldest → newest

  // Deletions since the client's last poll, so removed bubbles update for everyone
  let removed = [];
  if (after && req.query.since) {
    const since = new Date(req.query.since);
    if (!Number.isNaN(since.getTime())) {
      removed = (await ChatMessage.find({ initiative: ctx.initiative._id, deletedAt: { $gt: since } }).select('_id').lean()).map((m) => m._id);
    }
  }

  if (!before) await markRead(req.user._id, ctx.initiative._id);

  const memberCount = 1 + await Registration.countDocuments({ initiative: ctx.initiative._id, status: { $in: MEMBER_STATUSES } });
  ok(res, {
    messages: page.map((m) => messageOut(m, { me: req.user._id, hostId: ctx.initiative.host })),
    hasMore: !after && hasMore,
    removed,
    serverTime: new Date(),
    chat: { canPost: !ctx.readOnly, canModerate: ctx.canModerate, readOnly: ctx.readOnly, memberCount },
  });
}));

// POST /api/chat/:id { text }
router.post('/:id', requireAuth, chatLimiter, asyncHandler(async (req, res) => {
  const ctx = await loadChatContext(req, req.params.id);
  if (ctx.readOnly) throw ApiError.badRequest('This initiative was cancelled, so its chat is now read-only');
  const val = v(req.body);
  const text = val.string('text', { required: true, min: 1, max: 1000, label: 'Message' });
  val.done();

  const msg = await ChatMessage.create({ initiative: ctx.initiative._id, author: req.user._id, text });
  await msg.populate('author', `${User.PUBLIC_FIELDS} role`);
  await markRead(req.user._id, ctx.initiative._id);
  created(res, messageOut(msg.toObject(), { me: req.user._id, hostId: ctx.initiative.host }));
}));

// DELETE /api/chat/:id/messages/:messageId — author, host, or admin
router.delete('/:id/messages/:messageId', requireAuth, asyncHandler(async (req, res) => {
  const ctx = await loadChatContext(req, req.params.id);
  const mid = assertObjectId(req.params.messageId, 'message ID');
  const msg = await ChatMessage.findOne({ _id: mid, initiative: ctx.initiative._id });
  if (!msg) throw ApiError.notFound('Message not found');
  const own = String(msg.author) === String(req.user._id);
  if (!own && !ctx.canModerate) throw ApiError.forbidden('You can only delete your own messages');
  if (!msg.deletedAt) {
    msg.deletedAt = new Date();
    msg.deletedBy = req.user._id;
    msg.text = '';
    await msg.save();
  }
  ok(res, { _id: msg._id, deleted: true });
}));

module.exports = router;
