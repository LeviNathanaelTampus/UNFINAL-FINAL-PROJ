import { api, getMeta, protectedFileUrl } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, emptyHtml, statusBadge, regBadge, payBadge, fmtRange, fmtDateTime, peso, person, alertBox,
  confirmDialog, openModal, toast, setBusy, setupTabs, params, renderPagination, showErrors, clearErrors, loadingHtml, relTime, persistForm,
} from '../ui.js';

await initPage({ auth: 'required' });
const meta = await getMeta();
const id = params().get('id');
const state = { tab: params().get('tab') || 'participants', filter: 'all', payFilter: 'pending', page: 1, init: null, rows: [] };

if (!id) { $('#summary').innerHTML = alertBox('error', 'No initiative specified.'); throw new Error('no id'); }

/* ─── Summary header ─── */
function renderSummary(init, counts) {
  state.init = init;
  const approved = (counts.approved || 0) + (counts.attended || 0) + (counts.absent || 0);
  $('#summary').innerHTML = `
    <div class="page-header">
      <div><div class="row mb-1">${statusBadge(init.displayStatus)}${init.isPaid ? `<span class="badge badge-orange">${peso(init.fee)}</span>` : '<span class="badge badge-green">Free</span>'}</div>
        <h1>${esc(init.title)}</h1><p>${esc(fmtRange(init.startAt, init.endAt))}</p></div>
      <div class="row no-print"><a class="btn btn-secondary" href="/initiative.html?id=${esc(init._id)}">View page</a>${!['cancelled', 'completed'].includes(init.displayStatus) ? `<a class="btn btn-secondary" href="/initiative-form.html?id=${esc(init._id)}">Edit</a>` : ''}</div>
    </div>
    <div class="grid grid-4 mb-3">
      <div class="card stat accent"><div class="stat-label">Slots</div><div class="stat-value">${init.slotsTaken}/${init.capacity}</div><div class="stat-hint">${init.slotsAvailable} available</div></div>
      <div class="card stat accent"><div class="stat-label">Pending</div><div class="stat-value">${counts.pending || 0}</div><div class="stat-hint">${init.requiresApproval ? 'awaiting your review' : 'auto-approved initiative'}</div></div>
      <div class="card stat accent"><div class="stat-label">Approved</div><div class="stat-value">${approved}</div><div class="stat-hint">${counts.declined || 0} declined · ${counts.cancelled || 0} cancelled</div></div>
      <div class="card stat accent"><div class="stat-label">Attendance</div><div class="stat-value">${counts.attended || 0}</div><div class="stat-hint">${counts.absent || 0} absent</div></div>
    </div>`;
  $('#tab-payments').hidden = !init.isPaid;
}

/* ─── Participants ─── */
const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['declined', 'Declined'], ['cancelled', 'Cancelled'], ['attended', 'Attended'], ['absent', 'Absent']];

async function loadParticipants() {
  const panel = $('#panel-participants');
  if (!panel.querySelector('#p-body')) {
    panel.innerHTML = `<div class="card"><div class="card-header">
      <div class="row" role="group" aria-label="Filter by status">${FILTERS.map(([k, l]) => `<button class="btn btn-sm ${k === state.filter ? 'btn-primary' : 'btn-secondary'}" data-filter="${k}">${l}</button>`).join('')}</div>
      <button class="btn btn-sm btn-ghost" id="csv-btn">${icon('file')} Export CSV</button></div><div id="p-body"></div></div><div id="p-pager"></div>`;
    panel.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      state.filter = b.dataset.filter; state.page = 1;
      panel.querySelectorAll('[data-filter]').forEach((x) => { x.className = `btn btn-sm ${x === b ? 'btn-primary' : 'btn-secondary'}`; });
      loadParticipants();
    }));
    $('#csv-btn').onclick = exportCsv;
  }
  const body = $('#p-body');
  const res = await withState(body, () => api(`/initiatives/${id}/participants`, { query: { status: state.filter, page: state.page, limit: 50 } }), { onRetry: loadParticipants });
  if (!res) return;
  const { data, meta: m } = res;
  renderSummary(data.initiative, data.counts);
  state.rows = data.items;
  if (!data.items.length) {
    body.innerHTML = emptyHtml({ icon: 'users', title: state.filter === 'all' ? 'No registrations yet' : `No ${state.filter} registrations`, text: state.filter === 'all' ? 'Share your initiative page so volunteers can find it.' : '' });
    $('#p-pager').innerHTML = '';
    return;
  }
  body.innerHTML = `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>Volunteer</th><th>Contact</th><th>Registered</th><th>Status</th>${data.initiative.isPaid ? '<th>Payment</th>' : ''}<th class="text-right">Actions</th></tr></thead><tbody>
    ${data.items.map((r) => `<tr>
      <td data-label="Volunteer">${person(r.user, { sub: r.user.skills?.slice(0, 3).map(esc).join(', ') })}</td>
      <td data-label="Contact" class="text-sm"><a href="mailto:${esc(r.user.email)}">${esc(r.user.email)}</a>${r.user.phone ? `<div class="muted">${esc(r.user.phone)}</div>` : ''}</td>
      <td data-label="Registered" class="text-sm nowrap">${esc(relTime(r.createdAt))}</td>
      <td data-label="Status">${regBadge(r.status)}</td>
      ${data.initiative.isPaid ? `<td data-label="Payment">${payBadge(r.paymentStatus)}</td>` : ''}
      <td class="actions-cell"><div class="row" style="gap:6px;justify-content:flex-end">
        ${r.status === 'pending' ? `<button class="btn btn-sm btn-success" data-approve="${r._id}">Approve</button><button class="btn btn-sm btn-danger" data-decline="${r._id}">Decline</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-view="${r._id}">Details</button>
      </div></td></tr>`).join('')}
  </tbody></table></div>`;
  body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b, 'approve')));
  body.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => decide(b, 'decline')));
  body.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewRegistration(state.rows.find((r) => r._id === b.dataset.view))));
  renderPagination($('#p-pager'), m, (p) => { state.page = p; loadParticipants(); });
}

async function decide(btn, action) {
  const r = state.rows.find((x) => x._id === (btn.dataset.approve || btn.dataset.decline));
  let body = {};
  if (action === 'decline') {
    const reason = await confirmDialog({ title: `Decline ${r.user.fullName}?`, message: 'Their slot will be released and they will be notified.', confirmText: 'Decline', danger: true, input: { label: 'Reason (optional, shared with the volunteer)', multiline: true, max: 500 } });
    if (reason === false) return;
    body = { reason };
  }
  setBusy(btn, true, '');
  try {
    await api(`/registrations/${r._id}/${action}`, { method: 'POST', body });
    toast(action === 'approve' ? `${r.user.fullName} approved.` : `${r.user.fullName} declined.`, 'success');
    loadParticipants();
  } catch (err) {
    setBusy(btn, false);
    toast(err.message, 'error');
  }
}

function viewRegistration(r) {
  openModal({
    title: r.user.fullName,
    body: `<div class="stack">
      ${person(r.user, { size: 'avatar', sub: esc(r.user.city || '') })}
      <dl class="dl">
        <dt>Email</dt><dd><a href="mailto:${esc(r.user.email)}">${esc(r.user.email)}</a></dd>
        <dt>Phone</dt><dd>${esc(r.user.phone || '—')}</dd>
        <dt>Status</dt><dd>${regBadge(r.status)}</dd>
        ${state.init.isPaid ? `<dt>Payment</dt><dd>${payBadge(r.paymentStatus)}</dd>` : ''}
        <dt>Registered</dt><dd>${esc(fmtDateTime(r.createdAt))}</dd>
        ${r.decidedAt ? `<dt>Decided</dt><dd>${esc(fmtDateTime(r.decidedAt))}</dd>` : ''}
        ${r.declineReason ? `<dt>Decline reason</dt><dd>${esc(r.declineReason)}</dd>` : ''}
        ${r.cancelledAt ? `<dt>Cancelled</dt><dd>${esc(fmtDateTime(r.cancelledAt))}${r.cancellationReason ? ` — ${esc(r.cancellationReason)}` : ''}</dd>` : ''}
        ${r.attendance ? `<dt>Attendance by</dt><dd>${esc(r.attendance.markedBy || '—')} · ${esc(fmtDateTime(r.attendance.markedAt))}</dd>` : ''}
      </dl>
      ${r.user.skills?.length ? `<div><strong class="text-sm">Skills</strong><div class="chip-list mt-1">${r.user.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>` : ''}
      ${r.note ? `<div><strong class="text-sm">Message from volunteer</strong><p class="pre-line text-sm mb-0">${esc(r.note)}</p></div>` : ''}
      <a class="btn btn-secondary btn-sm" href="/user.html?id=${esc(r.user._id)}" target="_blank" rel="noopener">View public profile</a>
    </div>`,
  });
}

function exportCsv() {
  if (!state.rows.length) return toast('Nothing to export.', 'warning');
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // prevent spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Name', 'Email', 'Phone', 'Status', 'Payment', 'Registered', 'Skills', 'Note'];
  const rows = state.rows.map((r) => [r.user.fullName, r.user.email, r.user.phone, r.status, r.paymentStatus, fmtDateTime(r.createdAt), (r.user.skills || []).join('; '), r.note]);
  const csv = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `${(state.init?.title || 'participants').replace(/[^\w\- ]+/g, '').slice(0, 60)} - ${state.filter}.csv`;
  a.click();
  toast('Exported this page of participants. Handle personal data responsibly.', 'info');
}

/* ─── Payments ─── */
async function loadPayments() {
  const panel = $('#panel-payments');
  panel.innerHTML = `<div class="card"><div class="card-header"><div class="row" role="group" aria-label="Filter payments">
    ${[['pending', 'To review'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => `<button class="btn btn-sm ${k === state.payFilter ? 'btn-primary' : 'btn-secondary'}" data-pf="${k}">${l}</button>`).join('')}
    </div></div><div id="pay-body"></div></div>
    <p class="text-xs muted mt-1">Payments are never confirmed automatically. Check each receipt against your GCash / bank records before confirming.</p>`;
  panel.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => { state.payFilter = b.dataset.pf; loadPayments(); }));
  const body = $('#pay-body');
  const res = await withState(body, () => api(`/payments/initiative/${id}`, { query: { status: state.payFilter } }), { onRetry: loadPayments });
  if (!res) return;
  const { items, fee, aiEnabled } = res.data;
  if (!items.length) { body.innerHTML = emptyHtml({ icon: 'wallet', title: state.payFilter === 'pending' ? 'No payments to review' : 'No payments here' }); return; }
  body.innerHTML = `<ul class="list">${items.map((p) => {
    const flags = p.aiAnalysis?.flags || [];
    const ai = !aiEnabled ? '' : p.aiAnalysis?.status === 'done'
      ? (flags.length ? alertBox('warning', `<strong>AI check flagged:</strong><ul class="bullets">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><span class="text-xs">Advisory only — please verify manually.</span>`) : '<span class="text-xs muted">AI pre-check found no inconsistencies (advisory only).</span>')
      : p.aiAnalysis?.status === 'pending' ? '<span class="text-xs muted">AI pre-check running…</span>' : p.aiAnalysis?.status === 'failed' ? '<span class="text-xs muted">AI pre-check unavailable for this receipt.</span>' : '';
    return `<li class="list-item" style="align-items:flex-start;flex-wrap:wrap">
      <div class="grow" style="min-width:240px">
        ${person(p.user, { sub: `Submitted ${esc(relTime(p.createdAt))}` })}
        <dl class="dl mt-2 text-sm">
          <dt>Amount</dt><dd><strong>${peso(p.amount)}</strong>${Number(p.amount) !== Number(fee) ? ' <span class="badge badge-orange">differs from fee</span>' : ''}</dd>
          <dt>Method</dt><dd>${esc(meta.paymentProviders[p.provider] || p.provider)}</dd>
          <dt>Reference</dt><dd><span class="kbd">${esc(p.referenceNumber)}</span></dd>
          ${p.paidAt ? `<dt>Paid on</dt><dd>${esc(fmtDateTime(p.paidAt))}</dd>` : ''}
          ${p.status !== 'pending' ? `<dt>Reviewed</dt><dd>${esc(p.reviewedBy?.fullName || '')} · ${esc(fmtDateTime(p.reviewedAt))}</dd>` : ''}
          ${p.rejectionReason ? `<dt>Reason</dt><dd>${esc(p.rejectionReason)}</dd>` : ''}
        </dl>
        <div class="mt-1">${ai}</div>
      </div>
      <div class="stack-sm" style="min-width:180px">
        <span class="badge ${{ pending: 'badge-blue', confirmed: 'badge-green', rejected: 'badge-red' }[p.status]}">${esc(p.status)}</span>
        <button class="btn btn-sm btn-secondary btn-block" data-receipt="${p._id}">${icon('eye')} View receipt</button>
        ${p.status === 'pending' ? `<button class="btn btn-sm btn-success btn-block" data-confirm="${p._id}">Confirm payment</button><button class="btn btn-sm btn-danger btn-block" data-reject="${p._id}">Reject</button>` : ''}
      </div></li>`;
  }).join('')}</ul>`;
  const find = (pid) => items.find((p) => p._id === pid);
  body.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', () => showReceipt(find(b.dataset.receipt))));
  body.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
    const p = find(b.dataset.confirm);
    const ok = await confirmDialog({ title: 'Confirm this payment?', message: `Only confirm if you have verified that ${peso(p.amount)} with reference ${p.referenceNumber} was received in your account.`, confirmText: 'Yes, I received it' });
    if (!ok) return;
    setBusy(b, true, 'Confirming…');
    try { await api(`/payments/${p._id}/confirm`, { method: 'POST' }); toast('Payment confirmed. The volunteer was notified.', 'success'); loadPayments(); loadParticipants(); } catch (err) { setBusy(b, false); toast(err.message, 'error'); }
  }));
  body.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    const p = find(b.dataset.reject);
    const reason = await confirmDialog({ title: 'Reject this payment?', message: 'The volunteer will be asked to submit a new payment proof.', confirmText: 'Reject payment', danger: true, input: { label: 'Reason (shared with the volunteer)', required: true, min: 3, multiline: true } });
    if (!reason) return;
    setBusy(b, true, 'Rejecting…');
    try { await api(`/payments/${p._id}/reject`, { method: 'POST', body: { reason } }); toast('Payment rejected. The volunteer was notified.', 'success'); loadPayments(); loadParticipants(); } catch (err) { setBusy(b, false); toast(err.message, 'error'); }
  }));
}

async function showReceipt(p) {
  const m = openModal({ title: `Receipt — ${p.user?.fullName || ''}`, size: 'modal-lg', body: loadingHtml('Loading receipt…') });
  try {
    const { url } = await protectedFileUrl(`/payments/${p._id}/receipt`);
    m.el.querySelector('.modal-body').innerHTML = `<img class="receipt-img" src="${url}" alt="Payment receipt"><p class="text-xs muted mt-1 mb-0">Submitted reference: <span class="kbd">${esc(p.referenceNumber)}</span> · Amount ${peso(p.amount)}</p>`;
    m.el.addEventListener('closed', () => URL.revokeObjectURL(url));
  } catch (err) {
    m.el.querySelector('.modal-body').innerHTML = alertBox('error', esc(err.message));
  }
}

/* ─── Attendance ─── */
async function loadAttendance() {
  const panel = $('#panel-attendance');
  const res = await withState(panel, () => api(`/initiatives/${id}/participants`, { query: { status: 'roster', limit: 200 } }), { onRetry: loadAttendance });
  if (!res) return;
  const { items, initiative } = res.data;
  const started = new Date(initiative.startAt) <= new Date();
  const open = started && initiative.displayStatus !== 'cancelled';
  const done = items.filter((r) => ['attended', 'absent'].includes(r.status)).length;
  panel.innerHTML = `
    ${!started ? `<div class="mb-2">${alertBox('info', `Attendance opens when the initiative starts (${esc(fmtDateTime(initiative.startAt))}). Approved volunteers are listed below.`)}</div>` : ''}
    ${initiative.displayStatus === 'cancelled' ? `<div class="mb-2">${alertBox('warning', 'This initiative was cancelled, so attendance cannot be recorded.')}</div>` : ''}
    <div class="card"><div class="card-header"><h3>Roster · ${items.length} approved</h3><div class="row"><span class="text-sm muted">${done}/${items.length} marked</span><button class="btn btn-sm btn-ghost no-print" id="print-btn">Print roster</button></div></div>
    ${items.length ? `<div class="table-wrap"><table class="table table-responsive"><thead><tr><th>#</th><th>Volunteer</th><th>Phone</th><th>Status</th><th class="text-right no-print">Mark</th></tr></thead><tbody>
      ${items.map((r, n) => `<tr><td data-label="#">${n + 1}</td><td data-label="Volunteer">${person(r.user, { link: false })}</td><td data-label="Phone" class="text-sm">${esc(r.user.phone || '—')}</td>
        <td data-label="Status">${regBadge(r.status)}${r.attendance ? `<div class="text-xs muted">by ${esc(r.attendance.markedBy || '—')}, ${esc(relTime(r.attendance.markedAt))}</div>` : ''}</td>
        <td class="actions-cell no-print"><div class="row" style="gap:6px;justify-content:flex-end">
          <button class="btn btn-sm ${r.status === 'attended' ? 'btn-success' : 'btn-secondary'}" data-att="attended" data-rid="${r._id}" ${open ? '' : 'disabled'} aria-pressed="${r.status === 'attended'}">${icon('check')} Attended</button>
          <button class="btn btn-sm ${r.status === 'absent' ? 'btn-danger-solid' : 'btn-secondary'}" data-att="absent" data-rid="${r._id}" ${open ? '' : 'disabled'} aria-pressed="${r.status === 'absent'}">${icon('x')} Absent</button>
        </div></td></tr>`).join('')}
    </tbody></table></div>` : emptyHtml({ icon: 'users', title: 'No approved volunteers yet' })}</div>`;
  $('#print-btn')?.addEventListener('click', () => window.print());
  panel.querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', async () => {
    const r = items.find((x) => x._id === b.dataset.rid);
    if (r.status === b.dataset.att) return;
    if (['attended', 'absent'].includes(r.status)) {
      const ok = await confirmDialog({ title: 'Correct attendance?', message: `Change ${r.user.fullName} from ${r.status} to ${b.dataset.att}? The change is recorded with your name and the time.`, confirmText: 'Correct' });
      if (!ok) return;
    }
    setBusy(b, true, '');
    try {
      await api(`/registrations/${r._id}/attendance`, { method: 'POST', body: { status: b.dataset.att } });
      loadAttendance();
    } catch (err) { setBusy(b, false); toast(err.message, 'error'); }
  }));
}

/* ─── Announcements ─── */
async function loadAnnouncements() {
  const panel = $('#panel-announcements');
  const res = await withState(panel, () => api(`/initiatives/${id}`));
  if (!res) return;
  const init = res.data;
  const canSend = init.status === 'published' && init.displayStatus !== 'cancelled';
  panel.innerHTML = `<div class="layout-sidebar">
    <div class="card"><div class="card-header"><h3>Past announcements</h3></div>
      ${init.announcements?.length ? `<ul class="list">${[...init.announcements].reverse().map((a) => `<li class="list-item" style="display:block"><strong>${esc(a.title)}</strong><div class="text-xs muted">${esc(fmtDateTime(a.createdAt))}</div><p class="pre-line text-sm mt-1 mb-0">${esc(a.message)}</p></li>`).join('')}</ul>` : emptyHtml({ icon: 'megaphone', title: 'No announcements yet', text: 'Announcements are sent as notifications to registered volunteers and shown on the initiative page.' })}
    </div>
    <div class="card"><div class="card-body">
      <h3>Send an announcement</h3>
      ${canSend ? `<form id="ann-form" class="stack" novalidate>
        <div class="field"><label for="ann-title">Title <span class="req">*</span></label><input class="input" id="ann-title" name="title" maxlength="150" placeholder="e.g. Call time moved to 7:30 AM"></div>
        <div class="field"><label for="ann-message">Message <span class="req">*</span></label><textarea class="textarea" id="ann-message" name="message" rows="5" maxlength="3000"></textarea></div>
        <div class="field"><label for="ann-audience">Send to</label><select class="select" id="ann-audience" name="audience"><option value="all">All registered (pending + approved)</option><option value="approved">Approved volunteers only</option></select></div>
        <button class="btn btn-primary" type="submit">${icon('megaphone')} Send announcement</button></form>` : alertBox('info', 'Announcements can be sent for published initiatives that are not cancelled.')}
    </div></div></div>`;
  const form = $('#ann-form');
  if (!form) return;
  const store = persistForm(form, `ann-${id}`);
  store.restore();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const body = { title: form.title.value.trim(), message: form.message.value.trim(), audience: form.audience.value };
    const errs = {};
    if (body.title.length < 3) errs.title = 'Enter a title (at least 3 characters)';
    if (body.message.length < 5) errs.message = 'Enter a message';
    if (showErrors(form, errs)) return;
    const ok = await confirmDialog({ title: 'Send this announcement?', message: 'Volunteers will receive it as a notification (and email, if enabled).', confirmText: 'Send' });
    if (!ok) return;
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true, 'Sending…');
    try {
      const { data } = await api(`/initiatives/${id}/announcements`, { method: 'POST', body });
      store.clear();
      toast(`Announcement sent to ${data.recipients} volunteer${data.recipients === 1 ? '' : 's'}.`, 'success');
      loadAnnouncements();
    } catch (err) { setBusy(btn, false); showErrors(form, err.details); toast(err.message, 'error'); }
  });
}

const loaders = { participants: loadParticipants, payments: loadPayments, attendance: loadAttendance, announcements: loadAnnouncements };
const tabs = setupTabs($('#tabs'), (t) => {
  state.tab = t;
  history.replaceState(null, '', `?id=${encodeURIComponent(id)}&tab=${t}`);
  loaders[t]();
});
await loadParticipants();
if (state.tab !== 'participants') tabs.select(state.tab);
