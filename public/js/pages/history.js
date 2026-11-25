import { api, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, withState, emptyHtml, regBadge, payBadge, statusBadge, fmtRange, dateTile, renderPagination, setupTabs, params, categoryLabel, fmtDateTime,
} from '../ui.js';

await initPage({ auth: 'user' });
const meta = await getMeta();
const state = { tab: params().get('tab') || 'upcoming', page: 1 };

function regItem(r) {
  const i = r.initiative;
  if (!i) return '';
  let note = '';
  if (r.status === 'cancelled') note = `Cancelled ${r.cancelledAt ? fmtDateTime(r.cancelledAt) : ''}${r.cancellationReason ? ` — ${r.cancellationReason}` : ''}`;
  if (r.status === 'declined' && r.declineReason) note = `Host's note: ${r.declineReason}`;
  if (r.status === 'attended') note = 'Attendance recorded — thank you for volunteering!';
  return `<li class="list-item" style="align-items:flex-start">${dateTile(i.startAt)}
    <div class="grow"><a href="/initiative.html?id=${esc(i._id)}"><strong>${esc(i.title)}</strong></a>
      <div class="text-sm muted">${esc(categoryLabel(i.category, meta))} · ${esc(fmtRange(i.startAt, i.endAt))}</div>
      <div class="text-sm muted">${esc([i.location?.name, i.location?.city].filter(Boolean).join(', '))}</div>
      <div class="row mt-1" style="gap:6px">${regBadge(r.status)}${r.paymentStatus !== 'not_required' ? payBadge(r.paymentStatus) : ''}${['cancelled', 'completed', 'ongoing'].includes(i.displayStatus) ? statusBadge(i.displayStatus) : ''}</div>
      ${note ? `<div class="text-xs muted mt-1">${esc(note)}</div>` : ''}
    </div></li>`;
}

function hostedItem(i) {
  return `<li class="list-item">${dateTile(i.startAt)}<div class="grow"><a href="/initiative.html?id=${esc(i._id)}"><strong>${esc(i.title)}</strong></a>
    <div class="text-sm muted">${esc(i.startAt ? fmtRange(i.startAt, i.endAt) : 'Not scheduled')}</div><div class="mt-1">${statusBadge(i.displayStatus)}</div></div>
    <a class="btn btn-sm btn-secondary" href="${i.status === 'draft' ? `/initiative-form.html?id=${esc(i._id)}` : `/manage.html?id=${esc(i._id)}`}">${i.status === 'draft' ? 'Edit' : 'Manage'}</a></li>`;
}

async function loadStats() {
  try {
    const { data } = await api('/users/me/dashboard');
    $('#stats').innerHTML = `<div class="row text-sm muted" style="gap:20px"><span><strong style="color:var(--text)">${data.stats.totalRegistrations}</strong> registrations</span><span><strong style="color:var(--text)">${data.stats.attended}</strong> attended</span><span><strong style="color:var(--text)">${data.stats.hosted}</strong> hosted</span></div>`;
  } catch { /* optional */ }
}

async function load() {
  const list = $('#list');
  const pager = $('#pager');
  const isHosted = state.tab === 'hosted';
  const res = await withState(list, () => (isHosted
    ? api('/initiatives/mine', { query: { page: state.page, tab: 'all' } })
    : api('/registrations/me', { query: { scope: state.tab, page: state.page } })), { onRetry: load });
  if (!res) return;
  const { data, meta: m } = res;
  if (!data.length) {
    const t = {
      upcoming: ['No upcoming initiatives', 'Registrations for upcoming initiatives will appear here.', '<a class="btn btn-primary" href="/explore.html">Explore initiatives</a>'],
      past: ['No past initiatives yet', 'Completed and cancelled initiatives you registered for will appear here.', ''],
      all: ['No registrations yet', 'Find an initiative and register to start your volunteer journey.', '<a class="btn btn-primary" href="/explore.html">Explore initiatives</a>'],
      hosted: ["You haven't hosted anything yet", 'Any user can host an initiative.', '<a class="btn btn-primary" href="/initiative-form.html">Create an initiative</a>'],
    }[state.tab];
    list.innerHTML = emptyHtml({ icon: 'history', title: t[0], text: t[1], action: t[2] });
    pager.innerHTML = '';
    return;
  }
  list.innerHTML = `<ul class="list">${data.map(isHosted ? hostedItem : regItem).join('')}</ul>`;
  renderPagination(pager, m, (p) => { state.page = p; load(); });
}

const tabs = setupTabs($('#tabs'), (t) => { state.tab = t; state.page = 1; history.replaceState(null, '', `?tab=${t}`); load(); });
tabs.select(state.tab, false);
loadStats();
load();
