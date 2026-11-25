import { api, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import { $, esc, avatar, verifiedBadge, withState, initiativeCardHtml, emptyHtml, fmtDate, params, alertBox } from '../ui.js';

await initPage();
const meta = await getMeta();
const root = $('#root');
const id = params().get('id');

async function load() {
  if (!id) { root.innerHTML = alertBox('error', 'No user specified.'); return; }
  const res = await withState(root, () => api(`/users/${encodeURIComponent(id)}`, { redirectOn401: false }), { onRetry: load });
  if (!res) return;
  const { user: u, hosted, stats } = res.data;
  document.title = `${u.fullName} — GoodNeighbor Health`;
  const chips = (arr) => (arr?.length ? `<div class="chip-list">${arr.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '<span class="muted text-sm">Not shared</span>');
  root.innerHTML = `<div class="layout-sidebar">
    <div class="stack">
      <div class="card"><div class="card-body row" style="gap:20px;align-items:flex-start">
        ${avatar(u, 'avatar-lg')}
        <div class="grow"><h1 class="mb-0">${esc(u.fullName)}</h1>
          <div class="mt-1">${verifiedBadge(u)}${u.verification?.profession ? ` <span class="text-sm muted">· ${esc(u.verification.profession)}</span>` : ''}</div>
          <p class="text-sm muted mt-1 mb-0">${u.city ? `${esc(u.city)} · ` : ''}Member since ${esc(fmtDate(u.createdAt, { month: 'long', year: 'numeric' }))}</p>
          ${u.bio ? `<p class="mt-2 mb-0 pre-line">${esc(u.bio)}</p>` : ''}
        </div></div></div>
      <div><h2>Hosted initiatives</h2>${hosted.length ? `<div class="grid grid-2">${hosted.map((i) => initiativeCardHtml(i, meta, { showRegStatus: false })).join('')}</div>` : `<div class="card">${emptyHtml({ icon: 'clipboard', title: 'No hosted initiatives yet' })}</div>`}</div>
    </div>
    <aside class="stack">
      <div class="card"><div class="card-body stack-sm">
        <div class="row-between"><span class="muted">Initiatives attended</span><strong>${stats.attended}</strong></div>
        <div class="row-between"><span class="muted">Initiatives hosted</span><strong>${stats.hosted}</strong></div>
      </div></div>
      <div class="card"><div class="card-body stack-sm"><h3>Skills</h3>${chips(u.skills)}<h3 class="mt-2">Interests</h3>${chips(u.interests)}</div></div>
    </aside></div>`;
}
load();
