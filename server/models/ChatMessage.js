'use strict';
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

/**
 * A message in an initiative's group chat.
 * Members: the host, approved volunteers (approved/attended/absent), and platform admins.
 * Deleting is soft: the text is cleared and the bubble shows "Message removed".
 */
const chatMessageSchema = new mongoose.Schema(
  {
    initiative: { type: ObjectId, ref: 'Initiative', required: true },
    author: { type: ObjectId, ref: 'User', required: true },
    text: { type: String, maxlength: 1000, default: '' },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Newest-first paging and "messages after X" polling per initiative
chatMessageSchema.index({ initiative: 1, _id: -1 });

/** Per-user read marker for an initiative chat (drives unread counts). */
const chatReadSchema = new mongoose.Schema({
  user: { type: ObjectId, ref: 'User', required: true },
  initiative: { type: ObjectId, ref: 'Initiative', required: true },
  lastReadAt: { type: Date, default: () => new Date(0) },
});
chatReadSchema.index({ user: 1, initiative: 1 }, { unique: true });

module.exports = {
  ChatMessage: mongoose.model('ChatMessage', chatMessageSchema),
  ChatRead: mongoose.model('ChatRead', chatReadSchema),
};
