import { api, getMeta, protectedFileUrl } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, emptyHtml, statusBadge, fmtRange, fmtDateTime, fmtDate, peso, person, alertBox, confirmDialog, openModal, toast,
  setBusy, setupTabs, params, renderPagination, debounce, categoryLabel, relTime, loadingHtml,
} from '../ui.js';

await initPage({ auth: 'admin' });
const meta = await getMeta();
const panel = $('#panel');
const state = { tab: params().get('tab') || 'overview' };

function stat(label, value, hint) {
  return `<div class="card stat accent"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}</div>`;
}

/** Generic filtered + paginated list section. */
function listSection({ filtersHtml, fetch, renderItems, emptyTitle }) {
  let page = 1;
  panel.innerHTML = `<form class="card filters mb-2" id="af" style="grid-template-columns:2fr repeat(3,minmax(0,1fr))" role="search">${filtersHtml}</form><div class="card" id="al"></div><div id="ap"></div>`;
  const form = $('#af');
  const run = async () => {
    const q = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ''));
    const res = await withState($('#al'), () => fetch({ ...q, page }), { onRetry: run });
    if (!res) return;
    if (!res.data.length) { $('#al').innerHTML = emptyHtml({ icon: 'search', title: emptyTitle }); $('#ap').innerHTML = ''; return; }
    $('#al').innerHTML = renderItems(res.data);
    renderPagination($('#ap'), res.meta, (p) => { page = p; run(); });
    bindRow?.(res.data, run);
  };
  let bindRow = null;
  form.addEventListener('input', debounce(() => { page = 1; run(); }, 350));
  form.addEventListener('submit', (e) => e.preventDefault());
  return { run, onBind: (fn) => { bindRow = fn; } };
}

/* ─── Overview ─── */
async function overview() {
  const res = await withState(panel, () => api('/admin/stats'), { onRetry: overview });
  if (!res) return;
  const s = res.data;
  updateVerCount(s.pendingVerifications);
  const p = s.payments || {};
  panel.innerHTML = `
    ${s.pendingVerifications ? `<div class="mb-2">${alertBox('warning', `<strong>${s.pendingVerifications} verification request${s.pendingVerifications === 1 ? '' : 's'}</strong> waiting for review. <button class="link-btn" id="go-ver">Review now</button>`)}</div>` : ''}
    <div class="grid grid-4 mb-3">
      ${stat('Users', s.users.total, `${s.users.newLast30Days} new in 30 days · ${s.users.suspended} suspended`)}
      ${stat('Verified professionals', s.users.verifiedProfessionals, `${s.pendingVerifications} pending review`)}
      ${stat('Published initiatives', s.initiatives.published, `${s.initiatives.upcoming} upcoming · ${s.initiatives.completed} completed`)}
      ${stat('Registrations', s.registrations.total, `${s.registrations.attended || 0} attended`)}
    </div>
    <div class="grid grid-2">
      <div class="card"><div class="card-header"><h3>Initiatives</h3></div><div class="card-body"><dl class="dl">
        <dt>Total (excl. deleted)</dt><dd>${s.initiatives.total}</dd><dt>Drafts</dt><dd>${s.initiatives.drafts}</dd><dt>Published</dt><dd>${s.initiatives.published}</dd>
        <dt>Completed</dt><dd>${s.initiatives.completed}</dd><dt>Cancelled</dt><dd>${s.initiatives.cancelled}</dd><dt>Active organizations</dt><dd>${s.organizations}</dd></dl></div></div>
      <div class="card"><div class="card-header"><h3>Registrations & payments</h3></div><div class="card-body"><dl class="dl">
        ${['pending', 'approved', 'declined', 'cancelled', 'attended', 'absent'].map((k) => `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${s.registrations[k] || 0}</dd>`).join('')}
        <dt>Payments pending</dt><dd>${p.pending?.count || 0}</dd><dt>Payments confirmed</dt><dd>${p.confirmed?.count || 0} (${peso(p.confirmed?.amount || 0)})</dd><dt>Payments rejected</dt><dd>${p.rejected?.count || 0}</dd>
        <dt>Email failures (30d)</dt><dd>${s.emailFailuresLast30Days}${s.emailFailuresLast30Days ? ' <span class="text-xs muted">— in-app notifications were still delivered</span>' : ''}</dd></dl></div></div>
    </div>`;
  $('#go-ver')?.addEventListener('click', () => tabs.select('verifications'));
}

function updateVerCount(n) {
  const b = $('#ver-count');
  b.hidden = !n;
  b.textContent = n;
}

/* ─── Verifications ─── */
function verifications() {
  const sec = listSection({
    filtersHtml: `<div class="field"><label for="vs">Status</label><select class="select" id="vs" name="status"><option value="pending">Pending</option><option value="verified">Approved</option><option value="rejected">Rejected</option><option value="all">All</option></select></div>`,
    fetch: (q) => api('/admin/verifications', { query: q }),
    emptyTitle: 'No verification requests here',
    renderItems: (items) => `<ul class="list">${items.map((v) => `<li class="list-item">
      <div class="grow">${person(v.user, { sub: `${esc(v.user?.email || '')} · submitted ${esc(relTime(v.createdAt))}` })}</div>
      <div class="text-sm" style="min-width:180px"><strong>${esc(v.profession)}</strong><div class="muted">${v.professionalType === 'student' ? `Student${v.school ? ` · ${esc(v.school)}` : ''}` : 'Licensed professional'}</div></div>
      <span class="badge ${{ pending: 'badge-blue', verified: 'badge-green', rejected: 'badge-red' }[v.status]}">${esc(v.status)}</span>
      <button class="btn btn-sm btn-primary" data-review="${v._id}">${v.status === 'pending' ? 'Review' : 'View'}</button></li>`).join('')}</ul>`,
  });
  sec.onBind((items, run) => {
    panel.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => reviewVerification(b.dataset.review, run)));
  });
  sec.run();
}

async function reviewVerification(vid, refresh) {
  const m = openModal({ title: 'Verification request', size: 'modal-lg', body: loadingHtml() });
  let v;
  try { ({ data: v } = await api(`/admin/verifications/${vid}`)); } catch (err) { m.el.querySelector('.modal-body').innerHTML = alertBox('error', esc(err.message)); return; }
  const body = m.el.querySelector('.modal-body');
  body.innerHTML = `<div class="stack">
    ${person(v.user, { size: 'avatar', sub: `${esc(v.user.email)}${v.user.phone ? ` · ${esc(v.user.phone)}` : ''}` })}
    ${alertBox('info', 'Confidential. Verify against the PRC online verification service and the uploaded documents. Do not share or copy these details. AI is never used for this decision.')}
    <dl class="dl">
      <dt>Type</dt><dd>${v.professionalType === 'student' ? 'Medical / health-sciences student' : 'Licensed healthcare professional'}</dd>
      <dt>${v.professionalType === 'student' ? 'Program' : 'Profession'}</dt><dd>${esc(v.profession)}</dd>
      ${v.prcLicenseNumber ? `<dt>PRC license no.</dt><dd><span class="kbd">${esc(v.prcLicenseNumber)}</span></dd>` : ''}
      ${v.licenseExpiry ? `<dt>Valid until</dt><dd>${esc(fmtDate(v.licenseExpiry))}</dd>` : ''}
      ${v.school ? `<dt>School</dt><dd>${esc(v.school)}</dd>` : ''}${v.yearLevel ? `<dt>Year level</dt><dd>${esc(v.yearLevel)}</dd>` : ''}
      ${v.notes ? `<dt>Notes</dt><dd class="pre-line">${esc(v.notes)}</dd>` : ''}
      <dt>Submitted</dt><dd>${esc(fmtDateTime(v.createdAt))}</dd>
      ${v.reviewedAt ? `<dt>Reviewed</dt><dd>${esc(v.reviewedBy?.fullName || '')} · ${esc(fmtDateTime(v.reviewedAt))}</dd>` : ''}
      ${v.rejectionReason ? `<dt>Rejection reason</dt><dd>${esc(v.rejectionReason)}</dd>` : ''}
    </dl>
    <div><strong class="text-sm">Documents</strong><div class="row mt-1">${(v.documents || []).map((d, n) => `<button class="btn btn-sm btn-secondary" data-doc="${d.fileId}">${icon('file')} Document ${n + 1} (${esc((d.contentType || '').split('/')[1] || 'file')})</button>`).join('') || '<span class="muted">None</span>'}</div><div id="doc-view" class="mt-2"></div></div>
  </div>`;
  if (v.status === 'pending') {
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    foot.innerHTML = '<button class="btn btn-danger" id="v-reject">Reject</button><button class="btn btn-success" id="v-approve">Approve & grant badge</button>';
    m.el.querySelector('.modal').appendChild(foot);
    foot.querySelector('#v-approve').onclick = async (e) => {
      const ok = await confirmDialog({ title: 'Approve this verification?', message: `${v.user.fullName} will get a verified badge${v.professionalType === 'licensed' ? ' and can host medical missions' : ''}.`, confirmText: 'Approve' });
      if (!ok) return;
      setBusy(e.target, true, 'Approving…');
      try { await api(`/admin/verifications/${vid}/approve`, { method: 'POST' }); toast('Verification approved.', 'success'); m.close(); refresh(); } catch (err) { setBusy(e.target, false); toast(err.message, 'error'); }
    };
    foot.querySelector('#v-reject').onclick = async (e) => {
      const reason = await confirmDialog({ title: 'Reject verification?', message: 'The user will see your reason and can submit a new request.', confirmText: 'Reject', danger: true, input: { label: 'Reason', required: true, min: 5, multiline: true, max: 1000, placeholder: 'e.g. PRC ID photo is unreadable; please upload a clearer image.' } });
      if (!reason) return;
      setBusy(e.target, true, 'Rejecting…');
      try { await api(`/admin/verifications/${vid}/reject`, { method: 'POST', body: { reason } }); toast('Verification rejected.', 'success'); m.close(); refresh(); } catch (err) { setBusy(e.target, false); toast(err.message, 'error'); }
    };
  }
  const urls = [];
  m.el.addEventListener('closed', () => urls.forEach((u) => URL.revokeObjectURL(u)));
  body.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
    const view = body.querySelector('#doc-view');
    view.innerHTML = loadingHtml('Loading document…');
    try {
      const { url, type } = await protectedFileUrl(`/admin/verifications/${vid}/documents/${b.dataset.doc}`);
      urls.push(url);
      view.innerHTML = type === 'application/pdf'
        ? `<a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener">Open PDF in new tab</a>`
        : `<img class="receipt-img" src="${url}" alt="Verification document">`;
    } catch (err) { view.innerHTML = alertBox('error', esc(err.message)); }
  }));
}

/* ─── Users ─── */
function users() {
  const sec = listSection({
    filtersHtml: `<div class="field"><label for="uq">Search</label><input class="input" id="uq" name="q" type="search" placeholder="Name or email"></div>
      <div class="field"><label for="us">Status</label><select class="select" id="us" name="status"><option value="">Any</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
      <div class="field"><label for="uv">Verification</label><select class="select" id="uv" name="verification"><option value="">Any</option><option value="verified">Verified</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="not_submitted">Not submitted</option></select></div>
      <div class="field"><label for="ur">Role</label><select class="select" id="ur" name="role"><option value="">Any</option><option value="user">User</option><option value="admin">Admin</option></select></div>`,
    fetch: (q) => api('/admin/users', { query: q }),
    emptyTitle: 'No users match',
    renderItems: (items) => `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>User</th><th>Joined</th><th>Role</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>
      ${items.map((u) => `<tr><td data-label="User">${person(u, { sub: esc(u.email) })}</td><td data-label="Joined" class="text-sm">${esc(fmtDate(u.createdAt))}</td>
        <td data-label="Role"><span class="badge ${u.role === 'admin' ? 'badge-dark' : 'badge-outline'}">${esc(u.role)}</span></td>
        <td data-label="Status"><span class="badge ${u.accountStatus === 'active' ? 'badge-green' : 'badge-red'}">${esc(u.accountStatus)}</span></td>
        <td class="actions-cell"><div class="row" style="gap:6px;justify-content:flex-end"><button class="btn btn-sm btn-secondary" data-user="${u._id}">Details</button>
          ${u.role === 'user' ? `<button class="btn btn-sm ${u.accountStatus === 'active' ? 'btn-danger' : 'btn-success'}" data-toggle="${u._id}" data-status="${u.accountStatus}">${u.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div>`,
  });
  sec.onBind((items, run) => {
    panel.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const u = items.find((x) => x._id === b.dataset.toggle);
      const suspend = b.dataset.status === 'active';
      const reason = await confirmDialog({
        title: suspend ? `Suspend ${u.fullName}?` : `Reactivate ${u.fullName}?`,
        message: suspend ? 'They will be logged out and unable to use the platform. Their records are preserved.' : 'They will be able to log in again.',
        confirmText: suspend ? 'Suspend' : 'Reactivate', danger: suspend,
        input: suspend ? { label: 'Reason (kept in the record)', required: true, min: 5, multiline: true } : undefined,
      });
      if (reason === false || (suspend && !reason)) return;
      try { await api(`/admin/users/${u._id}/status`, { method: 'PATCH', body: { status: suspend ? 'suspended' : 'active', reason: suspend ? reason : undefined } }); toast('Account updated.', 'success'); run(); } catch (err) { toast(err.message, 'error'); }
    }));
    panel.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', () => userDetail(b.dataset.user, run)));
  });
  sec.run();
}

async function userDetail(uid, refresh) {
  const m = openModal({ title: 'User details', size: 'modal-lg', body: loadingHtml() });
  try {
    const { data } = await api(`/admin/users/${uid}`);
    const u = data.user;
    m.el.querySelector('.modal-body').innerHTML = `<div class="stack">
      ${person(u, { size: 'avatar', sub: esc(u.email) })}
      <dl class="dl"><dt>Phone</dt><dd>${esc(u.phone || '—')}</dd><dt>City</dt><dd>${esc(u.city || '—')}</dd><dt>Joined</dt><dd>${esc(fmtDateTime(u.createdAt))}</dd><dt>Last login</dt><dd>${esc(u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—')}</dd>
        <dt>Status</dt><dd>${esc(u.accountStatus)}${u.suspendedReason ? ` — ${esc(u.suspendedReason)}` : ''}</dd>
        <dt>Verification</dt><dd>${esc(u.verification?.status || 'not_submitted')}${u.verification?.profession ? ` · ${esc(u.verification.profession)}` : ''} ${u.verification?.status === 'verified' ? '<button class="link-btn text-sm" id="revoke">Revoke</button>' : ''}</dd>
        <dt>Hosted</dt><dd>${data.hosted}</dd><dt>Registrations</dt><dd>${Object.entries(data.registrations).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ') || '0'}</dd></dl>
      <div><strong class="text-sm">Recent activity</strong>${data.activity.length ? `<ul class="list text-sm">${data.activity.map((a) => `<li class="list-item" style="padding:8px 0"><span class="kbd">${esc(a.action)}</span><span class="grow"></span><span class="muted">${esc(fmtDateTime(a.createdAt))}</span></li>`).join('')}</ul>` : '<p class="muted text-sm">No activity recorded.</p>'}</div></div>`;
    m.el.querySelector('#revoke')?.addEventListener('click', async () => {
      const reason = await confirmDialog({ title: 'Revoke verified status?', message: 'The badge will be removed and the user notified.', confirmText: 'Revoke', danger: true, input: { label: 'Reason', required: true, min: 5 } });
      if (!reason) return;
      try { await api(`/admin/users/${uid}/revoke-verification`, { method: 'POST', body: { reason } }); toast('Verification revoked.', 'success'); m.close(); refresh(); } catch (err) { toast(err.message, 'error'); }
    });
  } catch (err) { m.el.querySelector('.modal-body').innerHTML = alertBox('error', esc(err.message)); }
}

/* ─── Initiatives ─── */
function initiatives() {
  const sec = listSection({
    filtersHtml: `<div class="field"><label for="iq">Search title</label><input class="input" id="iq" name="q" type="search"></div>
      <div class="field"><label for="is">Status</label><select class="select" id="is" name="status"><option value="published">Published</option><option value="draft">Drafts</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></div>
      <div class="field"><label for="ic">Category</label><select class="select" id="ic" name="category"><option value="">All</option>${Object.entries(meta.categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label class="check" style="margin-top:28px"><input type="checkbox" name="includeDeleted" value="true"> Include deleted drafts</label></div>`,
    fetch: (q) => api('/admin/initiatives', { query: q }),
    emptyTitle: 'No initiatives match',
    renderItems: (items) => `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>Initiative</th><th>Host</th><th>Schedule</th><th>Status</th><th>Slots</th><th class="text-right">Actions</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td data-label="Initiative"><a href="/initiative.html?id=${esc(i._id)}"><strong>${esc(i.title)}</strong></a><div class="text-xs muted">${esc(categoryLabel(i.category, meta))}</div></td>
        <td data-label="Host">${person(i.host, { sub: esc(i.hostEmail || '') })}</td><td data-label="Schedule" class="text-sm">${esc(i.startAt ? fmtRange(i.startAt, i.endAt) : '—')}</td>
        <td data-label="Status">${statusBadge(i.deletedAt ? 'deleted' : i.displayStatus)}</td><td data-label="Slots">${i.slotsTaken || 0}/${i.capacity || 0}</td>
        <td class="actions-cell"><div class="row" style="gap:6px;justify-content:flex-end"><a class="btn btn-sm btn-secondary" href="/manage.html?id=${esc(i._id)}">Participants</a>
          ${['open', 'full', 'closed', 'ongoing'].includes(i.displayStatus) ? `<button class="btn btn-sm btn-danger" data-mod="${i._id}">Cancel</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div>`,
  });
  sec.onBind((items, run) => {
    panel.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', async () => {
      const i = items.find((x) => x._id === b.dataset.mod);
      const reason = await confirmDialog({ title: `Cancel “${i.title}”?`, message: 'Use this for content that violates platform rules. The host and all registered volunteers are notified; records are preserved.', confirmText: 'Cancel initiative', danger: true, input: { label: 'Moderation reason', required: true, min: 5, multiline: true } });
      if (!reason) return;
      try { await api(`/initiatives/${i._id}/cancel`, { method: 'POST', body: { reason } }); toast('Initiative cancelled.', 'success'); run(); } catch (err) { toast(err.message, 'error'); }
    }));
  });
  sec.run();
}

/* ─── Organizations ─── */
function organizations() {
  const sec = listSection({
    filtersHtml: `<div class="field"><label for="oq">Search</label><input class="input" id="oq" name="q" type="search"></div>
      <div class="field"><label for="os">Status</label><select class="select" id="os" name="status"><option value="all">All</option><option value="active">Active</option><option value="deactivated">Deactivated</option></select></div>`,
    fetch: (q) => api('/admin/organizations', { query: q }),
    emptyTitle: 'No organizations',
    renderItems: (items) => `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>Organization</th><th>Created by</th><th>Members</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>
      ${items.map((o) => `<tr><td data-label="Organization"><a href="/organization.html?id=${esc(o._id)}"><strong>${esc(o.name)}</strong></a><div class="text-xs muted">${esc(meta.organizationTypes[o.type] || '')}</div></td>
        <td data-label="Created by" class="text-sm">${esc(o.createdBy?.fullName || '—')}<div class="muted">${esc(o.createdBy?.email || '')}</div></td><td data-label="Members">${o.memberCount}</td>
        <td data-label="Status"><span class="badge ${o.status === 'active' ? 'badge-green' : 'badge-red'}">${esc(o.status)}</span> <span class="badge ${o.verificationStatus === 'verified' ? 'badge-blue' : 'badge-outline'}">${esc(o.verificationStatus)}</span></td>
        <td class="actions-cell"><div class="row" style="gap:6px;justify-content:flex-end">
          <button class="btn btn-sm btn-secondary" data-ver="${o._id}" data-v="${o.verificationStatus}">${o.verificationStatus === 'verified' ? 'Unverify' : 'Verify'}</button>
          <button class="btn btn-sm ${o.status === 'active' ? 'btn-danger' : 'btn-success'}" data-st="${o._id}" data-s="${o.status}">${o.status === 'active' ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>`).join('')}
    </tbody></table></div>`,
  });
  sec.onBind((items, run) => {
    panel.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
      const next = b.dataset.v === 'verified' ? 'unverified' : 'verified';
      try { await api(`/admin/organizations/${b.dataset.ver}`, { method: 'PATCH', body: { verificationStatus: next } }); toast('Organization updated.', 'success'); run(); } catch (err) { toast(err.message, 'error'); }
    }));
    panel.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
      const deactivate = b.dataset.s === 'active';
      const reason = await confirmDialog({ title: deactivate ? 'Deactivate organization?' : 'Reactivate organization?', message: deactivate ? 'Members can no longer host under it. Past initiatives remain in the record.' : 'Members will be able to host under it again.', confirmText: deactivate ? 'Deactivate' : 'Reactivate', danger: deactivate, input: deactivate ? { label: 'Reason', required: true, min: 5 } : undefined });
      if (reason === false || (deactivate && !reason)) return;
      try { await api(`/admin/organizations/${b.dataset.st}`, { method: 'PATCH', body: { status: deactivate ? 'deactivated' : 'active', reason: deactivate ? reason : undefined } }); toast('Organization updated.', 'success'); run(); } catch (err) { toast(err.message, 'error'); }
    }));
  });
  sec.run();
}

/* ─── Payments monitor ─── */
function payments() {
  listSection({
    filtersHtml: `<div class="field"><label for="ps">Status</label><select class="select" id="ps" name="status"><option value="all">All</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option></select></div>`,
    fetch: (q) => api('/admin/payments', { query: q }),
    emptyTitle: 'No payments',
    renderItems: (items) => `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>Initiative</th><th>Volunteer</th><th>Amount</th><th>Method</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
      ${items.map((p) => `<tr><td data-label="Initiative">${p.initiative ? `<a href="/initiative.html?id=${esc(p.initiative._id)}">${esc(p.initiative.title)}</a>` : '—'}</td><td data-label="Volunteer">${esc(p.user?.fullName || '—')}</td>
        <td data-label="Amount">${peso(p.amount)}</td><td data-label="Method">${esc(meta.paymentProviders[p.provider] || p.provider)}</td>
        <td data-label="Status"><span class="badge ${{ pending: 'badge-blue', confirmed: 'badge-green', rejected: 'badge-red' }[p.status]}">${esc(p.status)}</span>${p.aiAnalysis?.flags?.length ? ' <span class="badge badge-orange" title="AI pre-check flags">flagged</span>' : ''}</td>
        <td data-label="Submitted" class="text-sm">${esc(fmtDateTime(p.createdAt))}</td></tr>`).join('')}
    </tbody></table></div><p class="text-xs muted" style="padding:0 16px 12px">Hosts confirm payments for their own initiatives. Reference numbers and receipts are visible only to the host.</p>`,
  }).run();
}

/* ─── Activity log ─── */
function activity() {
  listSection({
    filtersHtml: `<div class="field"><label for="aa">Action</label><select class="select" id="aa" name="action"><option value="">All actions</option>
      ${['user.', 'initiative.', 'registration.', 'payment.', 'attendance.', 'verification.', 'organization.', 'admin.', 'ai.'].map((a) => `<option value="${a}">${a.replace('.', '')}</option>`).join('')}</select></div>`,
    fetch: (q) => api('/admin/activity', { query: q }),
    emptyTitle: 'No activity',
    renderItems: (items) => `<ul class="list">${items.map((a) => `<li class="list-item text-sm"><span class="kbd">${esc(a.action)}</span><span class="grow">${esc(a.actor?.fullName || 'System')}${a.actor?.role === 'admin' ? ' <span class="badge badge-dark">admin</span>' : ''}${a.resourceType ? ` <span class="muted">→ ${esc(a.resourceType)}</span>` : ''}</span><span class="muted nowrap" title="${esc(fmtDateTime(a.createdAt))}">${esc(relTime(a.createdAt))}</span></li>`).join('')}</ul>`,
  }).run();
}

const sections = { overview, verifications, users, initiatives, organizations, payments, activity };
const tabs = setupTabs($('#tabs'), (t) => { state.tab = t; history.replaceState(null, '', `?tab=${t}`); sections[t](); });
tabs.select(state.tab);
if (state.tab !== 'overview') api('/admin/stats').then(({ data }) => updateVerCount(data.pendingVerifications)).catch(() => {});
