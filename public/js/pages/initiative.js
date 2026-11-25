import { api, getMeta, session, imageUrl } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, statusBadge, regBadge, payBadge, fmtRange, fmtDateTime, peso, categoryLabel, person, alertBox,
  confirmDialog, openModal, toast, setBusy, showErrors, params, relTime, toLocalParts, fromLocalParts,
} from '../ui.js';
import { showLocation, osmLink } from '../map.js';
import { mountChat } from '../chat.js';

let chatCtl = null;
const CHAT_MEMBER = ['approved', 'attended', 'absent'];
/** 'member' | 'locked' (registered, awaiting approval) | null (no chat UI) */
function chatAccess(i) {
  if (i.status === 'draft' || !session.user) return null;
  const vw = i.viewer;
  if (vw.isHost || vw.isAdmin) return 'member';
  const s = vw.myRegistration?.status;
  if (CHAT_MEMBER.includes(s)) return 'member';
  if (s === 'pending') return 'locked';
  return null;
}
/* ─── Popup chat (floating button + window) ─── */
let unreadTimer = null;
function teardownChat() {
  chatCtl?.destroy();
  chatCtl = null;
  clearInterval(unreadTimer);
  document.querySelectorAll('.chat-fab, .chat-pop').forEach((n) => n.remove());
  document.body.classList.remove('has-chat-fab', 'chat-open');
}
function setupChatPopup(i) {
  teardownChat();
  if (chatAccess(i) !== 'member') return;
  document.body.classList.add('has-chat-fab');
  document.body.insertAdjacentHTML('beforeend', `
    <button type="button" class="chat-fab" id="chat-fab" aria-label="Open group chat" aria-expanded="false" aria-controls="chat-pop">${icon('chat')}<span class="chat-badge" id="chat-unread" hidden></span></button>
    <div class="chat-pop" id="chat-pop" role="dialog" aria-label="Group chat" hidden><div id="chat-mount"></div></div>`);
  const fab = $('#chat-fab');
  const pop = $('#chat-pop');

  const setBadge = (n) => {
    for (const b of document.querySelectorAll('#chat-unread, #chat-unread-side')) { b.textContent = n > 99 ? '99+' : n; b.hidden = !n; }
  };
  const refreshUnread = () => {
    if (!pop.hidden || document.hidden) return;
    api('/chat/unread', { redirectOn401: false })
      .then(({ data }) => setBadge(data.chats.find((x) => String(x.initiative) === String(i._id))?.unread || 0))
      .catch(() => {});
  };

  const open = () => {
    pop.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-open');
    setBadge(0);
    // Mount on open so messages only count as read when the chat is actually seen
    chatCtl = mountChat($('#chat-mount'), { initiativeId: i._id, title: i.title, subtitle: 'Group chat', onClose: close });
    setTimeout(() => chatCtl?.focus(), 150);
  };
  const close = () => {
    chatCtl?.destroy();
    chatCtl = null;
    pop.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('chat-open');
    fab.focus({ preventScroll: true });
  };
  const toggle = () => (pop.hidden ? open() : close());

  fab.onclick = toggle;
  $('#chat-open-side')?.addEventListener('click', () => (pop.hidden ? open() : chatCtl?.focus()));
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  refreshUnread();
  unreadTimer = setInterval(refreshUnread, 20000);
  if (location.hash === '#chat') open();
}

await initPage();
const meta = await getMeta();
const root = $('#root');
const id = params().get('id');

const list = (items, cls = 'bullets') => (items?.length ? `<ul class="${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');

function section(title, body) {
  return body ? `<div class="card"><div class="card-body"><h2 class="mb-1" style="font-size:1.1rem">${esc(title)}</h2>${body}</div></div>` : '';
}

const CLOSED_REASONS = {
  full: 'All slots have been filled.',
  closed: 'The registration deadline has passed.',
  ongoing: 'This initiative has already started.',
  completed: 'This initiative has ended.',
  cancelled: 'This initiative was cancelled.',
  draft: 'This initiative is not published yet.',
};

function actionPanel(i) {
  const vw = i.viewer;
  const reg = vw.myRegistration;
  const loginNext = encodeURIComponent(location.pathname + location.search);

  if (vw.isHost) {
    return `<div class="stack-sm">
      ${alertBox('info', 'You are the host of this initiative.')}
      <a class="btn btn-primary btn-block" href="/manage.html?id=${esc(i._id)}">${icon('users')} Manage participants</a>
      ${!['cancelled', 'completed'].includes(i.displayStatus) ? `<a class="btn btn-secondary btn-block" href="/initiative-form.html?id=${esc(i._id)}">${icon('edit')} Edit initiative</a>` : ''}
    </div>`;
  }
  if (vw.isAdmin) {
    return `<div class="stack-sm">${alertBox('info', 'You are viewing as an administrator.')}
      ${!['cancelled', 'completed', 'draft'].includes(i.displayStatus) ? '<button class="btn btn-danger btn-block" id="admin-cancel">Cancel initiative (moderation)</button>' : ''}
      <a class="btn btn-secondary btn-block" href="/manage.html?id=${esc(i._id)}">View participants</a></div>`;
  }
  if (!session.user) {
    return i.displayStatus === 'open'
      ? `<a class="btn btn-primary btn-block btn-lg" href="/login.html?next=${loginNext}">Log in to register</a><p class="text-sm muted text-center mt-1 mb-0">New here? <a href="/register.html">Create a free account</a></p>`
      : `<button class="btn btn-secondary btn-block" disabled>Registration unavailable</button><p class="text-sm muted mt-1 mb-0">${esc(CLOSED_REASONS[i.displayStatus] || '')}</p>`;
  }

  const active = reg && ['pending', 'approved', 'attended', 'absent'].includes(reg.status);
  if (active) {
    const isPaid = i.payment?.isPaid;
    const lp = reg.latestPayment;
    const canPay = isPaid && ['pending', 'approved'].includes(reg.status) && ['unpaid', 'rejected'].includes(reg.paymentStatus) && !['cancelled', 'completed'].includes(i.displayStatus);
    const canCancel = ['pending', 'approved'].includes(reg.status) && new Date(i.startAt) > new Date();
    return `<div class="stack-sm">
      <div class="row-between"><strong>Your registration</strong>${regBadge(reg.status)}</div>
      ${reg.status === 'pending' ? '<p class="text-sm muted mb-0">Your slot is reserved. The host will review your application.</p>' : ''}
      ${reg.status === 'approved' ? '<p class="text-sm muted mb-0">You are confirmed for this initiative. Check the preparation checklist below.</p>' : ''}
      ${isPaid ? `<div class="row-between"><span class="text-sm">Payment</span>${payBadge(reg.paymentStatus)}</div>` : ''}
      ${reg.paymentStatus === 'rejected' && lp?.rejectionReason ? alertBox('error', `Host's note: ${esc(lp.rejectionReason)}`) : ''}
      ${reg.paymentStatus === 'pending' ? '<p class="text-xs muted mb-0">Submitted payments stay pending until the host manually verifies them.</p>' : ''}
      ${canPay ? `<button class="btn btn-primary btn-block" id="pay-btn">${icon('upload')} Submit payment proof</button>` : ''}
      ${canCancel ? '<button class="btn btn-danger btn-block" id="cancel-reg">Cancel my registration</button>' : ''}
      <p class="text-xs muted mb-0">Registered ${esc(relTime(reg.createdAt))}</p>
    </div>`;
  }

  const prev = reg && ['cancelled', 'declined'].includes(reg.status)
    ? `<p class="text-sm muted">Your previous registration was ${esc(reg.status)}${reg.declineReason ? `: ${esc(reg.declineReason)}` : ''}.</p>`
    : '';
  if (i.displayStatus === 'open') {
    if (vw.isHost) return '';
    return `${prev}<button class="btn btn-primary btn-block btn-lg" id="register-btn">${reg ? 'Register again' : 'Register as volunteer'}</button>
      <p class="text-xs muted text-center mt-1 mb-0">${i.requiresApproval ? 'The host reviews each application.' : 'Registration is confirmed immediately.'}${i.payment?.isPaid ? ` Registration fee: ${peso(i.payment.fee)}.` : ''}</p>`;
  }
  return `${prev}<button class="btn btn-secondary btn-block" disabled>Registration unavailable</button><p class="text-sm muted mt-1 mb-0">${esc(CLOSED_REASONS[i.displayStatus] || '')}</p>`;
}

function paymentCard(i) {
  const p = i.payment;
  if (!p?.isPaid) return '';
  return `<div class="card"><div class="card-header"><h3>${icon('wallet')} Payment details</h3><strong>${peso(p.fee)}</strong></div><div class="card-body stack-sm text-sm">
    ${p.instructions ? `<p class="pre-line mb-0">${esc(p.instructions)}</p>` : ''}
    ${p.gcashNumber ? `<div><strong>GCash</strong><div>${esc(p.gcashName || '')} · <span class="kbd">${esc(p.gcashNumber)}</span></div></div>` : ''}
    ${p.qrImage ? `<div><strong>QR Ph / GCash QR</strong><img class="qr-img mt-1" src="${imageUrl(p.qrImage)}" alt="Payment QR code"></div>` : ''}
    ${p.bankInstructions ? `<div><strong>Online banking</strong><p class="pre-line mb-0">${esc(p.bankInstructions)}</p></div>` : ''}
    <p class="text-xs muted mb-0">Only pay through the details shown here. After paying, submit your receipt and reference number for the host to verify.</p>
  </div></div>`;
}

function render(i) {
  document.title = `${i.title} — GoodNeighbor Health`;
  const c = i.coordinates;
  const taken = i.slotsTaken || 0;
  const pct = i.capacity ? Math.min(100, Math.round((taken / i.capacity) * 100)) : 0;
  const vw = i.viewer;

  const banners = [];
  if (i.status === 'draft') {
    const probs = Object.values(i.publishProblems || {});
    banners.push(alertBox('warning', `<strong>Draft — only you can see this.</strong>${probs.length ? `<p class="mb-0">Before publishing: ${probs.map(esc).join(' · ')}</p>` : '<p class="mb-0">Everything looks ready.</p>'}
      <div class="row mt-1"><a class="btn btn-sm btn-secondary" href="/initiative-form.html?id=${esc(i._id)}">Continue editing</a>${probs.length ? '' : '<button class="btn btn-sm btn-primary" id="publish-btn">Publish now</button>'}</div>`));
  }
  if (i.status === 'cancelled') banners.push(alertBox('error', `<strong>This initiative was cancelled</strong>${i.cancelledAt ? ` on ${esc(fmtDateTime(i.cancelledAt))}` : ''}.${i.cancellationReason ? `<p class="mb-0">Reason: ${esc(i.cancellationReason)}</p>` : ''}`));
  if (vw.isHost && vw.canHostCategory === false) banners.push(alertBox('warning', esc(meta.hostingRules?.[i.category]?.message || 'Your account is not verified to host this category.')));

  const ann = i.announcements?.length
    ? `<div class="card"><div class="card-header"><h3>${icon('megaphone')} Announcements</h3></div><ul class="list">${[...i.announcements].reverse().map((a) => `<li class="list-item" style="display:block"><strong>${esc(a.title)}</strong><div class="text-xs muted">${esc(fmtDateTime(a.createdAt))}</div><p class="pre-line text-sm mt-1 mb-0">${esc(a.message)}</p></li>`).join('')}</ul></div>`
    : '';

  root.innerHTML = `
    <nav class="text-sm mb-2"><a href="/explore.html">← Back to Explore</a></nav>
    ${banners.map((b) => `<div class="mb-2">${b}</div>`).join('')}
    <div class="detail-cover">${i.coverImage ? `<img src="${imageUrl(i.coverImage)}" alt="">` : '<div class="pattern"></div>'}</div>
    <div class="layout-sidebar">
      <div class="stack">
        <div>
          <div class="row mb-1"><span class="i-cat">${esc(categoryLabel(i.category, meta))}</span>${statusBadge(i.displayStatus)}<span class="badge ${i.payment?.isPaid ? 'badge-orange' : 'badge-green'}">${i.payment?.isPaid ? peso(i.payment.fee) : 'Free'}</span></div>
          <h1>${esc(i.title)}</h1>
          <div class="row mt-2" style="gap:18px">
            ${person(i.host, { size: '', sub: 'Host' })}
            ${i.organization?.name ? `<div class="person"><span class="avatar">${i.organization.logo ? `<img src="${imageUrl(i.organization.logo)}" alt="">` : icon('building')}</span><div><a class="person-name" href="/organization.html?id=${esc(i.organization._id)}">${esc(i.organization.name)}</a>${i.organization.verificationStatus === 'verified' ? ` <span class="verified" title="Verified organization">${icon('shieldCheck')}</span>` : ''}<div class="text-xs muted">Organization</div></div></div>` : ''}
          </div>
        </div>
        ${section('About this initiative', i.description ? `<p class="pre-line mb-0">${esc(i.description)}</p>` : '<p class="muted mb-0">No description yet.</p>')}
        ${ann}
        ${section('Volunteer requirements', `${list(i.requirements)}${i.requiredSkills?.length ? `<div class="mt-2"><strong class="text-sm">Skills needed</strong><div class="chip-list mt-1">${i.requiredSkills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>` : ''}${i.eligibility ? `<p class="mt-2 mb-0"><strong class="text-sm">Eligibility:</strong> ${esc(i.eligibility)}</p>` : ''}`)}
        ${section('How to register', i.registrationInstructions ? `<p class="pre-line mb-0">${esc(i.registrationInstructions)}</p>` : '')}
        ${section('Preparation checklist', list(i.checklist, 'checklist'))}
        ${section('Important reminders', list(i.reminders))}
        <div class="card"><div class="card-body">
          <h2 class="mb-1" style="font-size:1.1rem">Location</h2>
          <p class="mb-2"><strong>${esc(i.location?.name || 'To be announced')}</strong><br><span class="muted">${esc([i.location?.address, i.location?.city, i.location?.province].filter(Boolean).join(', '))}</span></p>
          <div id="detail-map" class="map"></div>
          ${c ? `<p class="text-xs muted mt-1 mb-0">Coordinates: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · <a href="${osmLink(c.lat, c.lng)}" target="_blank" rel="noopener">Open in OpenStreetMap</a></p>` : ''}
        </div></div>
      </div>

      <aside class="stack sticky">
        <div class="card"><div class="card-body stack">
          <div class="info-row"><div class="icon-circle">${icon('calendar')}</div><div><strong>${esc(fmtRange(i.startAt, i.endAt))}</strong><span class="text-sm muted">${i.registrationDeadline ? `Register by ${esc(fmtDateTime(i.registrationDeadline))}` : 'Register before it starts'}</span></div></div>
          <div class="info-row"><div class="icon-circle">${icon('pin')}</div><div><strong>${esc(i.location?.name || 'To be announced')}</strong><span class="text-sm muted">${esc(i.location?.city || '')}</span></div></div>
          <div class="info-row"><div class="icon-circle">${icon('users')}</div><div class="grow"><strong>${Math.max(0, (i.capacity || 0) - taken)} of ${i.capacity || 0} slots available</strong><div class="slots-bar"><span class="${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}" style="width:${pct}%"></span></div></div></div>
          <div id="action">${actionPanel(i)}</div>
          ${chatAccess(i) === 'member' ? `<button type="button" class="btn btn-secondary btn-block" id="chat-open-side">${icon('chat')} Open group chat <span class="chat-badge" id="chat-unread-side" hidden></span></button>` : ''}
          ${chatAccess(i) === 'locked' ? `<p class="text-xs muted mb-0 row" style="gap:6px;flex-wrap:nowrap">${icon('chat')} The group chat unlocks once the host approves your registration.</p>` : ''}
        </div></div>
        ${paymentCard(i)}
        ${i.contact && (i.contact.name || i.contact.phone || i.contact.email) ? `<div class="card"><div class="card-body text-sm stack-sm"><h3>Contact</h3>
          ${i.contact.name ? `<div>${icon('user', 'muted')} ${esc(i.contact.name)}</div>` : ''}
          ${i.contact.phone ? `<div>${esc(i.contact.phone)}</div>` : ''}
          ${i.contact.email ? `<div><a href="mailto:${esc(i.contact.email)}">${esc(i.contact.email)}</a></div>` : ''}</div></div>` : ''}
        <p class="text-xs muted">GoodNeighbor Health coordinates volunteers. It does not provide medical advice.</p>
      </aside>
    </div>`;

  showLocation($('#detail-map'), { lat: c?.lat, lng: c?.lng, label: i.location?.name });
  bind(i);

  setupChatPopup(i);
}

function bind(i) {
  const reg = i.viewer.myRegistration;
  $('#register-btn')?.addEventListener('click', () => registerFlow(i));
  $('#cancel-reg')?.addEventListener('click', async () => {
    const reason = await confirmDialog({
      title: 'Cancel your registration?',
      message: `Your slot will be released for other volunteers. Your registration history is kept.${reg.paymentStatus === 'confirmed' ? '\n\nYour payment was already confirmed — coordinate any refund directly with the host.' : ''}`,
      confirmText: 'Cancel registration', danger: true,
      input: { label: 'Reason (optional, shared with the host)', max: 500 },
    });
    if (reason === false) return;
    try {
      await api(`/registrations/${reg._id}/cancel`, { method: 'POST', body: { reason } });
      toast('Your registration was cancelled.', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#pay-btn')?.addEventListener('click', () => paymentFlow(i));
  $('#publish-btn')?.addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'Publishing…');
    try {
      await api(`/initiatives/${i._id}/publish`, { method: 'POST' });
      toast('Initiative published! Volunteers can now find and register for it.', 'success');
      load();
    } catch (err) { setBusy(e.currentTarget, false); toast(err.message, 'error'); }
  });
  $('#admin-cancel')?.addEventListener('click', async () => {
    const reason = await confirmDialog({ title: 'Cancel this initiative?', message: 'All registered volunteers and the host will be notified. Records are preserved.', confirmText: 'Cancel initiative', danger: true, input: { label: 'Reason', required: true, min: 5, multiline: true } });
    if (!reason) return;
    try {
      await api(`/initiatives/${i._id}/cancel`, { method: 'POST', body: { reason } });
      toast('Initiative cancelled.', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function registerFlow(i) {
  const m = openModal({
    title: 'Register as a volunteer',
    body: `<p class="mb-2"><strong>${esc(i.title)}</strong><br><span class="text-sm muted">${esc(fmtRange(i.startAt, i.endAt))} · ${esc(i.location?.name || '')}</span></p>
      ${i.requirements?.length ? `<div class="mb-2"><strong class="text-sm">Please confirm you meet these requirements:</strong>${list(i.requirements)}</div>` : ''}
      ${i.payment?.isPaid ? alertBox('warning', `This initiative has a registration fee of <strong>${peso(i.payment.fee)}</strong>. After registering, submit your payment proof from this page. Your slot is reserved while the host verifies payment.`) : ''}
      <div class="field mt-2"><label for="reg-note">Message to the host (optional)</label><textarea id="reg-note" class="textarea" maxlength="500" placeholder="e.g. I'm a 3rd-year nursing student and can help with vital signs."></textarea></div>
      ${i.requirements?.length ? '<label class="check mt-2"><input type="checkbox" id="reg-agree"> I have read the requirements and I am available on this schedule.</label>' : ''}`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="reg-submit">Confirm registration</button>',
  });
  const btn = m.el.querySelector('#reg-submit');
  btn.onclick = async () => {
    const agree = m.el.querySelector('#reg-agree');
    if (agree && !agree.checked) { toast('Please confirm that you meet the requirements.', 'warning'); return; }
    setBusy(btn, true, 'Registering…');
    try {
      const { data } = await api('/registrations', { method: 'POST', body: { initiativeId: i._id, note: m.el.querySelector('#reg-note').value.trim() } });
      m.close();
      toast(data.status === 'approved' ? "You're registered! See you there." : 'Application sent. The host will review it soon.', 'success', 6000);
      await load();
      if (i.payment?.isPaid) setTimeout(() => $('#pay-btn')?.focus(), 100);
    } catch (err) {
      setBusy(btn, false);
      toast(err.message, 'error', 7000);
      if (err.status === 409) { m.close(); load(); }
    }
  };
}

function paymentFlow(i) {
  const reg = i.viewer.myRegistration;
  const today = toLocalParts(new Date()).date;
  const m = openModal({
    title: 'Submit payment proof',
    size: '',
    body: `<form id="pay-form" class="stack" novalidate>
      ${alertBox('info', `Registration fee: <strong>${peso(i.payment.fee)}</strong>. Your payment stays <em>pending</em> until the host checks your receipt.`)}
      <div class="field"><label for="provider">Payment method <span class="req">*</span></label><select class="select" id="provider" name="provider" required>
        ${Object.entries(meta.paymentProviders).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="referenceNumber">Transaction reference number <span class="req">*</span></label><input class="input" id="referenceNumber" name="referenceNumber" maxlength="64" required placeholder="e.g. 1234 567 890123" autocomplete="off"><span class="hint">Copy it exactly as shown on your receipt. Each reference can only be used once.</span></div>
      <div class="form-grid">
        <div class="field"><label for="amount">Amount paid (₱) <span class="req">*</span></label><input class="input" id="amount" name="amount" type="number" min="1" step="0.01" value="${esc(i.payment.fee)}" required></div>
        <div class="field"><label for="paidAt">Payment date</label><input class="input" id="paidAt" name="paidAt" type="date" max="${today}" value="${today}"></div>
      </div>
      <div class="field"><label for="receipt">Receipt screenshot <span class="req">*</span></label><input class="input" id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp" required><span class="hint">JPG, PNG or WEBP up to ${meta.uploads.maxImageMB} MB. Only you, the host, and administrators can see it.</span><div id="receipt-preview" class="mt-1"></div></div>
    </form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="pay-submit">Submit payment</button>',
  });
  const form = m.el.querySelector('#pay-form');
  const file = form.receipt;
  file.onchange = () => {
    const f = file.files[0];
    const prev = m.el.querySelector('#receipt-preview');
    prev.innerHTML = f && f.type.startsWith('image/') ? `<img src="${URL.createObjectURL(f)}" alt="Receipt preview" style="max-height:180px;border-radius:8px;border:1px solid var(--gray-200)">` : '';
  };
  const btn = m.el.querySelector('#pay-submit');
  btn.onclick = async () => {
    const errs = {};
    const ref = form.referenceNumber.value.trim();
    const amt = Number(form.amount.value);
    const f = file.files[0];
    if (ref.replace(/[^A-Za-z0-9]/g, '').length < 4) errs.referenceNumber = 'Enter the reference number from your receipt';
    else if (!/^[A-Za-z0-9\-\s]+$/.test(ref)) errs.referenceNumber = 'Only letters, numbers, spaces and dashes are allowed';
    if (!(amt > 0)) errs.amount = 'Enter the amount you paid';
    if (!f) errs.receipt = 'Attach your receipt';
    else if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) errs.receipt = 'Use a JPG, PNG or WEBP image';
    else if (f.size > meta.uploads.maxImageMB * 1048576) errs.receipt = `File is larger than ${meta.uploads.maxImageMB} MB`;
    if (showErrors(form, errs)) return;
    if (amt !== Number(i.payment.fee)) {
      const ok = await confirmDialog({ title: 'Amount differs from the fee', message: `You entered ${peso(amt)} but the registration fee is ${peso(i.payment.fee)}. Submit anyway?`, confirmText: 'Submit anyway' });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.append('registrationId', reg._id);
    fd.append('provider', form.provider.value);
    fd.append('referenceNumber', ref);
    fd.append('amount', String(amt));
    if (form.paidAt.value) fd.append('paidAt', fromLocalParts(form.paidAt.value, '12:00'));
    fd.append('receipt', f);
    setBusy(btn, true, 'Uploading…');
    try {
      await api('/payments', { method: 'POST', form: fd });
      m.close();
      toast('Payment submitted. The host will verify it soon.', 'success', 6000);
      load();
    } catch (err) {
      setBusy(btn, false);
      showErrors(form, err.details);
      toast(err.message, 'error', 7000);
    }
  };
}

async function load() {
  if (!id) { root.innerHTML = alertBox('error', 'No initiative was specified. <a href="/explore.html">Browse initiatives</a>'); return; }
  const res = await withState(root, () => api(`/initiatives/${encodeURIComponent(id)}`, { redirectOn401: false }), { onRetry: load });
  if (res) render(res.data);
}
load();
