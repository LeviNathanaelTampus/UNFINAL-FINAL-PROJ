import { api, getMeta, session, imageUrl, uploadImage } from '../api.js';
import { initPage } from '../layout.js';
import {
  $, esc, icon, withState, emptyHtml, renderPagination, debounce, openModal, showErrors, clearErrors, setBusy, toast, loadingHtml,
} from '../ui.js';

await initPage();
const meta = await getMeta();
const form = $('#filters');
const state = { page: 1 };
$('#type').insertAdjacentHTML('beforeend', Object.entries(meta.organizationTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));

async function load() {
  const list = $('#list');
  const res = await withState(list, () => api('/organizations', { query: { q: form.q.value.trim(), type: form.type.value, page: state.page }, redirectOn401: false }), { onRetry: load });
  if (!res) return;
  const { data, meta: m } = res;
  if (!data.length) {
    list.innerHTML = `<div class="card">${emptyHtml({ icon: 'building', title: 'No organizations found', text: 'Create one for your healthcare group, student organization, or community group.' })}</div>`;
    $('#pager').innerHTML = '';
    return;
  }
  list.innerHTML = `<div class="grid grid-3">${data.map((o) => `<a class="card" href="/organization.html?id=${esc(o._id)}" style="color:inherit;text-decoration:none"><div class="card-body row" style="align-items:flex-start">
    <span class="avatar avatar-lg" style="width:56px;height:56px;border-radius:12px">${o.logo ? `<img src="${imageUrl(o.logo)}" alt="">` : icon('building')}</span>
    <div class="grow"><strong>${esc(o.name)}</strong> ${o.verificationStatus === 'verified' ? `<span class="verified" title="Verified organization">${icon('shieldCheck')}</span>` : ''}
      <div class="text-xs muted">${esc(meta.organizationTypes[o.type] || '')}${o.location ? ` · ${esc(o.location)}` : ''}</div>
      ${o.description ? `<p class="text-sm muted mt-1 mb-0" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(o.description)}</p>` : ''}
    </div></div></a>`).join('')}</div>`;
  renderPagination($('#pager'), m, (p) => { state.page = p; load(); });
}

form.addEventListener('input', debounce(() => { state.page = 1; load(); }, 350));
form.addEventListener('submit', (e) => e.preventDefault());

$('#create-btn').onclick = () => {
  if (!session.user) { location.href = `/login.html?next=${encodeURIComponent('/organizations.html')}`; return; }
  let logo = null;
  const m = openModal({
    title: 'Create an organization',
    size: 'modal-lg',
    body: `<form id="org-form" class="stack" novalidate>
      <div class="form-grid">
        <div class="field span-2"><label for="o-name">Organization name <span class="req">*</span></label><input class="input" id="o-name" name="name" maxlength="120"></div>
        <div class="field"><label for="o-type">Type <span class="req">*</span></label><select class="select" id="o-type" name="type">${Object.entries(meta.organizationTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label for="o-location">Location</label><input class="input" id="o-location" name="location" maxlength="200" placeholder="e.g. Cagayan de Oro City"></div>
        <div class="field span-2"><label for="o-desc">Description</label><textarea class="textarea" id="o-desc" name="description" maxlength="3000" rows="3"></textarea></div>
        <div class="field"><label for="o-email">Contact email</label><input class="input" type="email" id="o-email" name="contact.email" maxlength="254"></div>
        <div class="field"><label for="o-phone">Contact phone</label><input class="input" id="o-phone" name="contact.phone" maxlength="30"></div>
        <div class="field span-2"><label for="o-web">Website or page</label><input class="input" id="o-web" name="contact.website" maxlength="300" placeholder="https://"></div>
        <div class="field span-2"><label for="o-logo">Logo</label><input class="input" type="file" id="o-logo" accept="image/jpeg,image/png,image/webp"><span class="hint" id="logo-status"></span></div>
      </div>
      <p class="text-xs muted mb-0">You'll become the owner and can add members. Organizations start unverified; administrators may verify them.</p>
    </form>`,
    footer: '<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="org-save">Create organization</button>',
  });
  const f = m.el.querySelector('#org-form');
  f.querySelector('#o-logo').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const st = m.el.querySelector('#logo-status');
    st.innerHTML = loadingHtml('Uploading…');
    try { logo = await uploadImage(file, 'logo'); st.textContent = 'Logo uploaded ✓'; } catch (err) { st.textContent = err.message; logo = null; }
  };
  const btn = m.el.querySelector('#org-save');
  btn.onclick = async () => {
    clearErrors(f);
    const body = {
      name: f.name.value.trim(), type: f.type.value, location: f.location.value.trim(), description: f.description.value.trim(), logo,
      contact: { email: f['contact.email'].value.trim(), phone: f['contact.phone'].value.trim(), website: f['contact.website'].value.trim() },
    };
    const errs = {};
    if (body.name.length < 2) errs.name = 'Enter the organization name';
    if (body.contact.website && !/^https?:\/\//i.test(body.contact.website)) errs['contact.website'] = 'Start with http:// or https://';
    if (showErrors(f, errs)) return;
    setBusy(btn, true, 'Creating…');
    try {
      const { data } = await api('/organizations', { method: 'POST', body });
      toast('Organization created.', 'success');
      location.href = `/organization.html?id=${data._id}`;
    } catch (err) { setBusy(btn, false); showErrors(f, err.details); toast(err.message, 'error'); }
  };
};

load();
