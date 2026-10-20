// Exploration Maps 3D: send the figure and its layers to the design desk (the Teams enquiry). Loaded on
// first use by studio.js, from the Export step's form or EM3D.sendToDesignDesk.
const $ = (id) => document.getElementById(id);
let H = null; // host (studio.js)
export function init(host) { H = host; }
// Same flow as /teams: POST the enquiry to /api/track, which answers with one signed upload URL per declared
// file; each file is then PUT straight to storage. 204 means accepted without uploads (automated browsers).
const DESK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, DESK_MAX_BYTES = 50 * 1024 * 1024;
function teamsSessionId() {
  try { let id = sessionStorage.getItem('em.teams.sid'); if (!id) { id = crypto.randomUUID().replace(/-/g, ''); sessionStorage.setItem('em.teams.sid', id); } return id; } catch { return crypto.randomUUID().replace(/-/g, ''); }
}
function deskMsg(text, kind) { const el = $('desk-msg'); el.textContent = text; el.className = `desk-msg ${kind || ''}`; el.hidden = !text; }
let deskBusy = false;
export async function sendToDesignDesk(o = {}) {
  const email = String(o.email ?? '').trim(), company = String(o.company ?? '').trim(), notes = String(o.notes ?? '').trim();
  if (!DESK_EMAIL_RE.test(email)) throw new Error('Enter your work email so we can reply.');
  if (!company) throw new Error('Enter your company name.');
  if (!H.G) throw new Error('Nothing to send yet: add a collar file and an assay file.');
  if (deskBusy) throw new Error('Already sending.');
  deskBusy = true;
  const step = (t) => { H.status(t); deskMsg(t, 'busy'); const b = $('desk-send'); b.disabled = true; b.textContent = t.replace(/…$/, '…'); };
  try {
    step('Preparing the figure and layers…');
    const made = [['figure.png', await H.canvasBlob(H.figureCanvas('3d'))], ['layers.zip', await H.exportLayers({ as: 'blob' })]];
    // Over the 50 MB upload limit: not sent, and said so below rather than dropped quietly.
    const blobs = made.filter(([, b]) => b.size <= DESK_MAX_BYTES), tooBig = made.filter(([, b]) => b.size > DESK_MAX_BYTES).map(([n]) => n);
    step('Sending to the design desk…');
    const body = { kind: 'team_enquiry', session_id: teamsSessionId(), email, company, materials: ['sections_3d'], service_level: 'not_sure',
      message: `${notes}${notes ? ' ' : ''}(sent from Exploration Maps 3D)`, ref: '3d', files: blobs.map(([name, b]) => ({ name, size: b.size, type: b.type || (name.endsWith('.zip') ? 'application/zip' : 'image/png') })) };
    const res = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) throw new Error('No connection to the design desk. Check your internet and try again.');
    if (res.status === 429) throw new Error('Too many requests from this connection. Please wait a few minutes, or email support@explorationmaps.com.');
    if (!res.ok) throw new Error(res.status === 503 ? 'The design desk is not taking requests right now (error 503). Please try again later, or email support@explorationmaps.com.' : `The design desk could not take that (error ${res.status}). Please try again, or email support@explorationmaps.com.`);
    const out = res.status === 200 ? await res.json().catch(() => ({})) : { uploads: null };
    const uploaded = [], failed = [...tooBig];
    if (out.uploads) for (let i = 0; i < blobs.length; i++) {
      const [name, b] = blobs[i], slot = out.uploads.find((x) => x?.name === name) || out.uploads[i];
      if (!slot?.url) { failed.push(name); continue; }
      step(`Uploading ${i + 1} of ${blobs.length}…`);
      const up = await fetch(slot.url, { method: 'PUT', headers: { 'Content-Type': b.type || 'application/octet-stream', 'x-upsert': 'false' }, body: b }).catch(() => null);
      (up?.ok ? uploaded : failed).push(name);
    }
    const lost = failed.filter((n) => !tooBig.includes(n));
    const msg = `Sent. We'll reply to ${email}.${tooBig.length ? ` ${tooBig.join(' and ')} is over 50 MB and was not sent; we'll ask for it by email.` : ''}${lost.length ? ` ${lost.join(' and ')} did not upload; we'll ask for ${lost.length > 1 ? 'them' : 'it'} by email.` : ''}`;
    H.status(msg); deskMsg(msg, 'ok'); $('desk').classList.add('sent');
    window.gtag?.('event', 'teams_enquiry_sent', { materials: 1, files: uploaded.length, ref: '3d' });
    return { ok: true, id: out.id || null, uploaded, failed, accepted: res.status };
  } catch (e) {
    H.status(e.message); deskMsg(e.message, 'bad'); throw e;
  } finally { deskBusy = false; const b = $('desk-send'); b.disabled = false; b.textContent = 'Send figure and layers'; }
}
// The form's submit (studio.js calls this once the module is loaded).
export function submit() {
  ['desk-email', 'desk-company'].forEach((id) => $(id).removeAttribute('aria-invalid'));
  const email = $('desk-email').value, company = $('desk-company').value;
  if (!DESK_EMAIL_RE.test(email.trim())) { deskMsg('Enter your work email so we can reply.', 'bad'); $('desk-email').setAttribute('aria-invalid', 'true'); $('desk-email').focus(); return; }
  if (!company.trim()) { deskMsg('Enter your company name.', 'bad'); $('desk-company').setAttribute('aria-invalid', 'true'); $('desk-company').focus(); return; }
  sendToDesignDesk({ email, company, notes: $('desk-notes').value }).catch(() => {});
}
