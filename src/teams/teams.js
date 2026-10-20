// Exploration Maps for Teams (/teams): pricing text and the enquiry form.
//
// The form posts to /api/track (kind 'team_enquiry'), which stores the
// enquiry, emails the owner, and returns one signed upload URL per declared
// file; files then go straight to the private storage bucket.

// Program terms per service level, shown on the plan cards. Leave a field empty
// while scope and costs are validated: an empty price keeps "Quoted after a
// scoping call", and empty terms hide the line.
//   price:    e.g. 'From $2,000 / month'
//   terms:    e.g. 'Up to 6 updated figures a month · 2 business days from clean data'
const PLANS = {
  managed_maps: { price: '', terms: '' },
  maps_presentation: { price: '', terms: '' },
  corporate: { price: '', terms: '' },
};

const MAX_FILES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

document.querySelectorAll('[data-plan-price]').forEach((el) => {
  const p = PLANS[el.dataset.planPrice]?.price;
  if (p) el.textContent = p;
});
document.querySelectorAll('[data-plan-terms]').forEach((el) => {
  const t = PLANS[el.dataset.planTerms]?.terms;
  if (t) { el.textContent = t; el.hidden = false; }
});
const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

function sessionId() {
  try {
    let id = sessionStorage.getItem('em.teams.sid');
    if (!id) { id = crypto.randomUUID().replace(/-/g, ''); sessionStorage.setItem('em.teams.sid', id); }
    return id;
  } catch {
    return crypto.randomUUID().replace(/-/g, '');
  }
}

const form = document.getElementById('enquiry');
const errorEl = document.getElementById('form-error');
const submit = document.getElementById('submit');
const params = new URLSearchParams(location.search);
const ref = (params.get('ref') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);

// A plan's button picks that level; a link from the 3D maker ticks 3D.
document.querySelectorAll('[data-level]').forEach((a) => a.addEventListener('click', () => { form.elements.service_level.value = a.dataset.level; }));
if (ref === '3d') form.querySelector('input[value="sections_3d"]').checked = true;
// "Free review" links tick that option and point the message box at it.
const review = () => {
  form.querySelector('input[value="map_review"]').checked = true;
  if (!form.elements.message.value) form.elements.message.placeholder = 'Attach your latest news-release map or deck below, or paste a link to it here';
};
document.querySelectorAll('[data-review]').forEach((a) => a.addEventListener('click', review));
if (params.has('review')) review();

function fail(msg, field) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const f = form.elements;
  const email = f.email.value.trim();
  const company = f.company.value.trim();
  if (!EMAIL_RE.test(email)) return fail('Enter your work email so we can reply.', f.email);
  if (!company) return fail('Enter your company name.', f.company);
  const chosen = [...f.files.files];
  if (chosen.length > MAX_FILES) return fail(`Attach up to ${MAX_FILES} files. Zip a folder to send more.`, f.files);
  const big = chosen.find((x) => x.size > MAX_FILE_BYTES);
  if (big) return fail(`${big.name} is over 50 MB. Zip it, or tell us and we'll share a folder link.`, f.files);

  const body = {
    kind: 'team_enquiry',
    session_id: sessionId(),
    name: f.name.value.trim(),
    email,
    company,
    projects: f.projects.value.trim(),
    materials: [...form.querySelectorAll('input[name="materials"]:checked')].map((x) => x.value),
    service_level: f.service_level.value,
    deadline: f.deadline.value,
    deadline_note: f.deadline_note.value.trim(),
    message: f.message.value.trim(),
    files: chosen.map((x) => ({ name: x.name, size: x.size, type: x.type })),
    ref,
  };
  submit.disabled = true;
  submit.textContent = 'Sending…';
  try {
    const res = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 429) throw new Error('Too many enquiries from this connection. Please wait a few minutes, or email us.');
    if (!res.ok) throw new Error('We could not send that. Please try again, or email support@explorationmaps.com.');
    const out = res.status === 200 ? await res.json() : { uploads: [] };
    const failed = [];
    for (let i = 0; i < chosen.length; i++) {
      const slot = out.uploads?.[i];
      if (!slot?.url) { failed.push(chosen[i].name); continue; }
      submit.textContent = `Uploading ${i + 1} of ${chosen.length}…`;
      const up = await fetch(slot.url, { method: 'PUT', headers: { 'Content-Type': chosen[i].type || 'application/octet-stream', 'x-upsert': 'false' }, body: chosen[i] }).catch(() => null);
      if (!up?.ok) failed.push(chosen[i].name);
    }
    form.hidden = true;
    const sent = document.getElementById('sent');
    document.getElementById('sent-msg').textContent = `We'll reply to ${email} to set up a short call about ${company}.`
      + (failed.length ? ` ${failed.join(', ')} did not upload; we'll ask for ${failed.length > 1 ? 'them' : 'it'} by email.` : '');
    sent.hidden = false;
    sent.focus();
    window.gtag?.('event', 'teams_enquiry_sent', { materials: body.materials.length, files: chosen.length });
  } catch (err) {
    fail(err.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Send enquiry';
  }
});
