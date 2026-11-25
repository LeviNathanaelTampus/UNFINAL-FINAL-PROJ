// GoodNeighbor Health — shared UI helpers (no framework)
import { imageUrl, META_FALLBACK } from './api.js';

/* ─── Escaping & DOM ─── */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const params = () => new URLSearchParams(location.search);
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ─── Icons (inline SVG, stroke-based) ─── */
const P = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  map: '<path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  wifiOff: '<path d="m1 1 22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  navigation: '<path d="m3 11 19-9-9 19-2-8z"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
export const LOGO = `<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#0A7C8C"/><path d="M9 19.5 20 10l11 9.5V30a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 9 30z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M18.2 18.5h3.6v3.3h3.3v3.6h-3.3v3.3h-3.6v-3.3h-3.3v-3.6h3.3z" fill="#fff"/></svg>`;

/* ─── Formatting (Asia/Manila) ─── */
const TZ = 'Asia/Manila';
export function fmtDate(d, opts = { dateStyle: 'medium' }) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PH', { timeZone: TZ, ...opts });
}
export const fmtDateTime = (d) => fmtDate(d, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtTime = (d) => fmtDate(d, { timeStyle: 'short' });
export function fmtRange(start, end) {
  if (!start) return 'Schedule to be announced';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sameDay = e && fmtDate(s, { dateStyle: 'medium' }) === fmtDate(e, { dateStyle: 'medium' });
  const day = fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (!e) return `${day} · ${fmtTime(s)}`;
  if (sameDay) return `${day} · ${fmtTime(s)} – ${fmtTime(e)}`;
  return `${fmtDateTime(s)} – ${fmtDateTime(e)}`;
}
export function relTime(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(d);
}
export const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export function dateTile(d) {
  if (!d) return '';
  return `<div class="date-tile" aria-hidden="true"><div class="m">${esc(fmtDate(d, { month: 'short' }))}</div><div class="d">${esc(fmtDate(d, { day: 'numeric' }))}</div></div>`;
}
/** Split an instant into Manila-local date (YYYY-MM-DD) and time (HH:MM) for inputs. */
export function toLocalParts(d) {
  if (!d) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d));
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}
/** Combine Manila-local date + time inputs into an ISO string. */
export function fromLocalParts(date, time) {
  if (!date) return null;
  return `${date}T${time || '00:00'}:00+08:00`;
}

/* ─── Status labels ─── */
export function categoryLabel(key, meta) {
  return (meta?.categories || META_FALLBACK.categories)[key] || 'Healthcare Initiative';
}
const DISPLAY_STATUS = {
  open: ['Open', 'badge-green'],
  full: ['Full', 'badge-orange'],
  closed: ['Registration closed', 'badge-orange'],
  ongoing: ['Ongoing', 'badge-blue'],
  completed: ['Completed', 'badge-dark'],
  cancelled: ['Cancelled', 'badge-red'],
  draft: ['Draft', 'badge-outline'],
  deleted: ['Deleted', 'badge-red'],
};
export function statusBadge(s) {
  const [label, cls] = DISPLAY_STATUS[s] || [s, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
const REG_STATUS = {
  pending: ['Pending approval', 'badge-orange'],
  approved: ['Approved', 'badge-green'],
  declined: ['Declined', 'badge-red'],
  cancelled: ['Cancelled', 'badge-outline'],
  attended: ['Attended', 'badge-blue'],
  absent: ['Absent', 'badge-dark'],
};
export function regBadge(s) {
  const [label, cls] = REG_STATUS[s] || [s, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
const PAY_STATUS = {
  not_required: ['Free', 'badge-outline'],
  unpaid: ['Payment needed', 'badge-orange'],
  pending: ['Payment under review', 'badge-blue'],
  confirmed: ['Payment confirmed', 'badge-green'],
  rejected: ['Payment rejected', 'badge-red'],
};
export function payBadge(s) {
  const [label, cls] = PAY_STATUS[s] || [s, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
export function verifiedBadge(u, { label = true } = {}) {
  if (!u) return '';
  const verified = u.verified || u.verification?.status === 'verified';
  if (!verified) return '';
  const prof = u.profession || u.verification?.profession;
  const type = u.professionalType || u.verification?.type;
  const title = type === 'student' ? `Verified student${prof ? ` · ${prof}` : ''}` : `Verified healthcare professional${prof ? ` · ${prof}` : ''}`;
  return `<span class="verified" title="${esc(title)}">${icon('shieldCheck')}${label ? (type === 'student' ? 'Verified student' : 'Verified professional') : ''}</span>`;
}
export function avatar(u, size = '') {
  const name = u?.fullName || '?';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const img = u?.avatar ? `<img src="${imageUrl(u.avatar)}" alt="" loading="lazy">` : esc(initials);
  return `<span class="avatar ${size}">${img}</span>`;
}
export function person(u, { size = 'avatar-sm', sub = '', link = true } = {}) {
  if (!u) return '';
  const name = esc(u.fullName || 'Unknown');
  const nameHtml = link && u._id ? `<a href="/user.html?id=${esc(u._id)}" class="person-name">${name}</a>` : `<span class="person-name">${name}</span>`;
  return `<div class="person">${avatar(u, size)}<div class="grow"><div class="row" style="gap:6px">${nameHtml} ${verifiedBadge(u, { label: false })}</div>${sub ? `<div class="text-xs muted">${sub}</div>` : ''}</div></div>`;
}

/* ─── Feedback ─── */
function toastRoot() {
  let el = $('.toasts');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toasts';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
export function toast(message, type = 'info', ms = 4500) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="grow">${esc(message)}</div><button aria-label="Dismiss">&times;</button>`;
  t.querySelector('button').onclick = () => t.remove();
  toastRoot().appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
}
export function alertBox(type, html, iconName) {
  const ic = iconName || { info: 'info', success: 'checkCircle', warning: 'alert', error: 'alert' }[type];
  return `<div class="alert alert-${type}" role="${type === 'error' ? 'alert' : 'status'}">${icon(ic)}<div>${html}</div></div>`;
}
export function loadingHtml(text = 'Loading…') {
  return `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`;
}
export function emptyHtml({ icon: ic = 'clipboard', title, text = '', action = '' }) {
  return `<div class="empty"><div class="icon-circle">${icon(ic)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}
export function errorHtml(err, retryId) {
  return `<div class="error-state">${alertBox('error', `<strong>Something went wrong.</strong><p>${esc(err?.message || 'Please try again.')}</p>`)}${retryId ? `<button class="btn btn-secondary mt-2" id="${retryId}">Try again</button>` : ''}</div>`;
}

/** Render content into a container while showing loading / error states. */
export async function withState(container, loader, { loadingText, onRetry } = {}) {
  container.innerHTML = loadingHtml(loadingText);
  try {
    return await loader();
  } catch (err) {
    const id = `retry-${Math.random().toString(36).slice(2, 8)}`;
    container.innerHTML = errorHtml(err, onRetry ? id : null);
    if (onRetry) $(`#${id}`, container).onclick = onRetry;
    return undefined;
  }
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(text || 'Please wait…')}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

/* ─── Forms ─── */
export function clearErrors(form) {
  $$('.field-error', form).forEach((e) => e.remove());
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
}
/** Show server-side or client-side validation errors next to fields (matched by name). */
export function showErrors(form, details = {}) {
  clearErrors(form);
  let first = null;
  for (const [name, msg] of Object.entries(details || {})) {
    if (typeof msg !== 'string') continue;
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`) || form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const field = input.closest('.field') || input.parentElement;
    const err = document.createElement('div');
    err.className = 'field-error';
    err.textContent = msg;
    field.appendChild(err);
    first = first || input;
  }
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (first.focus) first.focus({ preventScroll: true });
  }
  return Boolean(first);
}
export const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
export const csv = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** Persist unsent form input in localStorage so it survives refreshes / connection drops. */
export function persistForm(form, key, { exclude = [] } = {}) {
  const k = `gn_form_${key}`;
  const save = debounce(() => {
    const data = {};
    for (const el of form.elements) {
      if (!el.name || exclude.includes(el.name) || el.type === 'file' || el.type === 'password') continue;
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; } else data[el.name] = el.value;
    }
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  }, 400);
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  return {
    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem(k) || 'null');
        if (!saved || Date.now() - saved.at > 7 * 86400000) return false;
        for (const [name, val] of Object.entries(saved.data)) {
          const els = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
          els.forEach((el) => {
            if (el.type === 'checkbox') el.checked = Boolean(val);
            else if (el.type === 'radio') el.checked = el.value === val;
            else el.value = val;
          });
        }
        return true;
      } catch { return false; }
    },
    has() { try { return Boolean(localStorage.getItem(k)); } catch { return false; } },
    clear() { try { localStorage.removeItem(k); } catch { /* ignore */ } },
    save,
  };
}

/* ─── Modal & confirm ─── */
export function openModal({ title, body, footer = '', size = '' }) {
  const prev = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (prev?.focus) prev.focus();
    wrap.dispatchEvent(new Event('closed'));
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  setTimeout(() => (wrap.querySelector('input,textarea,select,.modal-foot .btn-primary,.modal-foot .btn') || wrap.querySelector('.modal')).focus(), 30);
  return { el: wrap, close };
}

/**
 * Confirmation dialog. Resolves to false if cancelled, true (or the input text) if confirmed.
 * @param {{title:string,message:string,confirmText?:string,danger?:boolean,input?:{label:string,required?:boolean,placeholder?:string,multiline?:boolean}}} o
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    const inputHtml = o.input
      ? `<div class="field mt-2"><label for="confirm-input">${esc(o.input.label)}${o.input.required ? ' <span class="req">*</span>' : ''}</label>${o.input.multiline
        ? `<textarea id="confirm-input" class="textarea" maxlength="${o.input.max || 500}" placeholder="${esc(o.input.placeholder || '')}"></textarea>`
        : `<input id="confirm-input" class="input" maxlength="${o.input.max || 500}" placeholder="${esc(o.input.placeholder || '')}">`}</div>`
      : '';
    let done = false;
    const m = openModal({
      title: o.title,
      body: `<p class="pre-line mb-0">${esc(o.message)}</p>${o.html || ''}${inputHtml}`,
      footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn ${o.danger ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${esc(o.confirmText || 'Confirm')}</button>`,
    });
    const okBtn = m.el.querySelector('[data-ok]');
    okBtn.onclick = () => {
      let value = true;
      if (o.input) {
        const inp = m.el.querySelector('#confirm-input');
        value = inp.value.trim();
        if (o.input.required && value.length < (o.input.min || 1)) {
          inp.setAttribute('aria-invalid', 'true');
          let err = m.el.querySelector('.field-error');
          if (!err) { err = document.createElement('div'); err.className = 'field-error'; inp.after(err); }
          err.textContent = o.input.min ? `Please enter at least ${o.input.min} characters` : 'This is required';
          inp.focus();
          return;
        }
      }
      done = true;
      m.close();
      resolve(value);
    };
    m.el.addEventListener('closed', () => { if (!done) resolve(false); });
  });
}

/* ─── Pagination ─── */
export function renderPagination(container, meta, onPage) {
  if (!meta || meta.totalPages <= 1) { container.innerHTML = ''; return; }
  const { page, totalPages } = meta;
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  let html = `<button ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}" aria-label="Previous page">‹</button>`;
  let last = 0;
  for (const p of sorted) {
    if (p - last > 1) html += '<span class="muted">…</span>';
    html += `<button data-p="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`;
    last = p;
  }
  html += `<button ${page >= totalPages ? 'disabled' : ''} data-p="${page + 1}" aria-label="Next page">›</button>`;
  container.innerHTML = `<nav class="pagination" aria-label="Pagination">${html}</nav>`;
  container.querySelectorAll('button[data-p]').forEach((b) => { b.onclick = () => onPage(Number(b.dataset.p)); });
}

/* ─── Tabs ─── */
export function setupTabs(root, onChange) {
  const tabs = $$('[role="tab"]', root);
  const select = (tab, fire = true) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panel = t.getAttribute('aria-controls') && document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (fire && onChange) onChange(tab.dataset.tab);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { tabs[(i + 1) % tabs.length].focus(); select(tabs[(i + 1) % tabs.length]); }
      if (e.key === 'ArrowLeft') { tabs[(i - 1 + tabs.length) % tabs.length].focus(); select(tabs[(i - 1 + tabs.length) % tabs.length]); }
    });
  });
  return { select: (name, fire = true) => { const t = tabs.find((x) => x.dataset.tab === name); if (t) select(t, fire); } };
}

/* ─── Initiative card ─── */
export function initiativeCardHtml(i, meta, { showRegStatus = true } = {}) {
  const cover = i.coverImage
    ? `<img src="${imageUrl(i.coverImage)}" alt="" loading="lazy">`
    : `<div class="pattern"></div><div class="cover-label">${esc(categoryLabel(i.category, meta))}</div>`;
  const taken = i.slotsTaken || 0;
  const cap = i.capacity || 0;
  const pct = cap ? Math.min(100, Math.round((taken / cap) * 100)) : 0;
  const barCls = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
  const loc = [i.location?.name, i.location?.city].filter(Boolean).join(', ') || 'Location to be announced';
  const myReg = showRegStatus && i.myRegistrationStatus ? regBadge(i.myRegistrationStatus) : '';
  return `<a class="card i-card" href="/initiative.html?id=${esc(i._id)}">
    <div class="i-cover" data-cat="${esc(i.category)}">${cover}<div class="badges">${statusBadge(i.displayStatus)}<span class="badge ${i.payment?.isPaid ? 'badge-orange' : 'badge-green'}">${i.payment?.isPaid ? peso(i.payment.fee) : 'Free'}</span></div></div>
    <div class="i-body">
      <div class="i-cat">${esc(categoryLabel(i.category, meta))}</div>
      <h3 class="i-title">${esc(i.title)}</h3>
      <div class="i-meta">
        <div>${icon('calendar')}<span>${esc(fmtRange(i.startAt, i.endAt))}</span></div>
        <div>${icon('pin')}<span>${esc(loc)}</span></div>
      </div>
      ${myReg ? `<div>${myReg}</div>` : ''}
      <div class="i-foot">
        <div class="grow">${i.host ? `<div class="row" style="gap:6px">${avatar(i.host, 'avatar-sm')}<span class="truncate">${esc(i.organization?.name || i.host.fullName)}</span>${verifiedBadge(i.host, { label: false })}</div>` : ''}</div>
        <div class="text-right nowrap"><strong>${Math.max(0, cap - taken)}</strong> <span class="muted">of ${cap} slots left</span><div class="slots-bar"><span class="${barCls}" style="width:${pct}%"></span></div></div>
      </div>
    </div></a>`;
}
