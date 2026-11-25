import { api, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, emptyHtml, statusBadge, fmtRange, categoryLabel, renderPagination, setupTabs, params, alertBox, confirmDialog, toast,
} from '../ui.js';

const user = await initPage({ auth: 'user' });
const meta = await getMeta();
const state = { tab: params().get('tab') || 'all', page: 1 };

function stat(label, value, hint) {
  return `<div class="card stat accent"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}</div>`;
}

async function loadStats() {
  const el = $('#stats');
  const res = await withState(el, () => api('/initiatives/mine/stats'), { onRetry: loadStats });
  if (!res) return;
  const s = res.data;
  const v = user.verification || {};
  const restricted = Object.entries(meta.hostingRules || {}).filter(([c]) => s.canHost && !s.canHost[c]).map(([c]) => categoryLabel(c, meta));
  el.innerHTML = `
    ${restricted.length && v.status !== 'pending' ? `<div class="mb-2">${alertBox('info', `Some categories (${restricted.map(esc).join(', ')}) require professional verification. <a href="/profile.html#verification">Submit your credentials</a>.`)}</div>` : ''}
    <div class="grid grid-4">
      ${stat('Initiatives', s.initiatives.total, `${s.initiatives.upcoming} upcoming · ${s.initiatives.draft} draft${s.initiatives.draft === 1 ? '' : 's'}`)}
      ${stat('Registrations', s.registrations.total, `${s.registrations.approved} approved`)}
      ${stat('Pending actions', s.registrations.pending + s.pendingPayments, `${s.registrations.pending} applications · ${s.pendingPayments} payments`)}
      ${stat('Attendance rate', s.attendance.rate === null ? '—' : `${s.attendance.rate}%`, `${s.attendance.attended} attended · ${s.attendance.absent} absent`)}
    </div>`;
}

function row(i) {
  const c = i.counts || {};
  const pendingApps = c.pending || 0;
  const approved = (c.approved || 0) + (c.attended || 0) + (c.absent || 0);
  const flags = [];
  if (pendingApps) flags.push(`<span class="badge badge-orange">${pendingApps} to review</span>`);
  if (c.pendingPayments) flags.push(`<span class="badge badge-blue">${c.pendingPayments} payment${c.pendingPayments === 1 ? '' : 's'}</span>`);
  return `<tr>
    <td data-label="Initiative"><a href="/initiative.html?id=${esc(i._id)}"><strong>${esc(i.title)}</strong></a><div class="text-xs muted">${esc(categoryLabel(i.category, meta))}${i.organization?.name ? ` · ${esc(i.organization.name)}` : ''}</div></td>
    <td data-label="Schedule" class="text-sm">${esc(i.startAt ? fmtRange(i.startAt, i.endAt) : 'Not scheduled')}</td>
    <td data-label="Status">${statusBadge(i.displayStatus)}</td>
    <td data-label="Volunteers" class="nowrap">${i.status === 'draft' ? '<span class="muted">—</span>' : `<strong>${approved}</strong> <span class="muted">/ ${i.capacity || 0}</span>`}<div class="row mt-1" style="gap:4px">${flags.join('')}</div></td>
    <td class="actions-cell"><div class="row" style="gap:6px;justify-content:flex-end">
      ${i.status === 'draft'
    ? `<a class="btn btn-sm btn-primary" href="/initiative-form.html?id=${esc(i._id)}">Continue</a>`
    : `<a class="btn btn-sm btn-primary" href="/manage.html?id=${esc(i._id)}">Manage</a>${!['cancelled', 'completed'].includes(i.displayStatus) ? `<a class="btn btn-sm btn-secondary" href="/initiative-form.html?id=${esc(i._id)}" aria-label="Edit ${esc(i.title)}">Edit</a>` : ''}`}
      ${['open', 'full', 'closed'].includes(i.displayStatus) ? `<button class="btn btn-sm btn-danger" data-cancel="${esc(i._id)}" data-title="${esc(i.title)}">Cancel</button>` : ''}
    </div></td></tr>`;
}

async function loadList() {
  const el = $('#list');
  const res = await withState(el, () => api('/initiatives/mine', { query: { tab: state.tab, page: state.page } }), { onRetry: loadList });
  if (!res) return;
  const { data, meta: m } = res;
  if (!data.length) {
    const texts = {
      all: ['You haven\'t created any initiatives yet', 'Any user can host. Start with a draft — you can publish when ready.'],
      draft: ['No drafts', 'Drafts you save will appear here.'],
      upcoming: ['No upcoming initiatives', 'Published initiatives that haven\'t started yet will appear here.'],
      ongoing: ['Nothing happening right now', ''],
      completed: ['No completed initiatives yet', ''],
      cancelled: ['No cancelled initiatives', ''],
    }[state.tab];
    el.innerHTML = emptyHtml({ icon: 'clipboard', title: texts[0], text: texts[1], action: state.tab === 'all' || state.tab === 'draft' ? '<a class="btn btn-primary" href="/initiative-form.html">Create an initiative</a>' : '' });
    $('#pager').innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>Initiative</th><th>Schedule</th><th>Status</th><th>Volunteers</th><th class="text-right">Actions</th></tr></thead><tbody>${data.map(row).join('')}</tbody></table></div>`;
  el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    const reason = await confirmDialog({
      title: `Cancel “${b.dataset.title}”?`,
      message: 'All registered volunteers will be notified. Registration, payment and attendance records are kept. This cannot be undone.',
      confirmText: 'Cancel initiative', danger: true,
      input: { label: 'Reason (shared with volunteers)', required: true, min: 5, multiline: true, max: 1000 },
    });
    if (!reason) return;
    try {
      await api(`/initiatives/${b.dataset.cancel}/cancel`, { method: 'POST', body: { reason } });
      toast('Initiative cancelled and volunteers notified.', 'success');
      loadList(); loadStats();
    } catch (err) { toast(err.message, 'error'); }
  }));
  renderPagination($('#pager'), m, (p) => { state.page = p; loadList(); });
}

const tabs = setupTabs($('#tabs'), (t) => {
  state.tab = t; state.page = 1;
  history.replaceState(null, '', t === 'all' ? location.pathname : `?tab=${t}`);
  loadList();
});
tabs.select(state.tab, false);
loadStats();
loadList();
