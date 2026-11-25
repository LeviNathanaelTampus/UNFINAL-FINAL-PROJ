// Shared page chrome: header, footer, auth guards, offline banner, notification badge
import { api, session } from './api.js';
import { esc, icon, LOGO, avatar, $, toast } from './ui.js';

function navLinks() {
  const u = session.user;
  const links = [['/explore.html', 'Explore']];
  if (u && u.role !== 'admin') links.push(['/dashboard.html', 'Dashboard'], ['/host.html', 'Host']);
  if (!u) links.push(['/host.html', 'Host an initiative']);
  links.push(['/organizations.html', 'Organizations']);
  if (u?.role === 'admin') links.push(['/admin.html', 'Admin']);
  return links;
}

function renderHeader() {
  const el = document.getElementById('site-header') || document.body.insertBefore(document.createElement('header'), document.body.firstChild);
  el.id = 'site-header';
  el.className = 'site-header';
  const u = session.user;
  const here = location.pathname === '/' ? '/index.html' : location.pathname;
  const nav = navLinks().map(([href, label]) => `<a href="${href}" class="${here === href ? 'active' : ''}" ${here === href ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  const right = u
    ? `<a href="/notifications.html" class="icon-btn" aria-label="Notifications" id="bell">${icon('bell')}<span class="dot-count" id="bell-count" hidden></span></a>
       <div class="dropdown">
         <button class="icon-btn" id="user-menu-btn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu" style="width:auto;padding:0 4px">${avatar(u, 'avatar-sm')}</button>
         <div class="dropdown-menu" id="user-menu" hidden role="menu">
           <div class="dropdown-head"><strong class="truncate" style="display:block">${esc(u.fullName)}</strong><span class="text-xs muted truncate" style="display:block">${esc(u.email)}</span></div>
           ${u.role === 'admin'
    ? `<a href="/admin.html" role="menuitem">${icon('shield')} Admin dashboard</a>`
    : `<a href="/dashboard.html" role="menuitem">${icon('home')} Dashboard</a>
              <a href="/profile.html" role="menuitem">${icon('user')} My profile</a>
              <a href="/history.html" role="menuitem">${icon('history')} Participation history</a>
              <a href="/host.html" role="menuitem">${icon('clipboard')} Host dashboard</a>`}
           <hr><button id="logout-btn" role="menuitem">${icon('logout')} Log out</button>
         </div>
       </div>`
    : `<a href="/login.html" class="btn btn-ghost btn-sm">Log in</a><a href="/register.html" class="btn btn-primary btn-sm">Sign up</a>`;

  el.innerHTML = `<div class="container">
    <a href="/" class="brand" aria-label="GoodNeighbor Health home">${LOGO}<span>GoodNeighbor<small>Health</small></span></a>
    <nav class="nav" id="main-nav" aria-label="Main">${nav}</nav>
    <div class="header-actions">${right}
      <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="main-nav">${icon('menu')}</button>
    </div></div>`;

  const toggle = $('#menu-toggle');
  toggle.onclick = () => {
    const open = $('#main-nav').classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  const btn = $('#user-menu-btn');
  if (btn) {
    const menu = $('#user-menu');
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    $('#logout-btn').onclick = () => {
      session.clear();
      location.href = '/login.html?reason=logout';
    };
  }
}

function renderFooter() {
  let el = document.getElementById('site-footer');
  if (!el) { el = document.createElement('footer'); el.id = 'site-footer'; document.body.appendChild(el); }
  el.className = 'site-footer';
  el.innerHTML = `<div class="container">
    <div class="footer-grid">
      <div><a href="/" class="brand">${LOGO}<span>GoodNeighbor<small>Health</small></span></a>
        <p class="mt-2" style="max-width:380px">A centralized platform connecting healthcare initiative hosts with volunteers across Northern Mindanao.</p>
        <p class="text-xs">GoodNeighbor Health is a volunteer coordination platform. It does not provide medical advice or diagnosis.</p></div>
      <div><h4>Platform</h4><ul><li><a href="/explore.html">Explore initiatives</a></li><li><a href="/host.html">Host an initiative</a></li><li><a href="/organizations.html">Organizations</a></li></ul></div>
      <div><h4>Account</h4><ul>${session.isAdmin ? '<li><a href="/admin.html">Admin dashboard</a></li>' : session.user ? '<li><a href="/dashboard.html">Dashboard</a></li><li><a href="/profile.html">Profile & verification</a></li>' : '<li><a href="/register.html">Create an account</a></li><li><a href="/login.html">Log in</a></li>'}</ul></div>
    </div>
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} GoodNeighbor Health</span></div>
  </div>`;
}

function setupOffline() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = 'You are offline. You can keep editing — unsent changes stay on this device until you reconnect.';
  banner.hidden = navigator.onLine !== false;
  document.body.appendChild(banner);
  window.addEventListener('offline', () => { banner.hidden = false; });
  window.addEventListener('online', () => { banner.hidden = true; toast('You are back online.', 'success', 2500); });
}

let pollTimer;
async function refreshBell() {
  const badge = document.getElementById('bell-count');
  if (!badge || !session.token || document.hidden) return;
  try {
    const { data } = await api('/notifications/unread-count', { redirectOn401: false });
    badge.hidden = !data.unread;
    badge.textContent = data.unread > 99 ? '99+' : data.unread;
  } catch { /* silent */ }
}
export function updateBell(n) {
  const badge = document.getElementById('bell-count');
  if (!badge) return;
  badge.hidden = !n;
  badge.textContent = n > 99 ? '99+' : n;
}

/** Initialise page chrome. Options: { auth: 'required'|'guest'|'admin'|'user'|undefined } */
export async function initPage(opts = {}) {
  if (opts.auth && opts.auth !== 'guest' && !session.token) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});
  }
  if (opts.auth === 'guest' && session.token) {
    location.href = session.isAdmin ? '/admin.html' : '/dashboard.html';
    return new Promise(() => {});
  }
  // Refresh the cached user (role/verification changes, suspension)
  if (session.token) {
    try {
      const { data } = await api('/auth/me');
      session.setUser(data.user);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        session.clear();
        if (opts.auth) { location.href = `/login.html?reason=${err.status === 403 ? 'suspended' : 'session'}`; return new Promise(() => {}); }
      }
      // Offline / server down: continue with cached user
    }
  }
  if (opts.auth === 'admin' && !session.isAdmin) { location.href = '/dashboard.html'; return new Promise(() => {}); }
  if (opts.auth === 'user' && session.isAdmin) { location.href = '/admin.html'; return new Promise(() => {}); }

  renderHeader();
  renderFooter();
  setupOffline();
  if (session.token) {
    refreshBell();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshBell, 60000);
    document.addEventListener('visibilitychange', refreshBell);
  }
  return session.user;
}
