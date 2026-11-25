// Initiative group chat — polling-based (no websockets), mounted on the initiative page.
import { api } from './api.js';
import { esc, icon, avatar, toast, confirmDialog } from './ui.js';

const POLL_MS = 4000;
const TZ = 'Asia/Manila';
const timeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));

/**
 * Mount the chat into `el` for initiative `initiativeId`.
 * Returns { destroy() } — call before re-rendering the page.
 */
export function mountChat(el, { initiativeId, title = 'Group chat', subtitle = '', onClose } = {}) {
  const state = { messages: [], lastId: null, since: null, hasMore: false, chat: null, timer: null, busy: false, dead: false };

  el.innerHTML = `<div class="card chat" id="chat-card">
    <div class="chat-head">
      <span class="icon-circle">${icon('chat')}</span>
      <div class="grow"><strong class="truncate" style="display:block">${esc(title)}</strong><span class="text-xs muted truncate" style="display:block" id="chat-meta">${esc(subtitle)}</span></div>
      ${onClose ? `<button type="button" class="icon-btn" id="chat-close" aria-label="Close chat">${icon('x')}</button>` : ''}
    </div>
    <div class="chat-scroll" id="chat-scroll" aria-live="polite" aria-label="Chat messages">
      <div class="chat-older" id="chat-older" hidden><button type="button" class="btn btn-sm btn-ghost">Load earlier messages</button></div>
      <div id="chat-list"><div class="loading"><span class="spinner" aria-hidden="true"></span> Loading chat…</div></div>
    </div>
    <form class="chat-compose" id="chat-form" autocomplete="off">
      <label for="chat-input" class="sr-only">Message</label>
      <textarea id="chat-input" class="chat-input" rows="1" maxlength="1000" placeholder="Message the group…"></textarea>
      <button type="submit" class="btn btn-primary chat-send" aria-label="Send">${icon('send')}</button>
    </form>
  </div>`;

  const scroller = el.querySelector('#chat-scroll');
  const list = el.querySelector('#chat-list');
  const form = el.querySelector('#chat-form');
  const input = el.querySelector('#chat-input');
  const olderBtn = el.querySelector('#chat-older');

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

  function bubble(m, prev) {
    const sameAuthor = prev && !prev.deleted && String(prev.author._id) === String(m.author._id)
      && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000 && dayKey(prev.createdAt) === dayKey(m.createdAt);
    const role = m.author.role === 'host' ? '<span class="badge badge-blue">Host</span>' : m.author.role === 'moderator' ? '<span class="badge badge-dark">Moderator</span>' : '';
    const canDelete = !m.deleted && (m.mine || state.chat?.canModerate);
    return `<div class="msg ${m.mine ? 'mine' : ''} ${sameAuthor ? 'cont' : ''}" data-id="${esc(m._id)}">
      ${m.mine ? '' : `<div class="msg-av">${sameAuthor ? '' : avatar(m.author, 'avatar-sm')}</div>`}
      <div class="msg-body">
        ${sameAuthor || m.mine ? '' : `<div class="msg-name">${esc(m.author.fullName || 'Member')} ${role}</div>`}
        <div class="msg-bubble ${m.deleted ? 'deleted' : ''}">${m.deleted ? 'Message removed' : esc(m.text)}</div>
        <div class="msg-time">${esc(timeFmt.format(new Date(m.createdAt)))}${canDelete ? ` · <button type="button" class="link-btn msg-del" data-del="${esc(m._id)}">Delete</button>` : ''}</div>
      </div>
    </div>`;
  }

  function render({ keepPosition = false, stick = false } = {}) {
    if (!state.messages.length) {
      list.innerHTML = `<div class="chat-empty">${icon('users')}<strong>Say hello 👋</strong><span>Coordinate carpools, what to bring, or questions for the host.</span></div>`;
      return;
    }
    const prevHeight = scroller.scrollHeight;
    const prevTop = scroller.scrollTop;
    let html = '';
    let lastDay = null;
    state.messages.forEach((m, i) => {
      const d = dayKey(m.createdAt);
      if (d !== lastDay) { html += `<div class="chat-day"><span>${esc(dayFmt.format(new Date(m.createdAt)))}</span></div>`; lastDay = d; }
      html += bubble(m, i > 0 && dayKey(state.messages[i - 1].createdAt) === d ? state.messages[i - 1] : null);
    });
    list.innerHTML = html;
    if (keepPosition) scroller.scrollTop = scroller.scrollHeight - prevHeight + prevTop;
    else if (stick) toBottom();
  }

  function applyMeta() {
    const c = state.chat;
    if (!c) return;
    el.querySelector('#chat-meta').textContent = `${c.memberCount} member${c.memberCount === 1 ? '' : 's'}${subtitle ? ` · ${subtitle}` : ''}`;
    olderBtn.hidden = !state.hasMore;
    if (!c.canPost) {
      form.innerHTML = '<p class="text-sm muted mb-0" style="padding:4px 6px">This initiative was cancelled, so the chat is read-only.</p>';
    }
  }

  async function loadInitial() {
    try {
      const { data } = await api(`/chat/${encodeURIComponent(initiativeId)}`, { redirectOn401: false });
      state.chat = data.chat;
      state.messages = data.messages;
      state.hasMore = data.hasMore;
      state.lastId = data.messages.at(-1)?._id || null;
      state.since = data.serverTime;
      applyMeta();
      render({ stick: true });
      schedule();
    } catch (err) {
      list.innerHTML = `<div class="chat-empty">${icon('alert')}<span>${esc(err.message || 'Chat could not load.')}</span></div>`;
      form.hidden = true;
    }
  }

  async function poll() {
    if (state.dead || state.busy || document.hidden) return schedule();
    state.busy = true;
    try {
      const query = state.lastId ? { after: state.lastId, since: state.since } : {};
      const { data } = await api(`/chat/${encodeURIComponent(initiativeId)}`, { query, redirectOn401: false });
      state.chat = data.chat;
      state.since = data.serverTime;
      let changed = false;
      const known = new Set(state.messages.map((m) => String(m._id)));
      const fresh = data.messages.filter((m) => !known.has(String(m._id)));
      if (!state.lastId && data.messages.length) { state.messages = data.messages; changed = true; } else if (fresh.length) { state.messages.push(...fresh); changed = true; }
      if (data.removed?.length) {
        const gone = new Set(data.removed.map(String));
        state.messages.forEach((m) => { if (gone.has(String(m._id)) && !m.deleted) { m.deleted = true; m.text = ''; changed = true; } });
      }
      state.lastId = state.messages.at(-1)?._id || state.lastId;
      if (changed) { const stick = nearBottom(); render({ stick }); }
      applyMeta();
    } catch { /* transient network errors: keep polling */ } finally {
      state.busy = false;
      schedule();
    }
  }
  function schedule() {
    clearTimeout(state.timer);
    if (!state.dead) state.timer = setTimeout(poll, POLL_MS);
  }

  olderBtn.querySelector('button').onclick = async () => {
    const first = state.messages[0];
    if (!first) return;
    try {
      const { data } = await api(`/chat/${encodeURIComponent(initiativeId)}`, { query: { before: first._id }, redirectOn401: false });
      state.messages = [...data.messages, ...state.messages];
      state.hasMore = data.hasMore;
      applyMeta();
      render({ keepPosition: true });
    } catch (err) { toast(err.message, 'error'); }
  };

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const ok = await confirmDialog({ title: 'Delete this message?', message: 'Everyone in the chat will see "Message removed".', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/chat/${encodeURIComponent(initiativeId)}/messages/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
      const m = state.messages.find((x) => String(x._id) === b.dataset.del);
      if (m) { m.deleted = true; m.text = ''; }
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Composer: Enter sends, Shift+Enter adds a new line; textarea grows up to ~5 lines
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const btn = form.querySelector('.chat-send');
    btn.disabled = true;
    try {
      const { data } = await api(`/chat/${encodeURIComponent(initiativeId)}`, { method: 'POST', body: { text } });
      input.value = '';
      grow();
      if (!state.messages.some((m) => String(m._id) === String(data._id))) state.messages.push(data);
      state.lastId = data._id;
      render({ stick: true });
    } catch (err) {
      toast(err.message || 'Message not sent. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  });

  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  if (onClose) el.querySelector('#chat-close').onclick = onClose;

  loadInitial();
  return {
    focus() { input.focus({ preventScroll: true }); },
    destroy() {
      state.dead = true;
      clearTimeout(state.timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
