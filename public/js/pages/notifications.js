import { api } from '../api.js';
import { initPage, updateBell } from '../layout.js';
import { $, esc, icon, withState, emptyHtml, relTime, fmtDateTime, renderPagination, setupTabs, toast, setBusy } from '../ui.js';

await initPage({ auth: 'required' });
const state = { tab: 'all', page: 1 };

const TYPE_ICON = {
  registration_submitted: 'clipboard', registration_approved: 'checkCircle', registration_declined: 'x', registration_cancelled: 'x',
  new_registration: 'users', payment_submitted: 'wallet', payment_confirmed: 'wallet', payment_rejected: 'wallet',
  initiative_cancelled: 'alert', initiative_updated: 'calendar', announcement: 'megaphone', attendance: 'heart',
  verification_approved: 'shieldCheck', verification_rejected: 'shield', organization: 'building', platform: 'info',
};

async function load() {
  const list = $('#list');
  const res = await withState(list, () => api('/notifications', { query: { page: state.page, unread: state.tab === 'unread' ? 'true' : undefined } }), { onRetry: load });
  if (!res) return;
  const { data, meta } = res;
  updateBell(meta.unread);
  $('#read-all').disabled = !meta.unread;
  if (!data.length) {
    list.innerHTML = emptyHtml({ icon: 'bell', title: state.tab === 'unread' ? 'No unread notifications' : 'No notifications yet', text: 'Updates about your registrations and initiatives will show up here.' });
    $('#pager').innerHTML = '';
    return;
  }
  list.innerHTML = `<ul class="list">${data.map((n) => `<li class="list-item ${n.read ? '' : 'unread'}" style="align-items:flex-start">
    <div class="icon-circle" style="width:38px;height:38px;border-radius:10px">${icon(TYPE_ICON[n.type] || 'bell')}</div>
    <div class="grow"><div class="row-between"><strong>${esc(n.title)}</strong><span class="text-xs muted" title="${esc(fmtDateTime(n.createdAt))}">${esc(relTime(n.createdAt))}</span></div>
      <p class="pre-line text-sm mb-1 mt-1">${esc(n.message)}</p>
      <div class="row" style="gap:12px">${n.link ? `<a class="text-sm" href="${esc(n.link)}" data-open="${n._id}">Open</a>` : ''}${n.read ? '' : `<button class="link-btn text-sm" data-read="${n._id}">Mark as read</button>`}</div>
    </div></li>`).join('')}</ul>`;
  list.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/notifications/${b.dataset.read}/read`, { method: 'POST' }); load(); } catch (err) { toast(err.message, 'error'); }
  }));
  list.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', () => {
    // Fire-and-forget read receipt before navigating
    api(`/notifications/${a.dataset.open}/read`, { method: 'POST' }).catch(() => {});
  }));
  renderPagination($('#pager'), meta, (p) => { state.page = p; load(); });
}

$('#read-all').onclick = async (e) => {
  const btn = e.currentTarget;
  setBusy(btn, true, 'Marking…');
  try { await api('/notifications/read-all', { method: 'POST' }); toast('All notifications marked as read.', 'success', 2500); } catch (err) { toast(err.message, 'error'); }
  setBusy(btn, false);
  load();
};
setupTabs($('#tabs'), (t) => { state.tab = t; state.page = 1; load(); });
load();
