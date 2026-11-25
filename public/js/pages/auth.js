import { api, session } from '../api.js';
import { initPage } from '../layout.js';
import { $, alertBox, showErrors, clearErrors, setBusy, params } from '../ui.js';

await initPage({ auth: 'guest' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const notice = $('#notice');
const reason = params().get('reason');
const reasons = {
  expired: ['warning', 'Your session expired. Please log in again.'],
  session: ['warning', 'Please log in again to continue.'],
  suspended: ['error', 'This account has been suspended. Contact the platform administrators.'],
  logout: ['success', 'You have been logged out.'],
};
if (reasons[reason]) notice.innerHTML = `${alertBox(reasons[reason][0], reasons[reason][1])}<div class="mt-2"></div>`;

function safeNext(fallback) {
  const next = params().get('next');
  // Only allow same-site relative paths
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

async function submit(form, path, body, btnText) {
  const btn = form.querySelector('button[type=submit]');
  setBusy(btn, true, btnText);
  notice.innerHTML = '';
  try {
    const { data } = await api(path, { method: 'POST', body, redirectOn401: false });
    session.set(data.token, data.user);
    location.href = data.user.role === 'admin' ? '/admin.html' : safeNext(data.home);
  } catch (err) {
    setBusy(btn, false);
    notice.innerHTML = alertBox('error', err.message);
    showErrors(form, err.details);
  }
}

const loginForm = $('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(loginForm);
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    const errs = {};
    if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Enter your password';
    if (showErrors(loginForm, errs)) return;
    submit(loginForm, '/auth/login', { email, password }, 'Logging in…');
  });
}

const regForm = $('#register-form');
if (regForm) {
  const bar = $('#pw-bar');
  regForm.password.addEventListener('input', () => {
    const p = regForm.password.value;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Za-z]/.test(p) && /\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p) || /[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    bar.style.width = `${(score / 4) * 100}%`;
    bar.style.background = ['#c8372d', '#c8372d', '#f59e0b', '#0a7c8c', '#15803d'][score];
  });
  regForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(regForm);
    const body = {
      fullName: regForm.fullName.value.trim(),
      email: regForm.email.value.trim(),
      password: regForm.password.value,
      confirmPassword: regForm.confirmPassword.value,
    };
    const errs = {};
    if (body.fullName.length < 2) errs.fullName = 'Enter your full name';
    if (!EMAIL_RE.test(body.email)) errs.email = 'Enter a valid email address';
    if (body.password.length < 8) errs.password = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(body.password) || !/\d/.test(body.password)) errs.password = 'Password must contain at least one letter and one number';
    if (body.password !== body.confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (showErrors(regForm, errs)) return;
    submit(regForm, '/auth/register', body, 'Creating account…');
  });
}
