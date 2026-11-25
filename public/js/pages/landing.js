import { api, getMeta, session } from '../api.js';
import { initPage } from '../layout.js';
import { $, icon, esc, initiativeCardHtml, emptyHtml, withState } from '../ui.js';

await initPage();
const meta = await getMeta();

// Icons inside the static markup
$('#sc-ic-search').outerHTML = icon('search');
$('#sc-ic-pin').outerHTML = icon('pin');
$('#hv-meta-1').innerHTML = `${icon('calendar')} Sat, 9:00 AM · Cagayan de Oro`;
$('#hv-meta-2').innerHTML = `${icon('pin')} Carmen, Cagayan de Oro`;
$('#hv-check').innerHTML = icon('check');

if (session.user) {
  const cta = $('#cta-primary');
  cta.textContent = session.isAdmin ? 'Admin dashboard' : 'Go to your dashboard';
  cta.href = session.isAdmin ? '/admin.html' : '/dashboard.html';
}

// Category suggestions under the search box
const popular = ['blood_donation', 'medical_mission', 'health_education_seminar', 'community_wellness'];
$('#suggest').insertAdjacentHTML('beforeend', popular
  .filter((k) => meta.categories?.[k])
  .map((k) => `<a class="pill" href="/explore.html?category=${encodeURIComponent(k)}">${esc(meta.categories[k])}</a>`)
  .join(''));

// Drop empty params so the Explore URL stays clean
$('#hero-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = new URLSearchParams();
  for (const [k, v] of new FormData(e.target)) if (String(v).trim()) u.set(k, String(v).trim());
  location.href = `/explore.html${u.toString() ? `?${u}` : ''}`;
});

const steps = [
  ['Discover', 'Browse missions, blood drives and seminars by category, date, or on the map.'],
  ['Join', 'Reserve a slot in seconds. You get notified the moment the host approves you.'],
  ['Host', 'Publish your own initiative, manage volunteers, and take attendance in one place.'],
];
$('#steps').innerHTML = steps.map(([t, d], i) => `<div class="step"><div class="step-index">0${i + 1}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('');

const featured = $('#featured');
async function loadFeatured() {
  const res = await withState(featured, () => api('/initiatives', { query: { limit: 3, sort: 'soonest' }, redirectOn401: false }), { onRetry: loadFeatured, loadingText: 'Loading initiatives…' });
  if (!res) return;
  const { data, meta: m } = res;
  if (!data.length) {
    featured.innerHTML = `<div class="card">${emptyHtml({ icon: 'calendar', title: 'No upcoming initiatives yet', text: 'Be the first to organize a healthcare activity in your community.', action: '<a href="/initiative-form.html" class="btn btn-primary">Host an initiative</a>' })}</div>`;
    $('#view-all').hidden = true;
  } else {
    featured.innerHTML = `<div class="grid grid-3">${data.map((i) => initiativeCardHtml(i, meta)).join('')}</div>`;
    if (m?.total > data.length) $('#view-all').textContent = `View all ${m.total}`;
  }
}
loadFeatured();
