import { api, getMeta, uploadImage, imageUrl, newIdempotencyKey } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, $$, esc, icon, alertBox, toast, setBusy, showErrors, clearErrors, params, lines, csv, persistForm, confirmDialog,
  openModal, toLocalParts, fromLocalParts, statusBadge, loadingHtml,
} from '../ui.js';
import { locationPicker, searchPlaces, reversePlace } from '../map.js';

const user = await initPage({ auth: 'user' });
const meta = await getMeta();
const form = $('#init-form');
const editId = params().get('id');
let current = null; // initiative being edited
const images = { cover: null, qr: null };

$('#ai-icon').innerHTML = icon('sparkles');
$('#category').insertAdjacentHTML('beforeend', Object.entries(meta.categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));

/* ─── Organizations the user can host under ─── */
try {
  const { data } = await api('/users/me');
  const orgs = data.organizations.filter((o) => ['owner', 'admin'].includes(o.role));
  $('#organization').insertAdjacentHTML('beforeend', orgs.map((o) => `<option value="${esc(o._id)}">${esc(o.name)}</option>`).join(''));
  if (!orgs.length) $('#organization').closest('.field').querySelector('.hint').innerHTML = 'Organizations are optional. <a href="/organizations.html">Create or join one</a>.';
} catch { /* optional */ }

/* ─── Category hosting rules ─── */
function updateCategoryHint() {
  const c = form.category.value;
  const rule = meta.hostingRules?.[c];
  const hint = $('#category-hint');
  if (!rule) { hint.textContent = ''; return; }
  const v = user.verification || {};
  const ok = v.status === 'verified' && rule.requires.includes(v.type);
  hint.innerHTML = ok
    ? `<span class="verified">${icon('shieldCheck')} You're verified to host this category.</span>`
    : `<span style="color:var(--orange)">${esc(rule.message)}</span> <a href="/profile.html#verification">Get verified</a>`;
}
form.category.addEventListener('change', updateCategoryHint);

/* ─── Images ─── */
function imageBox(kind, boxSel, inputSel, purpose, label) {
  const box = $(boxSel);
  const input = $(inputSel);
  const render = () => {
    box.innerHTML = images[kind]
      ? `<div class="file-preview"><img src="${imageUrl(images[kind])}" alt="${esc(label)} preview"><button type="button" class="btn btn-sm btn-secondary" data-remove>Remove</button></div>`
      : `<div class="file-drop" role="button" tabindex="0">${icon('upload')}<div><strong>Upload ${esc(label.toLowerCase())}</strong></div><div class="hint">JPG, PNG or WEBP up to ${meta.uploads.maxImageMB} MB</div></div>`;
    box.querySelector('.file-drop')?.addEventListener('click', () => input.click());
    box.querySelector('.file-drop')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    box.querySelector('[data-remove]')?.addEventListener('click', () => { images[kind] = null; render(); });
  };
  input.onchange = async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return toast('Please choose a JPG, PNG or WEBP image.', 'warning');
    if (f.size > meta.uploads.maxImageMB * 1048576) return toast(`Image must be ${meta.uploads.maxImageMB} MB or smaller.`, 'warning');
    box.innerHTML = loadingHtml('Uploading…');
    try {
      images[kind] = await uploadImage(f, purpose);
    } catch (err) {
      toast(err.message, 'error');
    }
    render();
  };
  render();
  return render;
}
const renderCover = imageBox('cover', '#cover-box', '#cover-input', 'cover', 'Cover image');
const renderQr = imageBox('qr', '#qr-box', '#qr-input', 'qr', 'QR code');

/* ─── Payment toggle ─── */
const isPaid = () => form.querySelector('input[name=isPaid]:checked')?.value === 'true';
const syncPaid = () => { $('#paid-fields').hidden = !isPaid(); };
$$('input[name=isPaid]').forEach((r) => r.addEventListener('change', syncPaid));

/* ─── Description counter ─── */
const syncCount = () => { $('#desc-count').textContent = form.description.value.length; };
form.description.addEventListener('input', syncCount);

/* ─── Map picker ─── */
const latIn = form.lat;
const lngIn = form.lng;
let picker = null;
function initPicker() {
  const la = parseFloat(latIn.value);
  const ln = parseFloat(lngIn.value);
  picker = locationPicker($('#picker'), {
    lat: Number.isFinite(la) ? la : undefined,
    lng: Number.isFinite(ln) ? ln : undefined,
    onChange: (a, b) => { latIn.value = a; lngIn.value = b; form.dispatchEvent(new Event('input')); updateReadiness(); fillFromPin(a, b); },
  });
}

/* ─── Address search + reverse lookup (Nominatim) ─── */
const placeQ = $('#place-q');
const placeResults = $('#place-results');
const pinStatus = $('#pin-status');
const LOC_FIELDS = { venue: 'location.name', address: 'location.address', city: 'location.city', province: 'location.province' };

/* Delivery-app style auto-fill: a field we filled from the pin keeps following the pin;
   once the host types in it, it's theirs and is never overwritten. */
Object.values(LOC_FIELDS).forEach((n) => form[n].addEventListener('input', () => { delete form[n].dataset.auto; }));
function autoFill(name, value) {
  const el = form[name];
  if (!el || !value) return false;
  if (el.value.trim() && el.dataset.auto !== '1') return false; // host's own text wins
  if (el.value === value) return false;
  el.value = value;
  el.dataset.auto = '1';
  // brief highlight so the host notices what changed
  el.style.transition = 'background-color .6s';
  el.style.backgroundColor = 'var(--primary-50)';
  setTimeout(() => { el.style.backgroundColor = ''; }, 900);
  return true;
}
function applyPlace(p) {
  let n = 0;
  for (const [key, field] of Object.entries(LOC_FIELDS)) if (autoFill(field, p[key])) n++;
  if (n) { form.dispatchEvent(new Event('input')); updateReadiness(); }
  return n;
}
function setPinStatus(html) { pinStatus.innerHTML = html; }

let lookupTimer = null;
let lookupCtl = null;
function fillFromPin(la, ln) {
  // Debounce drags and respect Nominatim's 1 request/second policy
  clearTimeout(lookupTimer);
  lookupCtl?.abort();
  setPinStatus(`<span class="spinner" style="width:12px;height:12px;border-width:2px;vertical-align:-1px"></span> Finding the address of this spot…`);
  lookupTimer = setTimeout(async () => {
    lookupCtl = new AbortController();
    try {
      const r = await reversePlace(la, ln, { signal: lookupCtl.signal });
      if (!r) { setPinStatus('Pinned. We couldn\'t find an address here — please type it in.'); return; }
      applyPlace(r);
      setPinStatus(`${icon('pin')} <strong>Pinned:</strong> ${esc(r.address || r.label)}. Edit any field above if it's not quite right.`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setPinStatus('Pinned. Address lookup is unavailable right now — please type the address.');
    }
  }, 700);
}
function choosePlace(p) {
  latIn.value = p.lat;
  lngIn.value = p.lng;
  picker?.set(p.lat, p.lng);
  applyPlace(p);
  setPinStatus(`${icon('pin')} <strong>Pinned:</strong> ${esc(p.address || p.label)}. Drag the pin to adjust.`);
  placeResults.hidden = true;
  form.dispatchEvent(new Event('input'));
  updateReadiness();
}
async function runPlaceSearch() {
  const btn = $('#place-btn');
  const q = placeQ.value.trim() || [form['location.name'].value, form['location.address'].value, form['location.city'].value, form['location.province'].value].filter((s) => s.trim()).join(', ');
  if (q.length < 3) { toast('Type a place name or address to search.', 'warning'); placeQ.focus(); return; }
  if (!placeQ.value.trim()) placeQ.value = q;
  setBusy(btn, true, 'Searching…');
  try {
    const found = await searchPlaces(q);
    if (!found.length) {
      placeResults.innerHTML = '<li class="text-sm muted" style="padding:8px 10px">No matches. Try a nearby landmark or barangay, or click the map.</li>';
    } else {
      placeResults.innerHTML = found.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.label)}</button></li>`).join('');
      placeResults.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) choosePlace(found[+b.dataset.i]); };
    }
    placeResults.hidden = false;
  } catch (err) {
    toast(err.message || 'Address search failed.', 'warning');
  } finally {
    setBusy(btn, false);
  }
}
$('#place-btn').onclick = runPlaceSearch;
placeQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlaceSearch(); } });
const onCoordType = () => {
  const la = parseFloat(latIn.value);
  const ln = parseFloat(lngIn.value);
  if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) picker?.set(la, ln);
};
const onCoordEdit = () => {
  onCoordType();
  const la = parseFloat(latIn.value);
  const ln = parseFloat(lngIn.value);
  if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) fillFromPin(la, ln);
};
latIn.addEventListener('change', onCoordEdit);
lngIn.addEventListener('change', onCoordEdit);
$('#geo-btn').onclick = () => {
  if (!navigator.geolocation) return toast('Location access is not supported by this browser.', 'warning');
  navigator.geolocation.getCurrentPosition(
    (p) => { latIn.value = p.coords.latitude.toFixed(6); lngIn.value = p.coords.longitude.toFixed(6); onCoordEdit(); form.dispatchEvent(new Event('input')); },
    () => toast('Could not get your location. Click the map or type coordinates instead.', 'warning'),
    { timeout: 10000 }
  );
};

/* ─── Read / write form ─── */
function fill(i) {
  form.title.value = i.title || '';
  form.category.value = i.category || '';
  form.organization.value = i.organization?._id || '';
  form.description.value = i.description || '';
  const s = toLocalParts(i.startAt); form.startDate.value = s.date; form.startTime.value = s.time;
  const e = toLocalParts(i.endAt); form.endDate.value = e.date; form.endTime.value = e.time;
  const d = toLocalParts(i.registrationDeadline); form.deadlineDate.value = d.date; form.deadlineTime.value = d.time;
  form['location.name'].value = i.location?.name || '';
  form['location.address'].value = i.location?.address || '';
  form['location.city'].value = i.location?.city || '';
  form['location.province'].value = i.location?.province || '';
  latIn.value = i.coordinates?.lat ?? '';
  lngIn.value = i.coordinates?.lng ?? '';
  form.capacity.value = i.capacity ?? '';
  form.requiresApproval.checked = i.requiresApproval !== false;
  form.requirements.value = (i.requirements || []).join('\n');
  form.requiredSkills.value = (i.requiredSkills || []).join(', ');
  form.eligibility.value = i.eligibility || '';
  form.registrationInstructions.value = i.registrationInstructions || '';
  const paid = Boolean(i.payment?.isPaid);
  form.querySelector(`input[name=isPaid][value="${paid}"]`).checked = true;
  form['payment.fee'].value = i.payment?.fee ?? '';
  form['payment.gcashName'].value = i.payment?.gcashName || '';
  form['payment.gcashNumber'].value = i.payment?.gcashNumber || '';
  form['payment.bankInstructions'].value = i.payment?.bankInstructions || '';
  form['payment.instructions'].value = i.payment?.instructions || '';
  form.checklist.value = (i.checklist || []).join('\n');
  form.reminders.value = (i.reminders || []).join('\n');
  form['contact.name'].value = i.contact?.name || '';
  form['contact.phone'].value = i.contact?.phone || '';
  form['contact.email'].value = i.contact?.email || '';
  images.cover = i.coverImage || null;
  images.qr = i.payment?.qrImage || null;
}

function collect() {
  const num = (v) => (v === '' ? null : Number(v));
  return {
    title: form.title.value.trim(),
    category: form.category.value || null,
    organization: form.organization.value || null,
    description: form.description.value.trim(),
    coverImage: images.cover,
    startAt: fromLocalParts(form.startDate.value, form.startTime.value),
    endAt: fromLocalParts(form.endDate.value, form.endTime.value),
    registrationDeadline: form.deadlineDate.value ? fromLocalParts(form.deadlineDate.value, form.deadlineTime.value || '23:59') : null,
    location: {
      name: form['location.name'].value.trim(),
      address: form['location.address'].value.trim(),
      city: form['location.city'].value.trim(),
      province: form['location.province'].value.trim(),
    },
    lat: latIn.value.trim(),
    lng: lngIn.value.trim(),
    capacity: num(form.capacity.value),
    requiresApproval: form.requiresApproval.checked,
    requirements: lines(form.requirements.value),
    requiredSkills: csv(form.requiredSkills.value),
    eligibility: form.eligibility.value.trim(),
    registrationInstructions: form.registrationInstructions.value.trim(),
    payment: {
      isPaid: isPaid(),
      fee: isPaid() ? num(form['payment.fee'].value) : null,
      gcashName: form['payment.gcashName'].value.trim(),
      gcashNumber: form['payment.gcashNumber'].value.trim(),
      qrImage: isPaid() ? images.qr : null,
      bankInstructions: form['payment.bankInstructions'].value.trim(),
      instructions: form['payment.instructions'].value.trim(),
    },
    checklist: lines(form.checklist.value),
    reminders: lines(form.reminders.value),
    contact: {
      name: form['contact.name'].value.trim(),
      phone: form['contact.phone'].value.trim(),
      email: form['contact.email'].value.trim(),
    },
  };
}

/** Client-side mirror of the server's publish checks (server is authoritative). */
function validate(b, { forPublish }) {
  const e = {};
  if (b.title.length < 3) e.title = 'Enter a title (at least 3 characters)';
  const la = b.lat === '' ? null : Number(b.lat);
  const ln = b.lng === '' ? null : Number(b.lng);
  if ((la === null) !== (ln === null)) e.lat = 'Provide both latitude and longitude, or leave both empty';
  if (la !== null && (!Number.isFinite(la) || la < -90 || la > 90)) e.lat = 'Latitude must be between -90 and 90';
  if (ln !== null && (!Number.isFinite(ln) || ln < -180 || ln > 180)) e.lng = 'Longitude must be between -180 and 180';
  if (b.capacity !== null && (!Number.isInteger(b.capacity) || b.capacity < 1)) e.capacity = 'Capacity must be a whole number of at least 1';
  if (b.startAt && b.endAt && new Date(b.endAt) <= new Date(b.startAt)) e.endAt = 'End must be later than the start';
  // Drafts too: a new or rescheduled start can't be in the past
  if (b.startAt && new Date(b.startAt) <= new Date() && !startIsLocked()) e.startAt = 'Start must be in the future';
  if (b.registrationDeadline && new Date(b.registrationDeadline) <= new Date()) e.registrationDeadline = 'Deadline has already passed';
  if (b.registrationDeadline && b.startAt && new Date(b.registrationDeadline) > new Date(b.startAt)) e.registrationDeadline = 'Deadline must be on or before the start';
  if ((form.startDate.value && !form.startTime.value)) e.startTime = 'Set a start time';
  if ((form.endDate.value && !form.endTime.value)) e.endTime = 'Set an end time';
  if (b.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.contact.email)) e['contact.email'] = 'Enter a valid email';
  if (b.payment.isPaid && b.payment.fee !== null && !(b.payment.fee > 0)) e['payment.fee'] = 'Fee must be greater than 0';
  if (forPublish) {
    if (!b.category) e.category = 'Choose a category';
    if (b.description.length < 30) e.description = 'Write a description of at least 30 characters';
    if (!b.startAt) e.startAt = 'Set a start date';
    else if (new Date(b.startAt) <= new Date() && (!current || current.status === 'draft')) e.startAt = 'Start must be in the future';
    if (!b.endAt) e.endAt = e.endAt || 'Set an end date';
    if (b.registrationDeadline && b.startAt && new Date(b.registrationDeadline) > new Date(b.startAt)) e.registrationDeadline = 'Deadline must be on or before the start';
    if (!b.location.name) e['location.name'] = 'Enter the venue name';
    if (!b.location.address) e['location.address'] = 'Enter the complete address';
    if (!b.capacity) e.capacity = e.capacity || 'Set the maximum number of volunteers';
    if (b.payment.isPaid) {
      if (!b.payment.fee) e['payment.fee'] = 'Set the registration fee';
      if (!b.payment.gcashNumber && !b.payment.qrImage && !b.payment.bankInstructions && !b.payment.instructions) e['payment.instructions'] = 'Add at least one way to pay';
    }
  }
  return e;
}

function updateReadiness() {
  const b = collect();
  const checks = [
    ['Title & category', b.title.length >= 3 && b.category],
    ['Description (30+ characters)', b.description.length >= 30],
    ['Start and end schedule', b.startAt && b.endAt && new Date(b.endAt) > new Date(b.startAt)],
    ['Venue name and address', b.location.name && b.location.address],
    ['Map pin (recommended)', b.lat !== '' && b.lng !== ''],
    ['Volunteer capacity', b.capacity >= 1],
    ['Payment details', !b.payment.isPaid || (b.payment.fee > 0 && (b.payment.gcashNumber || b.payment.qrImage || b.payment.bankInstructions || b.payment.instructions))],
  ];
  $('#readiness').innerHTML = checks.map(([label, ok]) => `<li class="row" style="gap:8px;padding:4px 0"><span style="color:${ok ? 'var(--green)' : 'var(--gray-500)'}">${icon(ok ? 'checkCircle' : 'clock')}</span><span class="${ok ? '' : 'muted'}">${esc(label)}</span></li>`).join('');
  $$('#readiness svg').forEach((s) => { s.style.width = '18px'; s.style.height = '18px'; });
}
form.addEventListener('input', updateReadiness);
form.addEventListener('change', updateReadiness);

/* ─── Schedule guard ───
   - Start can't be in the past (date picker greys out past days; today's earlier times are flagged).
   - End can't be before the start; picking a start pre-fills a sensible end.
   - Registration deadline must fall between now and the start.
   All times are Asia/Manila. A published initiative that already started keeps its start. */
function addMinutes(date, time, mins) {
  const d = new Date(`${date}T${time}:00+08:00`);
  return toLocalParts(new Date(d.getTime() + mins * 60000));
}
function startIsLocked() {
  return Boolean(current && current.status !== 'draft' && current.startAt && new Date(current.startAt) <= new Date());
}
function liveMsg(input, text) {
  const field = input.closest('.field');
  let el = field.querySelector('.field-error[data-live]');
  if (!text) { el?.remove(); input.removeAttribute('aria-invalid'); return; }
  if (!el) { el = document.createElement('span'); el.className = 'field-error'; el.dataset.live = ''; field.appendChild(el); }
  el.textContent = text;
  input.setAttribute('aria-invalid', 'true');
}
function scheduleGuard() {
  const now = toLocalParts(new Date());
  const sd = form.startDate; const st = form.startTime;
  const ed = form.endDate; const et = form.endTime;
  const dd = form.deadlineDate; const dt = form.deadlineTime;
  const locked = startIsLocked();

  sd.min = locked ? '' : now.date;
  st.min = !locked && sd.value === now.date ? now.time : '';
  ed.min = sd.value || now.date;
  et.min = ed.value && ed.value === sd.value && st.value ? st.value : '';
  dd.min = now.date;
  dd.max = sd.value || '';
  dt.max = dd.value && dd.value === sd.value && st.value ? st.value : '';

  // Live messages
  const startAt = sd.value && st.value ? new Date(fromLocalParts(sd.value, st.value)) : null;
  const endAt = ed.value && et.value ? new Date(fromLocalParts(ed.value, et.value)) : null;
  liveMsg(sd, !locked && sd.value && sd.value < now.date ? 'This date has already passed' : '');
  liveMsg(st, !locked && startAt && startAt <= new Date() && sd.value >= now.date ? 'This time has already passed today' : '');
  liveMsg(ed, ed.value && sd.value && ed.value < sd.value ? 'End date can’t be before the start date' : '');
  liveMsg(et, startAt && endAt && endAt <= startAt && ed.value >= sd.value ? 'End time must be after the start time' : '');
  const deadline = dd.value ? new Date(fromLocalParts(dd.value, dt.value || '23:59')) : null;
  liveMsg(dd, deadline && dd.value < now.date ? 'This date has already passed'
    : deadline && startAt && deadline > startAt ? 'Deadline must be on or before the start' : '');
}
form.startDate.addEventListener('change', () => {
  const sd = form.startDate.value;
  if (sd && (!form.endDate.value || form.endDate.value < sd)) form.endDate.value = sd;
  if (sd && form.deadlineDate.value > sd) form.deadlineDate.value = sd;
  form.startTime.dispatchEvent(new Event('change'));
});
form.startTime.addEventListener('change', () => {
  const { startDate: sd, startTime: st, endDate: ed, endTime: et } = form;
  if (!sd.value || !st.value) return scheduleGuard();
  const endAt = ed.value && et.value ? new Date(fromLocalParts(ed.value, et.value)) : null;
  const startAt = new Date(fromLocalParts(sd.value, st.value));
  // Default to a 3-hour activity when the end is empty or no longer after the start
  if (!endAt || endAt <= startAt) {
    const e = addMinutes(sd.value, st.value, 180);
    ed.value = e.date;
    et.value = e.time;
  }
  scheduleGuard();
  updateReadiness();
});
['endDate', 'endTime', 'deadlineDate', 'deadlineTime'].forEach((n) => form[n].addEventListener('change', scheduleGuard));
form.addEventListener('input', (e) => { if (/^(start|end|deadline)(Date|Time)$/.test(e.target.name || '')) scheduleGuard(); });
setInterval(scheduleGuard, 60000); // "now" moves while the form is open

/* ─── Save / publish ─── */
const store = persistForm(form, editId ? `edit-${editId}` : 'new-initiative');
const IDEM_KEY = 'gn_create_idem';
function idemKey() {
  let k = sessionStorage.getItem(IDEM_KEY);
  if (!k) { k = newIdempotencyKey(); sessionStorage.setItem(IDEM_KEY, k); }
  return k;
}

async function save(mode) {
  clearErrors(form);
  const body = collect();
  const forPublish = mode === 'publish' || (current && current.status === 'published');
  const errs = validate(body, { forPublish });
  if (showErrors(form, errs)) { toast(Object.values(errs)[0], 'warning'); return; }
  if (forPublish && body.category && meta.hostingRules?.[body.category]) {
    const rule = meta.hostingRules[body.category];
    const v = user.verification || {};
    if (!(v.status === 'verified' && rule.requires.includes(v.type))) {
      toast(rule.message, 'error', 8000);
      showErrors(form, { category: 'Verification required for this category' });
      return;
    }
  }
  if (mode === 'publish') {
    const ok = await confirmDialog({ title: 'Publish this initiative?', message: 'It will be visible to everyone on Explore, and volunteers can start registering.', confirmText: 'Publish' });
    if (!ok) return;
  }

  const btn = $(`[data-action="${mode}"]`);
  setBusy(btn, true, mode === 'publish' ? 'Publishing…' : 'Saving…');
  try {
    let saved;
    if (!current) {
      ({ data: saved } = await api('/initiatives', { method: 'POST', body: { ...body, publish: mode === 'publish' }, idempotencyKey: idemKey() }));
      sessionStorage.removeItem(IDEM_KEY);
    } else {
      ({ data: saved } = await api(`/initiatives/${current._id}`, { method: 'PATCH', body }));
      if (mode === 'publish' && saved.status === 'draft') ({ data: saved } = await api(`/initiatives/${current._id}/publish`, { method: 'POST' }));
    }
    store.clear();
    if (mode === 'publish') {
      toast('Published! Your initiative is now live.', 'success', 6000);
      location.href = `/initiative.html?id=${saved._id}`;
      return;
    }
    toast(current?.status === 'published' ? 'Changes saved. Registered volunteers were notified of any schedule or location change.' : 'Draft saved.', 'success', 5000);
    if (!current) history.replaceState(null, '', `?id=${saved._id}`);
    setCurrent(saved);
  } catch (err) {
    showErrors(form, err.details);
    toast(err.message, 'error', 8000);
  } finally {
    setBusy(btn, false);
  }
}

function renderActions() {
  const a = $('#actions');
  if (!current || current.status === 'draft') {
    a.innerHTML = `${current ? `<button type="button" class="btn btn-ghost" data-action="delete">${icon('trash')} Delete draft</button>` : ''}
      <span class="grow"></span>
      ${current ? `<a class="btn btn-secondary" href="/initiative.html?id=${esc(current._id)}">Preview</a>` : ''}
      <button type="button" class="btn btn-secondary" data-action="draft">Save draft</button>
      <button type="button" class="btn btn-primary" data-action="publish">Publish</button>`;
  } else {
    a.innerHTML = `<a class="btn btn-ghost" href="/initiative.html?id=${esc(current._id)}">View page</a><span class="grow"></span>
      <a class="btn btn-secondary" href="/manage.html?id=${esc(current._id)}">Manage participants</a>
      <button type="button" class="btn btn-primary" data-action="save">Save changes</button>`;
  }
  a.querySelector('[data-action=draft]')?.addEventListener('click', () => save('draft'));
  a.querySelector('[data-action=publish]')?.addEventListener('click', () => save('publish'));
  a.querySelector('[data-action=save]')?.addEventListener('click', () => save('save'));
  a.querySelector('[data-action=delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete this draft?', message: 'The draft will be removed from your host dashboard.', confirmText: 'Delete draft', danger: true });
    if (!ok) return;
    try {
      await api(`/initiatives/${current._id}`, { method: 'DELETE' });
      store.clear();
      toast('Draft deleted.', 'success');
      location.href = '/host.html';
    } catch (err) { toast(err.message, 'error'); }
  });
}

function setCurrent(i) {
  current = i;
  $('#page-title').textContent = i ? (i.status === 'draft' ? 'Edit draft' : 'Edit initiative') : 'Create an initiative';
  $('#status-badge').innerHTML = i ? statusBadge(i.displayStatus) : '';
  if (i?.status === 'published') {
    $('#page-sub').textContent = 'Changes to the schedule or location notify registered volunteers automatically.';
    const locked = i.slotsTaken > 0;
    form.category.disabled = locked;
    $$('input[name=isPaid]').forEach((r) => { r.disabled = locked; });
    form['payment.fee'].disabled = locked && i.payment?.isPaid;
    $('#capacity-hint').textContent = i.slotsTaken ? `${i.slotsTaken} slot(s) already taken — capacity can't go lower.` : '';
    form.capacity.min = Math.max(1, i.slotsTaken || 1);
    const banners = [];
    if (locked) banners.push(alertBox('info', 'Volunteers have already registered, so the category and free/paid settings are locked.'));
    if (i.displayStatus === 'ongoing') banners.push(alertBox('warning', 'This initiative is in progress. Schedule, location, capacity and payment can no longer be changed.'));
    $('#banners').innerHTML = banners.map((b) => `<div class="mb-2">${b}</div>`).join('');
  }
  renderActions();
}

/* ─── AI planning assistant ─── */
$('#ai-btn').onclick = async () => {
  if (!meta.features?.ai) {
    toast('The AI assistant is not enabled on this server. You can keep filling in the form manually.', 'warning', 6000);
    return;
  }
  const b = collect();
  const m = openModal({
    title: 'AI planning assistant',
    size: 'modal-lg',
    body: `<form id="ai-form" class="stack" novalidate>
      <div class="form-grid">
        <div class="field"><label for="ai-category">Initiative type <span class="req">*</span></label><select class="select" id="ai-category" name="category">${Object.entries(meta.categories).map(([k, v]) => `<option value="${k}" ${k === b.category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label for="ai-volunteers">Expected volunteers</label><input class="input" id="ai-volunteers" name="expectedVolunteers" type="number" min="1" value="${esc(b.capacity || '')}"></div>
        <div class="field span-2"><label for="ai-goal">What do you want to do? <span class="req">*</span></label><textarea class="textarea" id="ai-goal" name="goal" maxlength="1000" placeholder="e.g. A free check-up and BP screening day for senior citizens, with nursing student volunteers.">${esc(b.description.slice(0, 1000))}</textarea></div>
        <div class="field"><label for="ai-audience">Who will benefit?</label><input class="input" id="ai-audience" name="audience" maxlength="300" placeholder="e.g. Senior citizens of Barangay Carmen"></div>
        <div class="field"><label for="ai-duration">Duration</label><input class="input" id="ai-duration" name="duration" maxlength="100" placeholder="e.g. Half day, 8 AM–12 NN"></div>
        <div class="field span-2"><label for="ai-notes">Other notes</label><input class="input" id="ai-notes" name="notes" maxlength="1000"></div>
      </div>
      <p class="text-xs muted mb-0">Only the details above (plus the title and city) are sent to the AI. Do not include personal or medical information about individuals.</p>
    </form><div id="ai-results" class="mt-2"></div>`,
    footer: '<button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" id="ai-generate">Generate suggestions</button>',
  });
  const aiForm = m.el.querySelector('#ai-form');
  const results = m.el.querySelector('#ai-results');
  const gen = m.el.querySelector('#ai-generate');
  gen.onclick = async () => {
    const goal = aiForm.goal.value.trim();
    if (goal.length < 10) { showErrors(aiForm, { goal: 'Describe your idea in at least 10 characters' }); return; }
    clearErrors(aiForm);
    setBusy(gen, true, 'Thinking…');
    results.innerHTML = loadingHtml('Drafting suggestions… this can take a few seconds.');
    try {
      const { data } = await api('/ai/plan', {
        method: 'POST',
        body: {
          category: aiForm.category.value,
          goal,
          title: b.title || undefined,
          audience: aiForm.audience.value.trim() || undefined,
          location: b.location.city || undefined,
          expectedVolunteers: aiForm.expectedVolunteers.value || undefined,
          duration: aiForm.duration.value.trim() || undefined,
          notes: aiForm.notes.value.trim() || undefined,
        },
      });
      showSuggestions(results, data.suggestions, aiForm.category.value);
      setBusy(gen, false);
      gen.textContent = 'Regenerate';
    } catch (err) {
      setBusy(gen, false);
      results.innerHTML = alertBox('warning', esc(err.message));
    }
  };
};

function showSuggestions(el, s, category) {
  const block = (key, label, content, apply) => `<div class="ai-suggestion" data-key="${key}"><header><strong>${esc(label)}</strong>${apply ? `<button type="button" class="btn btn-sm btn-outline" data-apply="${key}">Use this</button>` : ''}</header>${content}</div>`;
  const ul = (arr) => (arr?.length ? `<ul class="bullets text-sm">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted text-sm">None</span>');
  el.innerHTML = `${alertBox('info', 'AI-generated suggestions. Review and edit them before publishing — you are responsible for the final content.')}
    <div class="stack-sm mt-2">
      ${s.suggestedTitle ? block('title', 'Title', `<p class="mb-0">${esc(s.suggestedTitle)}</p>`, true) : ''}
      ${s.description ? block('description', 'Description', `<p class="pre-line text-sm mb-0">${esc(s.description)}</p>`, true) : ''}
      ${block('requirements', 'Volunteer requirements', ul(s.requirements), s.requirements?.length)}
      ${block('checklist', 'Preparation checklist', ul(s.preparationChecklist), s.preparationChecklist?.length)}
      ${block('reminders', 'Guidelines & safety reminders', ul([...(s.guidelines || []), ...(s.safetyReminders || [])]), (s.guidelines?.length || s.safetyReminders?.length))}
      ${s.announcement ? block('announcement', 'Announcement draft (copy for later)', `<p class="pre-line text-sm mb-0">${esc(s.announcement)}</p>`, false).replace('</header>', '<button type="button" class="btn btn-sm btn-secondary" data-copy>Copy</button></header>') : ''}
      <div class="row"><button type="button" class="btn btn-primary btn-sm" data-apply-all>Use all into empty fields</button></div>
    </div>`;
  const apply = (key, onlyIfEmpty = false) => {
    const set = (el2, val) => { if (!onlyIfEmpty || !el2.value.trim()) el2.value = val; };
    if (key === 'title') set(form.title, s.suggestedTitle);
    if (key === 'description') set(form.description, s.description);
    if (key === 'requirements') set(form.requirements, s.requirements.join('\n'));
    if (key === 'checklist') set(form.checklist, s.preparationChecklist.join('\n'));
    if (key === 'reminders') set(form.reminders, [...(s.guidelines || []), ...(s.safetyReminders || [])].join('\n'));
    if (!form.category.value) { form.category.value = category; updateCategoryHint(); }
    syncCount();
    form.dispatchEvent(new Event('input'));
  };
  el.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => {
    apply(b.dataset.apply);
    b.textContent = 'Applied ✓';
    b.disabled = true;
    toast('Added to the form. You can edit it there.', 'success', 2500);
  }));
  el.querySelector('[data-apply-all]')?.addEventListener('click', () => {
    ['title', 'description', 'requirements', 'checklist', 'reminders'].forEach((k) => apply(k, true));
    toast('Suggestions added to empty fields. Existing text was kept.', 'success');
  });
  el.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(s.announcement); toast('Announcement copied.', 'success', 2000); } catch { toast('Copy failed — select the text manually.', 'warning'); }
  });
}

/* ─── Init ─── */
if (editId) {
  try {
    const { data } = await api(`/initiatives/${encodeURIComponent(editId)}`);
    if (!data.viewer.isHost && !data.viewer.isAdmin) throw new Error('You can only edit initiatives you host.');
    if (['cancelled', 'completed'].includes(data.displayStatus)) {
      form.closest('.layout-sidebar').innerHTML = alertBox('warning', `This initiative is ${esc(data.displayStatus)} and can no longer be edited. <a href="/initiative.html?id=${esc(data._id)}">View it</a>`);
      throw null; // stop init quietly
    }
    fill(data);
    setCurrent(data);
    if (store.has()) {
      $('#banners').insertAdjacentHTML('afterbegin', `<div class="mb-2" id="restore-banner">${alertBox('info', 'You have unsaved edits from a previous session on this device. <button type="button" class="link-btn" id="restore-yes">Restore them</button> or <button type="button" class="link-btn" id="restore-no">discard</button>.')}</div>`);
      $('#restore-yes').onclick = () => { store.restore(); syncPaid(); syncCount(); updateCategoryHint(); onCoordType(); updateReadiness(); scheduleGuard(); $('#restore-banner').remove(); };
      $('#restore-no').onclick = () => { store.clear(); $('#restore-banner').remove(); };
    }
  } catch (err) {
    if (err) {
      form.closest('.layout-sidebar').innerHTML = alertBox('error', `${esc(err.message)} <a href="/host.html">Back to host dashboard</a>`);
    }
  }
} else {
  if (store.restore()) {
    $('#banners').innerHTML = `<div class="mb-2" id="restore-banner">${alertBox('info', 'We restored the details you were entering earlier on this device. <button type="button" class="link-btn" id="restore-clear">Start over</button>')}</div>`;
    $('#restore-clear').onclick = () => { store.clear(); location.reload(); };
  } else {
    form['contact.name'].value = user.fullName;
    form['contact.email'].value = user.email;
    if (user.phone) form['contact.phone'].value = user.phone;
  }
  setCurrent(null);
}

if (document.contains(form)) {
  syncPaid();
  syncCount();
  updateCategoryHint();
  renderCover();
  renderQr();
  updateReadiness();
  scheduleGuard();
  initPicker();
}
