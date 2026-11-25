import { api, getMeta, session, imageUrl } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, emptyHtml, initiativeCardHtml, person, params, alertBox, confirmDialog, openModal, toast, setBusy, showErrors, clearErrors,
} from '../ui.js';

await initPage();
const meta = await getMeta();
const root = $('#root');
const id = params().get('id');

function render(o) {
  document.title = `${o.name} — GoodNeighbor Health`;
  const manager = ['owner', 'admin'].includes(o.myRole) || session.isAdmin;
  const isOwner = o.myRole === 'owner' || session.isAdmin;
  root.innerHTML = `
    ${o.status === 'deactivated' ? `<div class="mb-2">${alertBox('warning', `This organization has been deactivated by the administrators.${o.deactivatedReason ? ` Reason: ${esc(o.deactivatedReason)}` : ''} Past initiatives remain in the record.`)}</div>` : ''}
    <div class="layout-sidebar">
      <div class="stack">
        <div class="card"><div class="card-body row" style="gap:20px;align-items:flex-start">
          <span class="avatar avatar-lg" style="border-radius:16px">${o.logo ? `<img src="${imageUrl(o.logo)}" alt="">` : icon('building')}</span>
          <div class="grow"><h1 class="mb-0">${esc(o.name)} ${o.verificationStatus === 'verified' ? `<span class="verified">${icon('shieldCheck')} Verified</span>` : ''}</h1>
            <p class="muted mb-1">${esc(meta.organizationTypes[o.type] || '')}${o.location ? ` · ${esc(o.location)}` : ''}</p>
            ${o.description ? `<p class="pre-line mb-0">${esc(o.description)}</p>` : ''}
            <div class="row mt-2 text-sm" style="gap:16px">${o.contact?.email ? `<a href="mailto:${esc(o.contact.email)}">${esc(o.contact.email)}</a>` : ''}${o.contact?.phone ? `<span>${esc(o.contact.phone)}</span>` : ''}${o.contact?.website ? `<a href="${esc(o.contact.website)}" target="_blank" rel="noopener nofollow">Website</a>` : ''}</div>
          </div></div></div>
        <div><h2>Initiatives</h2>${o.initiatives.length ? `<div class="grid grid-2">${o.initiatives.map((i) => initiativeCardHtml(i, meta, { showRegStatus: false })).join('')}</div>` : `<div class="card">${emptyHtml({ icon: 'calendar', title: 'No published initiatives yet' })}</div>`}</div>
      </div>
      <aside class="stack">
        <div class="card"><div class="card-header"><h3>Members (${o.memberCount})</h3>${manager && o.status === 'active' ? '<button class="btn btn-sm btn-primary" id="add-member">Add</button>' : ''}</div>
          <ul class="list">${o.members.map((m) => `<li class="list-item">${person(m.user, { sub: esc(m.role) + (m.user.email ? ` · ${esc(m.user.email)}` : '') })}
            ${(isOwner && m.role !== 'owner') || (manager && m.role === 'member') ? `<div class="dropdown"><button class="btn btn-sm btn-ghost" data-menu="${esc(m.user._id)}" aria-label="Member actions">⋯</button></div>` : ''}
            ${session.user && String(m.user._id) === String(session.user._id) && m.role !== 'owner' ? '<button class="btn btn-sm btn-ghost" id="leave-btn">Leave</button>' : ''}
          </li>`).join('')}</ul></div>
        ${manager && o.status === 'active' ? `<button class="btn btn-secondary btn-block" id="edit-org">${icon('edit')} Edit organization</button>` : ''}
        ${manager ? `<a class="btn btn-primary btn-block" href="/initiative-form.html">Host an initiative for ${esc(o.name)}</a>` : ''}
      </aside>
    </div>`;

  $('#add-member')?.addEventListener('click', () => addMember(o));
  $('#edit-org')?.addEventListener('click', () => editOrg(o));
  $('#leave-btn')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Leave ${o.name}?`, message: 'You will no longer be able to host initiatives under this organization.', confirmText: 'Leave', danger: true });
    if (!ok) return;
    try { await api(`/organizations/${o._id}/members/${session.user._id}`, { method: 'DELETE' }); toast('You left the organization.', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
  });
  root.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => memberMenu(o, o.members.find((m) => String(m.user._id) === b.dataset.menu), isOwner)));
}

function memberMenu(o, m, isOwner) {
  const modal = openModal({
    title: m.user.fullName,
    body: `<p class="text-sm muted">Current role: <strong>${esc(m.role)}</strong></p><div class="stack-sm">
      ${isOwner && m.role === 'member' ? '<button class="btn btn-secondary btn-block" data-act="admin">Make organization admin</button>' : ''}
      ${isOwner && m.role === 'admin' ? '<button class="btn btn-secondary btn-block" data-act="member">Change to regular member</button>' : ''}
      ${isOwner ? '<button class="btn btn-secondary btn-block" data-act="owner">Transfer ownership</button>' : ''}
      <button class="btn btn-danger btn-block" data-act="remove">Remove from organization</button></div>`,
  });
  modal.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'owner') {
      const ok = await confirmDialog({ title: 'Transfer ownership?', message: `${m.user.fullName} will become the owner and you will become an admin.`, confirmText: 'Transfer', danger: true });
      if (!ok) return;
    }
    if (act === 'remove') {
      const ok = await confirmDialog({ title: `Remove ${m.user.fullName}?`, message: 'They will no longer be able to host under this organization.', confirmText: 'Remove', danger: true });
      if (!ok) return;
    }
    try {
      if (act === 'remove') await api(`/organizations/${o._id}/members/${m.user._id}`, { method: 'DELETE' });
      else await api(`/organizations/${o._id}/members/${m.user._id}`, { method: 'PATCH', body: { role: act } });
      modal.close();
      toast('Membership updated.', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function addMember(o) {
  const m = openModal({
    title: 'Add a member',
    body: `<form id="mem-form" class="stack" novalidate><div class="field"><label for="m-email">Member's account email</label><input class="input" id="m-email" name="email" type="email"><span class="hint">They need a GoodNeighbor account first.</span></div>
      ${o.myRole === 'owner' || session.isAdmin ? '<div class="field"><label for="m-role">Role</label><select class="select" id="m-role" name="role"><option value="member">Member</option><option value="admin">Admin (can host and manage members)</option></select></div>' : ''}</form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="m-save">Add member</button>',
  });
  const f = m.el.querySelector('#mem-form');
  const btn = m.el.querySelector('#m-save');
  btn.onclick = async () => {
    clearErrors(f);
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showErrors(f, { email: 'Enter a valid email' }); return; }
    setBusy(btn, true, 'Adding…');
    try {
      await api(`/organizations/${o._id}/members`, { method: 'POST', body: { email, role: f.role?.value || 'member' } });
      m.close(); toast('Member added.', 'success'); load();
    } catch (err) { setBusy(btn, false); showErrors(f, err.details); toast(err.message, 'error'); }
  };
}

function editOrg(o) {
  const m = openModal({
    title: 'Edit organization',
    size: 'modal-lg',
    body: `<form id="e-form" class="form-grid" novalidate>
      <div class="field span-2"><label for="e-name">Name</label><input class="input" id="e-name" name="name" maxlength="120" value="${esc(o.name)}"></div>
      <div class="field"><label for="e-type">Type</label><select class="select" id="e-type" name="type">${Object.entries(meta.organizationTypes).map(([k, v]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="e-loc">Location</label><input class="input" id="e-loc" name="location" maxlength="200" value="${esc(o.location || '')}"></div>
      <div class="field span-2"><label for="e-desc">Description</label><textarea class="textarea" id="e-desc" name="description" maxlength="3000">${esc(o.description || '')}</textarea></div>
      <div class="field"><label for="e-email">Contact email</label><input class="input" id="e-email" name="contact.email" value="${esc(o.contact?.email || '')}"></div>
      <div class="field"><label for="e-phone">Contact phone</label><input class="input" id="e-phone" name="contact.phone" value="${esc(o.contact?.phone || '')}"></div>
      <div class="field span-2"><label for="e-web">Website</label><input class="input" id="e-web" name="contact.website" value="${esc(o.contact?.website || '')}"></div></form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="e-save">Save</button>',
  });
  const f = m.el.querySelector('#e-form');
  const btn = m.el.querySelector('#e-save');
  btn.onclick = async () => {
    clearErrors(f);
    setBusy(btn, true, 'Saving…');
    try {
      await api(`/organizations/${o._id}`, {
        method: 'PATCH',
        body: { name: f.name.value.trim(), type: f.type.value, location: f.location.value.trim(), description: f.description.value.trim(), contact: { email: f['contact.email'].value.trim(), phone: f['contact.phone'].value.trim(), website: f['contact.website'].value.trim() } },
      });
      m.close(); toast('Organization updated.', 'success'); load();
    } catch (err) { setBusy(btn, false); showErrors(f, err.details); toast(err.message, 'error'); }
  };
}

async function load() {
  if (!id) { root.innerHTML = alertBox('error', 'No organization specified.'); return; }
  const res = await withState(root, () => api(`/organizations/${encodeURIComponent(id)}`, { redirectOn401: false }), { onRetry: load });
  if (res) render(res.data);
}
load();
