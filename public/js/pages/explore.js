import { api, getMeta } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, initiativeCardHtml, emptyHtml, renderPagination, params, debounce, fmtRange, peso, statusBadge, categoryLabel, toast, fromLocalParts,
} from '../ui.js';
import { createMap, pinIcon, meIcon } from '../map.js';

await initPage();
const meta = await getMeta();

const form = $('#filters');
const listEl = $('#list-view');
const pager = $('#pager');
const countEl = $('#result-count');
$('#view-list').innerHTML = `${icon('grid')} List`;
$('#view-map').innerHTML = `${icon('map')} Map`;
$('#near-btn').innerHTML = `${icon('navigation')} Near me`;
$('#q-icon').outerHTML = icon('search');
$('#category').insertAdjacentHTML('beforeend', Object.entries(meta.categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));

// Category pills (drive the hidden #category select)
const catSelect = $('#category');
const pills = $('#cat-pills');
pills.innerHTML = [['', 'All'], ...Object.entries(meta.categories)]
  .map(([k, v]) => `<button type="button" class="pill" data-cat="${esc(k)}" aria-pressed="false">${esc(v)}</button>`).join('');
function syncPills() {
  for (const b of pills.querySelectorAll('.pill')) b.setAttribute('aria-pressed', String(b.dataset.cat === catSelect.value));
}
pills.addEventListener('click', (e) => {
  const b = e.target.closest('.pill');
  if (!b) return;
  catSelect.value = b.dataset.cat;
  syncPills();
  catSelect.dispatchEvent(new Event('input', { bubbles: true }));
});

// "Filters" toggle with a count of active advanced filters
const moreBtn = $('#more-btn');
const morePanel = $('#more-filters');
const ADVANCED = ['price', 'availability', 'from', 'to'];
function syncMoreBtn() {
  const n = ADVANCED.filter((k) => form.elements[k].value).length + (form.elements.sort.value !== 'soonest' ? 1 : 0);
  moreBtn.innerHTML = `${icon('sliders')} Filters${n ? ` <span class="filter-count">${n}</span>` : ''}`;
}
moreBtn.onclick = () => {
  morePanel.hidden = !morePanel.hidden;
  moreBtn.setAttribute('aria-expanded', String(!morePanel.hidden));
};

const state = { page: 1, view: 'list', near: null };

// Restore filters from URL so results are shareable
const p = params();
for (const el of form.elements) if (el.name && p.has(el.name)) el.value = p.get(el.name);
if (p.get('view') === 'map') state.view = 'map';
if (p.get('page')) state.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
syncPills();
syncMoreBtn();
if (ADVANCED.some((k) => form.elements[k].value)) { morePanel.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); }

function query() {
  const q = {};
  for (const el of form.elements) if (el.name && el.value) q[el.name] = el.value;
  if (q.from) q.from = fromLocalParts(q.from, '00:00');
  if (q.to) q.to = fromLocalParts(q.to, '23:59');
  if (state.near) Object.assign(q, { lat: state.near.lat, lng: state.near.lng, radiusKm: state.near.radiusKm });
  return q;
}
function syncUrl() {
  const u = new URLSearchParams();
  for (const el of form.elements) if (el.name && el.value) u.set(el.name, el.value);
  if (state.view === 'map') u.set('view', 'map');
  if (state.page > 1) u.set('page', state.page);
  history.replaceState(null, '', `${location.pathname}${u.toString() ? `?${u}` : ''}`);
}

async function loadList() {
  syncUrl();
  pager.innerHTML = '';
  const res = await withState(listEl, () => api('/initiatives', { query: { ...query(), page: state.page, limit: 12 }, redirectOn401: false }), { onRetry: loadList, loadingText: 'Finding initiatives…' });
  if (!res) { countEl.textContent = ''; return; }
  const { data, meta: m } = res;
  countEl.textContent = `${m.total} initiative${m.total === 1 ? '' : 's'} found`;
  if (!data.length) {
    listEl.innerHTML = `<div class="card">${emptyHtml({ icon: 'search', title: 'No initiatives match your filters', text: 'Try removing some filters, widening the date range, or checking back later.', action: '<button class="btn btn-secondary" id="empty-reset">Clear filters</button>' })}</div>`;
    $('#empty-reset').onclick = () => { form.reset(); state.near = null; updateNear(); state.page = 1; refresh(); };
    return;
  }
  listEl.innerHTML = `<div class="grid grid-3">${data.map((i) => initiativeCardHtml(i, meta)).join('')}</div>`;
  renderPagination(pager, m, (pg) => { state.page = pg; loadList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

let map = null;
let markers = null;
async function loadMap() {
  syncUrl();
  const mapEl = $('#map');
  if (!map) {
    map = createMap(mapEl, { zoom: 9, scrollWheelZoom: true, fallbackText: 'Switch to list view to browse initiatives.' });
    if (map) markers = window.L.layerGroup().addTo(map);
  }
  let res;
  try {
    res = await api('/initiatives', { query: { ...query(), map: 1, limit: 200 }, redirectOn401: false });
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const { data, meta: m } = res;
  countEl.textContent = `${m.total} initiative${m.total === 1 ? '' : 's'} found`;
  const pinned = data.filter((i) => i.coordinates);
  $('#map-note').textContent = data.length - pinned.length > 0
    ? `${data.length - pinned.length} initiative(s) have no map pin — see list view for those.`
    : '';
  if (!map) return;
  markers.clearLayers();
  const L = window.L;
  const bounds = [];
  for (const i of pinned) {
    const { lat, lng } = i.coordinates;
    bounds.push([lat, lng]);
    L.marker([lat, lng], { icon: pinIcon() }).addTo(markers).bindPopup(`
      <div style="min-width:200px"><div class="i-cat">${esc(categoryLabel(i.category, meta))}</div>
      <a href="/initiative.html?id=${esc(i._id)}">${esc(i.title)}</a>
      <div class="text-xs muted mt-1">${esc(fmtRange(i.startAt, i.endAt))}</div>
      <div class="text-xs muted">${esc(i.location?.name || '')}</div>
      <div class="row mt-1" style="gap:6px">${statusBadge(i.displayStatus)}<span class="badge">${i.payment?.isPaid ? peso(i.payment.fee) : 'Free'}</span></div></div>`);
  }
  if (state.near) {
    bounds.push([state.near.lat, state.near.lng]);
    L.marker([state.near.lat, state.near.lng], { icon: meIcon(), interactive: false }).addTo(markers);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 50);
}

function setView(v) {
  state.view = v;
  $('#view-list').setAttribute('aria-pressed', String(v === 'list'));
  $('#view-map').setAttribute('aria-pressed', String(v === 'map'));
  $('#list-view').hidden = v !== 'list';
  pager.hidden = v !== 'list';
  $('#map-view').hidden = v !== 'map';
  refresh();
}
const refresh = () => (state.view === 'map' ? loadMap() : loadList());

function updateNear() {
  $('#near-label').innerHTML = state.near
    ? `<span class="chip">Within ${state.near.radiusKm} km of you <button class="link-btn" id="clear-near" aria-label="Clear location filter" style="margin-left:6px">&times;</button></span>`
    : '';
  if (state.near) $('#clear-near').onclick = () => { state.near = null; updateNear(); state.page = 1; refresh(); };
}

$('#near-btn').onclick = () => {
  if (!navigator.geolocation) { toast('Your browser does not support location access. Use the Location filter instead.', 'warning'); return; }
  const btn = $('#near-btn');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      state.near = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), radiusKm: 25 };
      state.page = 1;
      updateNear();
      refresh();
    },
    () => { btn.disabled = false; toast('Could not get your location. You can type a city in the Location filter instead.', 'warning'); },
    { timeout: 10000, maximumAge: 600000 }
  );
};

const onChange = debounce(() => { state.page = 1; refresh(); }, 350);
form.addEventListener('input', onChange);
form.addEventListener('input', syncMoreBtn);
form.addEventListener('change', syncMoreBtn);
form.addEventListener('submit', (e) => { e.preventDefault(); state.page = 1; refresh(); });
form.addEventListener('reset', () => setTimeout(() => { state.near = null; updateNear(); syncPills(); syncMoreBtn(); state.page = 1; refresh(); }, 0));
$('#view-list').onclick = () => setView('list');
$('#view-map').onclick = () => setView('map');

setView(state.view);
