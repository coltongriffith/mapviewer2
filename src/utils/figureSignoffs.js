// QP sign-offs on published figure versions (supabase/migrations/20261103100000_figure_version_signoff.sql): the
// qualified person's name, credentials, date and an optional note, written once and only ever retracted with a
// reason. Loaded on first use by the /3d versions dialog (src/three-d/versions.js), as drillCertificates.js is.

const plain = (text, cause) => Object.assign(new Error(text), { plain: true, cause });
const MISSING = ['42P01', 'PGRST205', 'PGRST202'];
const ERRORS = {
  SIGNOFF_EXISTS: 'This version is already signed off. Retract that sign-off first.',
  SIGNOFF_NOT_ALLOWED: 'Only editors of this figure can sign off a version.',
  SIGNOFF_RETRACTION_INVALID: 'Give a reason for the retraction, up to 500 characters.',
};
export function signoffError(error, doing) {
  const msg = String(error?.message || ''), code = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (code) return plain(ERRORS[code], error);
  if (/row-level security|permission denied/i.test(msg)) return plain(ERRORS.SIGNOFF_NOT_ALLOWED, error);
  if (MISSING.includes(error?.code)) return plain('QP sign-off is not available on this site yet.', error);
  return plain(`Could not ${doing}${msg ? ` (${msg.replace(/\.$/, '')})` : ''}.`, error);
}

/** A sign-off form's problem, or ''. */
export function checkSignoff({ name, credentials, date, note } = {}) {
  const n = String(name ?? '').trim(), c = String(credentials ?? '').trim();
  if (!n || n.length > 200) return 'Give the qualified person’s name (up to 200 characters).';
  if (!c || c.length > 100) return 'Give their credentials, such as “P.Geo.” (up to 100 characters).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date < '1900-01-01' || date > '2200-12-31') return 'The sign-off date does not look right.';
  if (String(note ?? '').length > 1000) return 'Keep the note to 1000 characters.';
  return '';
}
/** "Signed off by A. Person, P.Geo., on 2026-10-21". */
export const signoffLine = (s) => `Signed off by ${s.name}, ${s.credentials}, on ${s.date}`;
const toSignoff = (r) => ({ id: r.id, versionId: r.version_id, name: r.qp_name, credentials: r.qp_credentials, date: r.signed_on, note: r.note || '',
  createdAt: r.created_at, retractedAt: r.retracted_at || null, reason: r.retraction_reason || '' });

// PNG metadata: an iTXt chunk (UTF-8, uncompressed) before IEND, which is always the last 12 bytes.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
export function pngWithText(png, keyword, text) {
  const enc = new TextEncoder(), data = new Uint8Array([...enc.encode(`iTXt${keyword}`), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const chunk = new Uint8Array(data.length + 8), dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length - 4); chunk.set(data, 4); dv.setUint32(data.length + 4, crc32(data));
  const end = png.length - 12;
  return new Uint8Array([...png.subarray(0, end), ...chunk, ...png.subarray(end)]);
}

/** The read-only bar of signed-off version `v`: its sign-off on the banner `note`, and the box that puts it in the PNG. */
export function barExtras(note, v) {
  note.textContent += ` · ${signoffLine(v.signoff)}`;
  const inc = document.createElement('label');
  inc.innerHTML = '<input type="checkbox" id="ver-inc-signoff"> Sign-off in the PNG’s metadata';
  return [inc];
}
/** Downloads the PNG of version `v`, as `em` (EM3D) draws it, with its sign-off in the metadata (an iTXt Comment). */
export async function downloadSigned(em, v) {
  const url = await em.exportPNG({ view: em.getState().view }), bin = atob(url.slice(url.indexOf(',') + 1)), a = document.createElement('a');
  const text = `${signoffLine(v.signoff)}.${v.signoff.note ? ` ${v.signoff.note}` : ''} Published version ${v.version} · ${v.label} · SHA-256 ${v.contentHash}`;
  a.href = URL.createObjectURL(new Blob([pngWithText(Uint8Array.from(bin, (c) => c.charCodeAt(0)), 'Comment', text)], { type: 'image/png' }));
  a.download = `${(v.name || 'figure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure'}-v${v.version}-signed-off.png`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// One version's sign-off in the /3d versions dialog: who signed it off and, for editors, a button (data-sign) that
// opens the form: a sign-off (written once, as the form says), or the retraction of the live one, which asks for
// the reason. The form's buttons carry data-so: sign, retract or cancel.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const signoffHtml = (v, { canSign, open, date }) => `${v.signoff ? `<small class="ok">${esc(signoffLine(v.signoff))}${v.signoff.note ? ` · ${esc(v.signoff.note)}` : ''}</small>` : ''}
  ${canSign ? `<span class="acct-acts"><button class="btn" type="button" data-sign="${v.version}" aria-label="${v.signoff ? 'Retract the sign-off of' : 'Sign off'} version ${v.version}">${v.signoff ? 'Retract sign-off' : 'Sign off'}</button></span>` : ''}${open ? signoffForm(v, date) : ''}`;
const signoffForm = (v, date) => (v.signoff
  ? `<div class="stack" role="group" aria-label="Retract the sign-off of version ${v.version}"><label class="field"><span>Reason for the retraction</span><input type="text" id="ver-so-reason" maxlength="500" autocomplete="off"></label>
      <div class="row"><button class="btn primary" type="button" data-so="retract">Retract sign-off</button><button class="btn" type="button" data-so="cancel">Cancel</button></div></div>`
  : `<div class="stack" role="group" aria-label="Sign off version ${v.version}">
      <label class="field"><span>Qualified person</span><input type="text" id="ver-so-name" maxlength="200" autocomplete="name"></label>
      <label class="field"><span>Credentials</span><input type="text" id="ver-so-cred" maxlength="100" placeholder="P.Geo." autocomplete="off"></label>
      <label class="field"><span>Sign-off date</span><input type="date" id="ver-so-date" value="${date}"></label>
      <label class="field"><span>Note (optional)</span><input type="text" id="ver-so-note" maxlength="1000" autocomplete="off"></label>
      <p class="muted">A sign-off cannot be edited once recorded; it can only be retracted, with a reason.</p>
      <div class="row"><button class="btn primary" type="button" data-so="sign">Record sign-off</button><button class="btn" type="button" data-so="cancel">Cancel</button></div></div>`);

export const UNAVAILABLE = '<p class="note">QP sign-off is not available on this site yet.</p>';
// A refused form: the dialog's status line says why, and its buttons work again.
function sayIn(root, text) {
  const st = root.querySelector('[role="status"]'); st.className = 'bad'; st.hidden = false; st.textContent = text;
  root.querySelectorAll('[data-so]').forEach((x) => { x.disabled = false; });
}

export function figureSignoffs(sb) {
  const table = () => sb.from('figure_version_signoffs');
  return {
    /** Each version's live sign-off (version id → sign-off), or null when this site has no sign-offs (the migration is not applied). */
    async live(ids) {
      const out = new Map();
      if (!ids.length) return out;
      const { data, error } = await table().select('id, version_id, qp_name, qp_credentials, signed_on, note, created_at, retracted_at, retraction_reason')
        .in('version_id', ids).is('retracted_at', null);
      if (error) { if (MISSING.includes(error.code)) return null; throw signoffError(error, 'load the sign-offs'); }
      (Array.isArray(data) ? data : []).forEach((r) => out.set(r.version_id, toSignoff(r)));
      return out;
    },
    /** `versions` with each one's live sign-off (or null), and .signoffs: false when this site has none. */
    async withSignoffs(versions) {
      const live = await this.live(versions.map((v) => v.id));
      versions.forEach((v) => { v.signoff = live?.get(v.id) || null; });
      return Object.assign(versions, { signoffs: !!live });
    },
    async sign(versionId, o = {}) {
      const bad = checkSignoff(o); if (bad) throw plain(bad);
      const { data, error } = await table().insert({ version_id: versionId, qp_name: String(o.name).trim(), qp_credentials: String(o.credentials).trim(),
        signed_on: o.date, note: String(o.note ?? '').trim() || null }).select().single();
      if (error) throw signoffError(error, 'record the sign-off');
      return toSignoff(data);
    },
    /** The open form's sign-off or retraction of version `v` (act), sent: the line to say, '' on cancel, or null when
     * refused, which the dialog (`root`) then says. */
    async submit(root, v, act) {
      const val = (id) => root.querySelector(`#ver-so-${id}`)?.value ?? '';
      try {
        if (act === 'cancel') return '';
        if (act === 'retract') { await this.retract(v.signoff.id, val('reason')); return `The sign-off of version ${v.version} was retracted.`; }
        const so = await this.sign(v.id, { name: val('name'), credentials: val('cred'), date: val('date'), note: val('note') });
        return `Version ${v.version}: ${signoffLine(so)}.`;
      } catch (err) { sayIn(root, err.message); return null; }
    },
    async retract(id, reason) {
      const r = String(reason ?? '').trim();
      if (!r || r.length > 500) throw plain(ERRORS.SIGNOFF_RETRACTION_INVALID);
      const { data, error } = await table().update({ retraction_reason: r }).eq('id', id).select().single();
      if (error) throw signoffError(error, 'retract the sign-off');
      return toSignoff(data);
    },
  };
}
