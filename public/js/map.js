// Leaflet (library) + OpenStreetMap (tiles) helpers with graceful failure handling
import { esc, icon } from './ui.js';

export const DEFAULT_CENTER = { lat: 8.4542, lng: 124.6319 }; // Cagayan de Oro

const hasLeaflet = () => typeof window.L !== 'undefined';

function fallback(el, message) {
  el.innerHTML = `<div class="map-fallback">${icon('map')}<strong>Map unavailable</strong><span class="text-sm">${esc(message)}</span></div>`;
}

export function pinIcon() {
  return window.L.divIcon({ className: '', html: '<div class="gn-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
}

/**
 * Create a Leaflet map. Returns the map, or null if Leaflet failed to load.
 * If OpenStreetMap tiles fail, a notice is shown but the page keeps working.
 */
export function createMap(el, { center = DEFAULT_CENTER, zoom = 12, scrollWheelZoom = false, fallbackText } = {}) {
  if (!el) return null;
  if (!hasLeaflet()) {
    fallback(el, fallbackText || 'The map library could not load. Location details are shown as text instead.');
    return null;
  }
  const L = window.L;
  const map = L.map(el, { scrollWheelZoom, zoomControl: false }).setView([center.lat, center.lng], zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // OpenStreetMap standard tiles (no API key). Softened via CSS (.leaflet-tile-pane) to match the UI.
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const primary = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: OSM_ATTR,
    // OSM tile policy requires a Referer header; set explicitly in case a page-level policy strips it
    referrerPolicy: 'strict-origin-when-cross-origin',
  });

  let loaded = 0;
  let errors = 0;
  let notice = null;
  const showNotice = () => {
    if (notice) return;
    notice = document.createElement('div');
    notice.className = 'map-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'Map tiles could not load (the map service may be unavailable or you are offline). The written address is still accurate, and you can keep working.';
    el.appendChild(notice);
  };
  const watch = (layer) => {
    layer.on('tileload', () => { loaded++; if (notice) { notice.remove(); notice = null; } });
    layer.on('tileerror', () => { errors++; if (errors >= 3 && loaded === 0) showNotice(); });
  };
  primary.addTo(map);
  watch(primary);
  setTimeout(() => { if (loaded === 0) showNotice(); }, 9000);
  // Leaflet needs a size recalculation if the container was hidden when created
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}

/**
 * Interactive location picker: click map or drag pin to set coordinates.
 * @returns {{ map, set(lat,lng,pan?), clear() }}
 */
export function locationPicker(el, { lat, lng, onChange }) {
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
  const map = createMap(el, {
    center: hasPoint ? { lat, lng } : DEFAULT_CENTER,
    zoom: hasPoint ? 16 : 12,
    scrollWheelZoom: true,
    fallbackText: 'You can still type the address and coordinates manually.',
  });
  if (!map) return { map: null, set() {}, clear() {} };
  const L = window.L;
  let marker = null;
  const place = (la, ln, pan = false) => {
    if (!marker) {
      marker = L.marker([la, ln], { draggable: true, icon: pinIcon() }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onChange?.(round(p.lat), round(p.lng));
      });
    } else marker.setLatLng([la, ln]);
    if (pan) map.setView([la, ln], Math.max(map.getZoom(), 15));
  };
  if (hasPoint) place(lat, lng);
  map.on('click', (e) => {
    place(e.latlng.lat, e.latlng.lng);
    onChange?.(round(e.latlng.lat), round(e.latlng.lng));
  });
  return {
    map,
    set(la, ln, pan = true) { if (Number.isFinite(la) && Number.isFinite(ln)) place(la, ln, pan); },
    clear() { if (marker) { marker.remove(); marker = null; } },
  };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Static map with a single marker. */
export function showLocation(el, { lat, lng, label }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    el.innerHTML = `<div class="map-fallback">${icon('pin')}<span class="text-sm">The host has not pinned this location on the map. Use the address details instead.</span></div>`;
    return null;
  }
  const map = createMap(el, { center: { lat, lng }, zoom: 16 });
  if (!map) return null;
  window.L.marker([lat, lng], { icon: pinIcon() }).addTo(map).bindPopup(esc(label || 'Initiative location'));
  return map;
}

/** Small blue dot for "you are here". */
export function meIcon() {
  return window.L.divIcon({ className: '', html: '<div class="gn-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
}

/* ─── Address search (OpenStreetMap Nominatim) ───
   Free and keyless; usage policy asks for ≤1 request/second, so calls are user-triggered only. */
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Bias results toward Northern Mindanao without excluding the rest of the Philippines
const VIEWBOX = '122.8,9.9,126.0,7.3';

export async function searchPlaces(query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const u = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', countrycodes: 'ph', limit: String(limit), viewbox: VIEWBOX, 'accept-language': 'en' });
  const res = await fetch(`${NOMINATIM}/search?${u}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is unavailable right now. Click the map or type coordinates instead.');
  const rows = await res.json();
  return rows.map((r) => ({ lat: round(+r.lat), lng: round(+r.lon), label: r.display_name, ...placeParts(r) }));
}

/** Reverse lookup at building level (zoom 18) — like a delivery app's pinned address. */
export async function reversePlace(lat, lng, { signal } = {}) {
  const u = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'en' });
  const res = await fetch(`${NOMINATIM}/reverse?${u}`, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) return null;
  const r = await res.json();
  if (!r || r.error) return null;
  return { label: r.display_name, ...placeParts(r) };
}

// Highly urbanized cities are independent of a province, so OSM returns none; use the
// geographic province people write on addresses.
const CITY_PROVINCE = {
  'Cagayan de Oro': 'Misamis Oriental',
  Iligan: 'Lanao del Norte',
};
const NOT_A_VENUE = new Set(['highway', 'place', 'boundary', 'landuse', 'natural', 'waterway', 'railway']);

function placeParts(r = {}) {
  const a = r.address || {};
  const city = a.city || a.town || a.municipality || '';
  const barangay = a.suburb || a.village || a.hamlet || a.quarter || '';
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  // Venue = a named place (school, mall, hospital, court…), never a bare road
  const venue = r.name && !NOT_A_VENUE.has(r.category) ? r.name : '';
  const parts = [street, a.quarter && a.quarter !== barangay ? a.quarter : '', barangay, city];
  return {
    venue,
    street,
    barangay,
    city,
    // In PH data `state` is the province (e.g. "Bukidnon"); `region` is "Northern Mindanao" and is ignored
    province: a.province || a.state || CITY_PROVINCE[city] || '',
    address: [...new Set(parts.filter(Boolean))].join(', '),
  };
}

export function osmLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}
