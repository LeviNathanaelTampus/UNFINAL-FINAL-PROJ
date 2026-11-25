// GoodNeighbor Health — API client & session store
const TOKEN_KEY = 'gn_token';
const USER_KEY = 'gn_user';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

export const session = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  set(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch { /* storage unavailable */ }
  },
  setUser(user) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  },
  get isLoggedIn() { return Boolean(this.token); },
  get isAdmin() { return this.user?.role === 'admin'; },
};

function redirectToLogin(reason) {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/login.html?next=${next}${reason ? `&reason=${reason}` : ''}`;
}

/**
 * Call the API.
 * @param {string} path  e.g. '/initiatives'
 * @param {{method?:string, body?:object, form?:FormData, query?:object, idempotencyKey?:string, auth?:boolean, redirectOn401?:boolean}} opts
 * @returns {Promise<{data:any, meta:any}>}
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, form, query, idempotencyKey, redirectOn401 = true } = opts;
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, v); });
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, navigator.onLine === false
      ? 'You appear to be offline. Your changes were not sent — please reconnect and try again.'
      : 'Could not reach the server. Your changes were not sent — please try again.');
  }

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok || !json || json.success === false) {
    const message = json?.error?.message || (res.status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${res.status})`);
    const details = json?.error?.details;
    if (res.status === 401 && session.token) {
      session.clear();
      if (redirectOn401) redirectToLogin(details?.code === 'TOKEN_EXPIRED' ? 'expired' : 'session');
    }
    throw new ApiError(res.status, message, details);
  }
  return { data: json.data, meta: json.meta };
}

/** Fetch a protected file (receipts, verification docs) and return an object URL. */
export async function protectedFileUrl(path) {
  const res = await fetch(`/api${path}`, { headers: session.token ? { Authorization: `Bearer ${session.token}` } : {} });
  if (!res.ok) {
    let msg = 'Could not load file';
    try { msg = (await res.json()).error.message; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

/** Upload a public image (cover, avatar, logo, QR). Returns fileId. */
export async function uploadImage(file, purpose) {
  const form = new FormData();
  form.append('image', file);
  form.append('purpose', purpose);
  const { data } = await api('/files/images', { method: 'POST', form });
  return data.fileId;
}

export const imageUrl = (id) => (id ? `/api/files/public/${id}` : null);

export function newIdempotencyKey() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Reference data (categories etc.) with offline-safe fallback
const META_FALLBACK = {
  categories: {
    medical_mission: 'Medical Mission',
    blood_donation: 'Blood Donation Drive',
    health_awareness: 'Health Awareness Campaign',
    health_education_seminar: 'Healthcare Education Seminar',
    community_wellness: 'Community Wellness Program',
    healthcare_outreach: 'Healthcare Outreach',
    other: 'Other Healthcare Initiative',
  },
  hostingRules: {},
  paymentProviders: { gcash: 'GCash', qrph: 'QR Ph', bank: 'Online Banking', other: 'Other' },
  organizationTypes: { healthcare: 'Healthcare Organization', student: 'Student Organization', community: 'Community Organization', ngo: 'Non-Government Organization', other: 'Other' },
  defaultCenter: { lat: 8.4542, lng: 124.6319 },
  uploads: { maxImageMB: 5, maxDocMB: 8 },
  features: { ai: false, receiptAnalysis: false, email: false },
};
let metaPromise = null;
export function getMeta() {
  if (!metaPromise) {
    metaPromise = (async () => {
      try {
        const cached = sessionStorage.getItem('gn_meta');
        if (cached) return JSON.parse(cached);
      } catch { /* ignore */ }
      try {
        const { data } = await api('/meta', { redirectOn401: false });
        try { sessionStorage.setItem('gn_meta', JSON.stringify(data)); } catch { /* ignore */ }
        return data;
      } catch {
        return META_FALLBACK;
      }
    })();
  }
  return metaPromise;
}
export { META_FALLBACK };
