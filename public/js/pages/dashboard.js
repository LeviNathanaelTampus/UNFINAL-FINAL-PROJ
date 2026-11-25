import { api, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, initiativeCardHtml, emptyHtml, regBadge, payBadge, fmtRange, dateTile, relTime, peso, alertBox,
} from '../ui.js';

const user = await initPage({ auth: 'user' });
const meta = await getMeta();
$('#welcome').textContent = `Welcome, ${user.fullName.split(' ')[0]}!`;

const root = $('#dash');

function stat(label, value, hint, href) {
  const inner = `<div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}`;
  return href ? `<a class="card stat accent" href="${href}" style="color:inherit;text-decoration:none">${inner}</a>` : `<div class="card stat accent">${inner}</div>`;
}

async function load() {
  const res = await withState(root, () => api('/users/me/dashboard'), { onRetry: load });
  if (!res) return;
  const d = res.data;
  const v = user.verification?.status;

  const verifyNudge = !v || v === 'not_submitted'
    ? alertBox('info', `<strong>Are you a healthcare professional or student?</strong> <a href="/profile.html#verification">Submit your credentials</a> to get a verified badge and host medical missions.`)
    : v === 'pending' ? alertBox('info', 'Your professional verification is under review by the administrators.') : '';

  const upcoming = d.upcoming.length
    ? `<ul class="list">${d.upcoming.map((r) => `<li class="list-item">${dateTile(r.initiative.startAt)}
        <div class="grow"><a href="/initiative.html?id=${esc(r.initiative._id)}"><strong>${esc(r.initiative.title)}</strong></a>
          <div class="text-sm muted">${esc(fmtRange(r.initiative.startAt, r.initiative.endAt))} · ${esc(r.initiative.location?.name || '')}</div>
          <div class="row mt-1" style="gap:6px">${regBadge(r.status)} ${r.paymentStatus !== 'not_required' ? payBadge(r.paymentStatus) : ''}</div></div></li>`).join('')}</ul>`
    : emptyHtml({ icon: 'calendar', title: 'No upcoming initiatives', text: "You haven't registered for anything coming up yet.", action: '<a class="btn btn-primary" href="/explore.html">Find an initiative</a>' });

  const payments = d.paymentAttention.length
    ? `<ul class="list">${d.paymentAttention.map((p) => `<li class="list-item"><div class="grow"><a href="/initiative.html?id=${esc(p.initiative._id)}"><strong>${esc(p.initiative.title)}</strong></a><div class="text-sm muted">Fee: ${peso(p.initiative.fee)}</div></div>${payBadge(p.paymentStatus)}</li>`).join('')}</ul>`
    : `<div class="card-body text-sm muted">No payments need your attention.</div>`;

  const notifs = d.notifications.latest.length
    ? `<ul class="list">${d.notifications.latest.map((n) => `<li class="list-item ${n.read ? '' : 'unread'}">${n.read ? '' : '<span class="dot" aria-label="Unread"></span>'}<div class="grow"><a href="${esc(n.link || '/notifications.html')}" style="color:inherit"><strong class="text-sm">${esc(n.title)}</strong></a><div class="text-xs muted">${esc(relTime(n.createdAt))}</div></div></li>`).join('')}</ul>`
    : `<div class="card-body text-sm muted">You're all caught up.</div>`;

  root.innerHTML = `
    ${verifyNudge ? `<div class="mb-3">${verifyNudge}</div>` : ''}
    <div class="grid grid-4 mb-3">
      ${stat('Upcoming', d.stats.upcoming, 'approved registrations', '/history.html?tab=upcoming')}
      ${stat('Pending', d.stats.pending, 'awaiting host approval', '/history.html?tab=upcoming')}
      ${stat('Attended', d.stats.attended, `${d.stats.totalRegistrations} total registrations`, '/history.html?tab=past')}
      ${stat('Hosted', d.stats.hosted, 'initiatives you created', '/host.html')}
    </div>
    <div class="layout-sidebar">
      <div class="stack">
        <div class="card"><div class="card-header"><h2>Your upcoming initiatives</h2><a href="/history.html" class="text-sm">View history</a></div>${upcoming}</div>
        <div>
          <div class="row-between mb-2"><h2 class="mb-0">Recently published</h2><a href="/explore.html?sort=newest" class="text-sm">See more</a></div>
          ${d.recentInitiatives.length ? `<div class="grid grid-2">${d.recentInitiatives.slice(0, 4).map((i) => initiativeCardHtml(i, meta)).join('')}</div>` : `<div class="card">${emptyHtml({ icon: 'search', title: 'Nothing new yet', text: 'Check back soon for new initiatives.' })}</div>`}
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-header"><h3>${icon('wallet')} Payments</h3></div>${payments}</div>
        <div class="card"><div class="card-header"><h3>Notifications ${d.notifications.unread ? `<span class="badge badge-red">${d.notifications.unread} new</span>` : ''}</h3><a href="/notifications.html" class="text-sm">All</a></div>${notifs}</div>
        <div class="card"><div class="card-body stack-sm">
          <h3>Quick actions</h3>
          <a href="/explore.html" class="btn btn-secondary btn-block">${icon('search')} Explore initiatives</a>
          <a href="/initiative-form.html" class="btn btn-secondary btn-block">${icon('plus')} Create an initiative</a>
          <a href="/host.html" class="btn btn-secondary btn-block">${icon('clipboard')} Host dashboard</a>
          <a href="/profile.html" class="btn btn-secondary btn-block">${icon('user')} Edit profile</a>
        </div></div>
      </div>
    </div>`;
}
load();
