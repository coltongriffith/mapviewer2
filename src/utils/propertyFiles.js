// Property data library: a thin client over
// supabase/migrations/20261025100000_property_files.sql.
//
// A file has numbered versions; each version's bytes live in the private
// bucket property-files at <org>/<property>/<file>/v<n>/<name>. The browser
// uploads the bytes, then add_property_file_version records them (and checks
// the folder, the version number and that the object is there).
//
// library(client) takes the Supabase client to use, so the app and the
// standalone 3D page (which loads its own client lazily) share this code.

export const BUCKET = 'property-files';
export const MAX_BYTES = 100 * 1024 * 1024;
export const FILE_KINDS = [
  { value: 'drill', label: 'Drill data' },
  { value: 'claims', label: 'Claims' },
  { value: 'layer', label: 'Map layer' },
  { value: 'geophysics', label: 'Geophysics' },
  { value: 'document', label: 'Document' },
  { value: 'other', label: 'Other' },
];
export const kindLabel = (kind) => FILE_KINDS.find((k) => k.value === kind)?.label || 'Other';

/** A first guess at { kind, role } from a file name; the uploader can change the kind. */
export function guessKind(name) {
  const n = String(name || '').toLowerCase();
  const ext = n.includes('.') ? n.split('.').pop() : '';
  const words = n.replace(/\.[^.]*$/, '').split(/[^a-z0-9]+/);
  const has = (re) => words.some((w) => re.test(w));
  const table = ['csv', 'txt', 'xlsx', 'xls'].includes(ext);
  const role = has(/^collars?$/) ? 'collars' : has(/^surveys?$/) ? 'surveys' : has(/^assays?$/) ? 'assays'
    : has(/^(lith|litho|lithology|geology|geol|alteration)$/) ? 'lith' : null;
  if (table && role) return { kind: 'drill', role };
  if (['xyz', 'grd', 'gdb'].includes(ext) || has(/^(mag|magnetics|ip|em|vtem|ztem|grav|gravity|geophys|geophysics|chargeability|resistivity)$/)) return { kind: 'geophysics', role: null };
  if (has(/^(claims?|tenures?|licen[cs]es?|mineral_titles)$/)) return { kind: 'claims', role: null };
  if (['geojson', 'json', 'kml', 'kmz', 'shp', 'zip', 'gpkg'].includes(ext)) return { kind: 'layer', role: null };
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xlsx', 'xls', 'md'].includes(ext)) return { kind: 'document', role: null };
  if (table) return { kind: 'drill', role: null };
  return { kind: 'other', role: null };
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
}

// Storage names: no slashes, the extension kept (as the 3D maker does).
export const safeName = (name) => (String(name).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file');

export async function sha256Hex(buffer) {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Figure files whose library file has a newer version than the one the
 * figure was made with. refs: { [figure file name]: { libFileId, version } };
 * files: the property's list(). → [{ name, from, file }]
 */
export function staleRefs(refs, files) {
  const byId = new Map((files || []).map((f) => [f.id, f]));
  return Object.entries(refs || {}).flatMap(([name, ref]) => {
    const file = byId.get(ref?.libFileId);
    return file && file.version > (ref.version || 0) ? [{ name, from: ref.version, file }] : [];
  });
}

const MESSAGES = [
  [/ORG_READ_ONLY/, 'You have view-only access here. Ask an admin of the workspace for editor access.'],
  [/VERSION_CONFLICT/, 'Someone else uploaded a new version of this file just now. Refresh and try again.'],
  [/FILE_NOT_UPLOADED|FILE_PATH_UNEXPECTED/, 'The upload did not finish. Try again.'],
  [/only an owner or admin/, 'Only an owner or admin can delete a data file.'],
  [/NOT_FOUND/, 'That file or property was not found. It may have been deleted.'],
  [/maximum allowed size|too large|payload/i, 'That file is larger than 100 MB, the limit for one file.'],
  [/forbidden|permission denied|row-level security/i, 'You do not have permission to do that in this workspace.'],
];
export function libraryError(err) {
  const msg = String(err?.message || err || '');
  const hit = MESSAGES.find(([re]) => re.test(msg));
  const e = new Error(hit ? hit[1] : (msg || 'Something went wrong.'));
  e.code = (msg.match(/^[A-Z_]{4,}/) || [])[0] || err?.code;
  e.cause = err;
  return e;
}

const toFile = (r) => ({
  id: r.id, name: r.name, kind: r.kind, role: r.role || null, version: r.version,
  updatedAt: r.uploaded_at || r.updated_at, by: r.uploaded_by_email || null,
  bytes: r.bytes, sha256: r.sha256, path: r.path, note: r.note || null,
});

export function library(sb) {
  if (!sb) throw new Error('The data library needs an Exploration Maps account, which is not available on this site right now.');
  const store = () => sb.storage.from(BUCKET);
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw libraryError(error);
    return data;
  }
  return {
    /** A property's live files, each with its current version. */
    async list(propertyId) {
      const rows = await rpc('list_property_files', { p_property: propertyId });
      return (Array.isArray(rows) ? rows : []).map(toFile);
    },

    /**
     * Adds `file` (a File or Blob with a name) to `property` ({ id, org_id }),
     * or as a new version of `existing` (an entry from list()). The same bytes
     * as the current version record nothing: { unchanged: true }.
     */
    async upload({ property, file, existing = null, kind = null, note = null }) {
      if (!file) throw new Error('Choose a file to upload.');
      if (file.size > MAX_BYTES) throw libraryError('too large');
      const hash = await sha256Hex(await file.arrayBuffer());
      // Compare against the file as it is now, not as this page last listed it.
      const cur = existing && (await this.list(property.id)).find((f) => f.id === existing.id);
      if (existing && !cur) throw libraryError('NOT_FOUND');
      if (cur && cur.sha256 === hash) return { fileId: cur.id, version: cur.version, unchanged: true };
      const fileId = cur?.id || crypto.randomUUID();
      const version = (cur?.version || 0) + 1;
      // Each upload gets its own object, so two editors racing for the same version
      // never share bytes: the second one's record is refused as a version conflict.
      const tag = crypto.randomUUID().slice(0, 8);
      const path = `${property.org_id}/${property.id}/${fileId}/v${version}/${tag}-${safeName(file.name)}`;
      const { error } = await store().upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw libraryError(error);
      const guess = guessKind(file.name);
      const r = await rpc('add_property_file_version', {
        p_property: property.id, p_file: fileId, p_name: cur?.name || file.name,
        p_kind: kind || guess.kind, p_role: guess.role, p_path: path, p_bytes: file.size, p_sha256: hash, p_note: note || null,
      });
      return { fileId: r.file_id, version: r.version, unchanged: !!r.unchanged };
    },

    /** A short-lived link that downloads the version at `path` as `name`. */
    async downloadUrl(path, name, expiresIn = 300) {
      const { data, error } = await store().createSignedUrl(path, expiresIn, { download: name || true });
      if (error || !data?.signedUrl) throw libraryError(error || 'NOT_FOUND');
      return data.signedUrl;
    },

    async text(path) {
      const { data, error } = await store().download(path);
      if (error) throw libraryError(error);
      return data.text();
    },

    /** Soft delete (admins). Its versions stay, so it can be restored. */
    async remove(fileId) {
      const { data, error } = await sb.from('property_files').update({ deleted_at: new Date().toISOString() }).eq('id', fileId).select('id');
      if (error) throw libraryError(error);
      if (!data?.length) throw libraryError('NOT_FOUND');
    },
  };
}
