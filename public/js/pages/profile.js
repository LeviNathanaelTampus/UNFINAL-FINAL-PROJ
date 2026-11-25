import { api, session, uploadImage, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, avatar, verifiedBadge, alertBox, toast, setBusy, showErrors, clearErrors, csv, fmtDate, confirmDialog, loadingHtml,
} from '../ui.js';

await initPage({ auth: 'user' });
const meta = await getMeta();
let me = null;
let avatarId = null;

const form = $('#profile-form');

function renderAvatar() {
  $('#avatar-box').innerHTML = avatar({ ...me, avatar: avatarId }, 'avatar-lg');
  $('#avatar-remove').hidden = !avatarId;
}

function renderSide() {
  $('#side-card').innerHTML = `<div style="display:flex;justify-content:center">${avatar(me, 'avatar-lg')}</div>
    <h3 class="mt-2 mb-0">${esc(me.fullName)}</h3><div class="mt-1">${verifiedBadge(me)}</div>
    <p class="text-sm muted mt-1">Member since ${esc(fmtDate(me.createdAt, { month: 'long', year: 'numeric' }))}</p>
    <div class="stack-sm"><a class="btn btn-secondary btn-sm btn-block" href="/history.html">Participation history</a><a class="btn btn-secondary btn-sm btn-block" href="/host.html">Hosted initiatives</a></div>`;
}

async function load() {
  const { data } = await api('/users/me');
  me = data.user;
  session.setUser(me);
  avatarId = me.avatar || null;
  $('#public-link').href = `/user.html?id=${me._id}`;
  form.fullName.value = me.fullName || '';
  $('#email').value = me.email;
  form.phone.value = me.phone || '';
  form.city.value = me.city || '';
  form.bio.value = me.bio || '';
  form.interests.value = (me.interests || []).join(', ');
  form.skills.value = (me.skills || []).join(', ');
  form.experience.value = me.experience || '';
  form.emailNotifications.checked = me.emailNotifications !== false;
  renderAvatar();
  renderSide();
  $('#orgs').innerHTML = data.organizations.length
    ? `<ul class="list">${data.organizations.map((o) => `<li class="list-item"><a href="/organization.html?id=${esc(o._id)}" class="grow"><strong>${esc(o.name)}</strong></a><span class="badge badge-outline">${esc(o.role)}</span></li>`).join('')}</ul>`
    : `<div class="card-body text-sm muted">You're not part of any organization. You can host on your own — organizations are optional.</div>`;
  loadVerification();
}

/* Avatar upload */
$('#avatar-btn').onclick = () => $('#avatar-input').click();
$('#avatar-remove').onclick = () => { avatarId = null; renderAvatar(); };
$('#avatar-input').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > meta.uploads.maxImageMB * 1048576) return toast(`Image must be ${meta.uploads.maxImageMB} MB or smaller.`, 'warning');
  $('#avatar-box').innerHTML = '<span class="avatar avatar-lg"><span class="spinner"></span></span>';
  try {
    avatarId = await uploadImage(f, 'avatar');
    toast('Photo uploaded — click Save profile to keep it.', 'info');
  } catch (err) { toast(err.message, 'error'); }
  renderAvatar();
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const body = {
    fullName: form.fullName.value.trim(),
    phone: form.phone.value.trim(),
    city: form.city.value.trim(),
    bio: form.bio.value.trim(),
    interests: csv(form.interests.value),
    skills: csv(form.skills.value),
    experience: form.experience.value.trim(),
    emailNotifications: form.emailNotifications.checked,
    avatar: avatarId,
  };
  const errs = {};
  if (body.fullName.length < 2) errs.fullName = 'Enter your full name';
  if (body.phone && !/^[0-9+()\-\s]+$/.test(body.phone)) errs.phone = 'Use digits, spaces, +, - and parentheses only';
  if (showErrors(form, errs)) return;
  const btn = form.querySelector('button[type=submit]');
  setBusy(btn, true, 'Saving…');
  try {
    const { data } = await api('/users/me', { method: 'PATCH', body });
    me = data.user;
    session.setUser(me);
    renderSide();
    toast('Profile saved.', 'success');
  } catch (err) { showErrors(form, err.details); toast(err.message, 'error'); } finally { setBusy(btn, false); }
});

/* Password */
const pw = $('#pw-form');
pw.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(pw);
  const body = { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value, confirmPassword: pw.confirmPassword.value };
  const errs = {};
  if (!body.currentPassword) errs.currentPassword = 'Enter your current password';
  if (body.newPassword.length < 8 || !/[A-Za-z]/.test(body.newPassword) || !/\d/.test(body.newPassword)) errs.newPassword = 'Use 8+ characters with letters and numbers';
  if (body.newPassword !== body.confirmPassword) errs.confirmPassword = 'Passwords do not match';
  if (showErrors(pw, errs)) return;
  const btn = pw.querySelector('button[type=submit]');
  setBusy(btn, true, 'Updating…');
  try {
    const { data } = await api('/users/me/password', { method: 'POST', body });
    session.set(data.token, me);
    pw.reset();
    toast('Password updated. Other devices have been logged out.', 'success');
  } catch (err) { showErrors(pw, err.details); toast(err.message, 'error'); } finally { setBusy(btn, false); }
});

/* Verification */
async function loadVerification() {
  const body = $('#ver-body');
  body.innerHTML = loadingHtml();
  let data;
  try { ({ data } = await api('/verifications/me')); } catch (err) { body.innerHTML = alertBox('error', esc(err.message)); return; }
  const cur = data.current || {};
  const latest = data.requests[0];
  const badge = { verified: '<span class="badge badge-green">Verified</span>', pending: '<span class="badge badge-blue">Under review</span>', rejected: '<span class="badge badge-red">Not approved</span>' }[cur.status] || '<span class="badge badge-outline">Not submitted</span>';
  $('#ver-badge').innerHTML = badge;

  const intro = `<p class="text-sm">Verified healthcare professionals and medical/health-sciences students get a badge on their profile and when hosting. <strong>Only verified licensed professionals can host medical missions.</strong> Administrators review every request manually using PRC information and the documents you upload — AI is never used for verification.</p>`;
  let status = '';
  if (cur.status === 'verified') status = alertBox('success', `You are verified as <strong>${esc(cur.profession || '')}</strong> (${cur.type === 'student' ? 'student' : 'licensed professional'}).`);
  else if (cur.status === 'pending' || latest?.status === 'pending') status = alertBox('info', `Your request (${esc(latest?.profession || '')}) was submitted ${esc(fmtDate(latest?.createdAt))} and is waiting for administrator review.`);
  else if (latest?.status === 'rejected') status = alertBox('error', `Your last request was not approved.${latest.rejectionReason ? ` Reason: ${esc(latest.rejectionReason)}` : ''} You can submit a new request below.`);

  const canSubmit = !data.requests.some((r) => r.status === 'pending');
  body.innerHTML = `${intro}${status ? `<div class="mb-2">${status}</div>` : ''}${canSubmit ? (cur.status === 'verified' ? '<button class="btn btn-secondary btn-sm" id="ver-open">Submit updated credentials</button><div id="ver-form-wrap"></div>' : '<div id="ver-form-wrap"></div>') : ''}`;
  const wrap = $('#ver-form-wrap');
  if (!wrap) return;
  const showForm = () => {
    wrap.innerHTML = `<form id="ver-form" class="stack mt-2" novalidate>
      <div class="radio-cards" role="radiogroup" aria-label="Verification type">
        <label class="radio-card"><input type="radio" name="professionalType" value="licensed" checked><strong>Licensed professional</strong><span class="text-sm muted">Nurse, physician, midwife, pharmacist, med tech, etc. with a PRC license</span></label>
        <label class="radio-card"><input type="radio" name="professionalType" value="student"><strong>Student</strong><span class="text-sm muted">Currently enrolled in a medical or health-sciences program</span></label>
      </div>
      <div class="form-grid">
        <div class="field"><label for="profession" id="profession-label">Profession <span class="req">*</span></label><input class="input" id="profession" name="profession" maxlength="100" placeholder="e.g. Registered Nurse"></div>
        <div class="field" data-for="licensed"><label for="prcLicenseNumber">PRC license number <span class="req">*</span></label><input class="input" id="prcLicenseNumber" name="prcLicenseNumber" maxlength="20" autocomplete="off"></div>
        <div class="field" data-for="licensed"><label for="licenseExpiry">License valid until</label><input class="input" type="date" id="licenseExpiry" name="licenseExpiry"></div>
        <div class="field" data-for="student" hidden><label for="school">School <span class="req">*</span></label><input class="input" id="school" name="school" maxlength="150" placeholder="e.g. Xavier University – Ateneo de Cagayan"></div>
        <div class="field" data-for="student" hidden><label for="yearLevel">Year level</label><input class="input" id="yearLevel" name="yearLevel" maxlength="50" placeholder="e.g. 3rd year"></div>
        <div class="field span-2"><label for="documents">Supporting documents <span class="req">*</span></label><input class="input" type="file" id="documents" name="documents" accept="image/jpeg,image/png,image/webp,application/pdf" multiple><span class="hint" id="doc-hint">PRC ID (front) or Certificate of Registration. Up to 3 files (JPG, PNG, WEBP, PDF), ${meta.uploads.maxDocMB} MB each. Only administrators can view these.</span></div>
        <div class="field span-2"><label for="ver-notes">Notes for the reviewer</label><textarea class="textarea" id="ver-notes" name="notes" maxlength="1000" rows="2"></textarea></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('shield')} Submit for verification</button></div>
    </form>`;
    const vf = $('#ver-form');
    const sync = () => {
      const t = vf.querySelector('input[name=professionalType]:checked').value;
      vf.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== t; });
      $('#profession-label').innerHTML = `${t === 'student' ? 'Program / course' : 'Profession'} <span class="req">*</span>`;
      vf.profession.placeholder = t === 'student' ? 'e.g. BS Nursing' : 'e.g. Registered Nurse';
      $('#doc-hint').textContent = `${t === 'student' ? 'School ID or Certificate of Enrolment' : 'PRC ID (front) or Certificate of Registration'}. Up to 3 files (JPG, PNG, WEBP, PDF), ${meta.uploads.maxDocMB} MB each. Only administrators can view these.`;
    };
    vf.querySelectorAll('input[name=professionalType]').forEach((r) => r.addEventListener('change', sync));
    vf.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(vf);
      const t = vf.querySelector('input[name=professionalType]:checked').value;
      const files = [...vf.documents.files];
      const errs = {};
      if (vf.profession.value.trim().length < 2) errs.profession = 'This is required';
      if (t === 'licensed' && !/^[0-9A-Za-z-]{5,20}$/.test(vf.prcLicenseNumber.value.trim())) errs.prcLicenseNumber = 'Enter your PRC license number';
      if (t === 'student' && vf.school.value.trim().length < 2) errs.school = 'Enter your school';
      if (!files.length) errs.documents = 'Upload at least one document';
      if (files.length > 3) errs.documents = 'Upload at most 3 files';
      if (files.some((f) => f.size > meta.uploads.maxDocMB * 1048576)) errs.documents = `Each file must be ${meta.uploads.maxDocMB} MB or smaller`;
      if (showErrors(vf, errs)) return;
      const ok = await confirmDialog({ title: 'Submit for verification?', message: 'Your credentials will be reviewed by GoodNeighbor administrators. Your PRC number and documents are never shown publicly.', confirmText: 'Submit' });
      if (!ok) return;
      const fd = new FormData();
      fd.append('professionalType', t);
      fd.append('profession', vf.profession.value.trim());
      if (t === 'licensed') {
        fd.append('prcLicenseNumber', vf.prcLicenseNumber.value.trim());
        if (vf.licenseExpiry.value) fd.append('licenseExpiry', vf.licenseExpiry.value);
      } else {
        fd.append('school', vf.school.value.trim());
        fd.append('yearLevel', vf.yearLevel.value.trim());
      }
      fd.append('notes', vf.notes.value.trim());
      files.forEach((f) => fd.append('documents', f));
      const btn = vf.querySelector('button[type=submit]');
      setBusy(btn, true, 'Submitting…');
      try {
        await api('/verifications', { method: 'POST', form: fd });
        toast('Submitted! We\'ll notify you once an administrator reviews it.', 'success', 6000);
        load();
      } catch (err) { setBusy(btn, false); showErrors(vf, err.details); toast(err.message, 'error'); }
    });
  };
  const openBtn = $('#ver-open');
  if (openBtn) openBtn.onclick = () => { openBtn.remove(); showForm(); };
  else showForm();
}

load().catch((err) => { $('.layout-sidebar').innerHTML = alertBox('error', esc(err.message)); });
if (location.hash === '#verification') setTimeout(() => $('#verification').scrollIntoView({ behavior: 'smooth' }), 400);
