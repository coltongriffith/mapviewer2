import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const PROJECTS_KEY = 'mapviewer.projects.v1';
const DRAFT_KEY = 'mapviewer.draft.v1';
const LAST_OPENED_PROJECT_KEY = 'mapviewer.lastProjectId.v1';
const ACCOUNT_SETTINGS_KEY = 'mapviewer.accountSettings.v1';
const GZ_PREFIX = 'gz1:';
const RECOVERY_SUFFIX = '.recovery';

// Schema version stamped on stored project/draft envelopes. Bump when the
// persisted shape changes and add a migration step below. Unversioned records
// (everything written before versioning existed) are treated as version 0.
export const STORAGE_SCHEMA_VERSION = 1;

// Deterministic, ordered migrations: MIGRATIONS[n] upgrades a payload from
// version n to n+1. Version 0 → 1 is structural identity (v1 only introduces
// the version stamp itself), kept explicit so the chain has a template.
const MIGRATIONS = {
  0: (payload) => payload,
};

export function migratePayload(payload, fromVersion) {
  let current = payload;
  for (let v = fromVersion; v < STORAGE_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema v${v}`);
    current = step(current);
    if (current == null) throw new Error(`Migration from schema v${v} produced nothing`);
  }
  return current;
}

// Trim GeoJSON coordinate precision to 6 decimal places (sub-meter accuracy).
// Reduces JSON size by ~35% for dense geometries with no visible quality loss.
function trimCoordinatePrecision(str) {
  return str.replace(/(-?\d+\.\d{7,})/g, (m) => parseFloat(m).toFixed(6));
}

function compress(str) {
  try {
    const trimmed = trimCoordinatePrecision(str);
    const compressed = deflateSync(strToU8(trimmed));
    // btoa expects a binary string
    let binary = '';
    for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
    return GZ_PREFIX + btoa(binary);
  } catch {
    return str;
  }
}

// Marker error so corruption is distinguishable from ordinary parse noise.
class CorruptRecordError extends Error {
  constructor(msg) { super(msg); this.name = 'CorruptRecordError'; }
}

function decompress(str) {
  if (!str || !str.startsWith(GZ_PREFIX)) return str;
  try {
    const b64 = str.slice(GZ_PREFIX.length);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return strFromU8(inflateSync(bytes));
  } catch {
    // A gz1: value that won't inflate is corrupted data — do NOT strip the
    // prefix and hand compressed base64 to JSON.parse as if it were content.
    throw new CorruptRecordError('compressed record failed to decompress');
  }
}

/**
 * Read + parse a stored record. On corruption the ORIGINAL stored value is
 * preserved under `<key>.recovery` (first occurrence wins — a recovery copy
 * is never overwritten), the primary is left untouched, and the caller gets
 * the fallback plus a corruption signal via getRecoveryInfo().
 */
function safeParse(value, fallback, key = null) {
  try {
    if (!value) return fallback;
    const raw = decompress(value);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    if (key && value) preserveCorruptRecord(key, value);
    return fallback;
  }
}

function preserveCorruptRecord(key, value) {
  try {
    const recoveryKey = key + RECOVERY_SUFFIX;
    if (localStorage.getItem(recoveryKey) == null) {
      localStorage.setItem(recoveryKey, value);
    }
  } catch { /* storage full/disabled — the primary copy still holds the bytes */ }
}

/** Corrupted records awaiting manual export/removal. */
export function getRecoveryInfo() {
  const out = [];
  try {
    for (const key of [PROJECTS_KEY, DRAFT_KEY]) {
      const v = localStorage.getItem(key + RECOVERY_SUFFIX);
      if (v != null) out.push({ key, recoveryKey: key + RECOVERY_SUFFIX, bytes: v.length * 2 });
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** Raw corrupted bytes for manual export. */
export function exportRecoveryRecord(key) {
  try { return localStorage.getItem(key + RECOVERY_SUFFIX); } catch { return null; }
}

/** Explicit user-driven removal of a corrupted backup. Never automatic. */
export function discardRecoveryRecord(key) {
  try { localStorage.removeItem(key + RECOVERY_SUFFIX); return true; } catch { return false; }
}

/**
 * Structured storage write. Never throws; never silently lies.
 * → { ok: true } | { ok: false, reason: 'quota'|'disabled'|'unknown', message }
 * Quota failures also dispatch the existing 'storage-quota-exceeded' event
 * that drives the storage warning banner.
 */
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      try { window.dispatchEvent(new CustomEvent('storage-quota-exceeded')); } catch { /* no window */ }
      return { ok: false, reason: 'quota', message: 'Browser storage is full.' };
    }
    if (e?.name === 'SecurityError') {
      return { ok: false, reason: 'disabled', message: 'Browser storage is disabled (private mode or blocked).' };
    }
    return { ok: false, reason: 'unknown', message: e?.message || 'Browser storage write failed.' };
  }
}

// Returns the raw parsed blob (legacy bare array OR versioned envelope);
// unwrapProjects() normalizes either shape to a plain items array.
function readProjects() {
  let stored = null;
  try { stored = localStorage.getItem(PROJECTS_KEY); } catch { return []; }
  return safeParse(stored, [], PROJECTS_KEY);
}

/** → { ok, reason?, message? } — see safeSetItem. */
function writeProjects(projects) {
  let serialized;
  try {
    serialized = JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION, items: projects });
  } catch (e) {
    return { ok: false, reason: 'serialize', message: e?.message || 'Project could not be serialized.' };
  }
  return safeSetItem(PROJECTS_KEY, compress(serialized));
}

// The projects blob historically stored a bare array; versioned form is
// { schemaVersion, items }. Both shapes remain readable forever.
function unwrapProjects(parsed) {
  if (Array.isArray(parsed)) return parsed;                       // legacy v0
  if (parsed && Array.isArray(parsed.items)) {
    const from = Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 0;
    try {
      return parsed.items.map((item) => item?.payload
        ? { ...item, payload: migratePayload(item.payload, Math.min(from, STORAGE_SCHEMA_VERSION)) }
        : item);
    } catch {
      // Migration failed: serve the untouched stored items rather than lose
      // data — the stored copy was never mutated.
      return parsed.items;
    }
  }
  return [];
}

export function estimateStorageUsedBytes() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      total += (k?.length || 0) * 2 + (v?.length || 0) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}

// Account-level defaults (company, QP info, projection) for anonymous users —
// the localStorage mirror of the cloud `account_settings` table.
export function getAccountSettingsLocal() {
  try {
    return safeParse(localStorage.getItem(ACCOUNT_SETTINGS_KEY), {});
  } catch { return {}; }
}

export function saveAccountSettingsLocal(settings) {
  safeSetItem(ACCOUNT_SETTINGS_KEY, JSON.stringify(settings || {}));
  return settings || {};
}

export function listProjects() {
  return unwrapProjects(readProjects())
    .filter((item) => item && item.id && item.payload)
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

/**
 * Save/update a local project record. Returns the record with a `storage`
 * result attached — callers MUST check storage.ok before reporting success.
 */
export function saveProjectRecord({ id, name, payload }) {
  const now = new Date().toISOString();
  const projects = unwrapProjects(readProjects());
  const next = {
    id,
    name: name || payload?.layout?.title || 'Untitled map',
    updatedAt: now,
    payload,
  };
  const index = projects.findIndex((item) => item.id === id);
  if (index >= 0) projects[index] = next;
  else projects.push(next);
  const storage = writeProjects(projects);
  if (storage.ok) safeSetItem(LAST_OPENED_PROJECT_KEY, id);
  return { ...next, storage };
}

export function duplicateProjectRecord({ sourcePayload, name }) {
  return saveProjectRecord({
    id: crypto.randomUUID(),
    name,
    payload: sourcePayload,
  });
}

export function getProjectRecord(id) {
  return listProjects().find((item) => item.id === id) || null;
}

// Cheap, targeted thumbnail-only update — doesn't bump updatedAt/sort order
// or rewrite payload, so a background thumbnail refresh stays invisible.
export function updateProjectThumbnailRecord(id, thumbnail) {
  const projects = unwrapProjects(readProjects());
  const index = projects.findIndex((item) => item.id === id);
  if (index < 0) return false;
  projects[index] = { ...projects[index], thumbnail };
  return writeProjects(projects).ok;
}

/** → { ok, reason?, message? } — the caller decides how loudly to fail. */
export function saveDraft({ payload, projectId, projectName }) {
  const result = safeSetItem(DRAFT_KEY, compress(JSON.stringify({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    payload,
    projectId: projectId || null,
    projectName: projectName || null,
    updatedAt: new Date().toISOString(),
  })));
  if (result.ok) {
    if (projectId) safeSetItem(LAST_OPENED_PROJECT_KEY, projectId);
    else { try { localStorage.removeItem(LAST_OPENED_PROJECT_KEY); } catch { /* noop */ } }
  }
  return result;
}

export function loadDraft() {
  let stored = null;
  try { stored = localStorage.getItem(DRAFT_KEY); } catch { return null; }
  const draft = safeParse(stored, null, DRAFT_KEY);
  if (!draft) return null;
  const from = Number.isInteger(draft.schemaVersion) ? draft.schemaVersion : 0;
  if (from < STORAGE_SCHEMA_VERSION && draft.payload) {
    try {
      return { ...draft, payload: migratePayload(draft.payload, from) };
    } catch {
      return draft; // stored copy untouched; serve it as-is
    }
  }
  return draft;
}

export function resolveInitialWorkspace(fallbackProject) {
  const draft = loadDraft();
  if (draft?.payload) {
    return {
      project: draft.payload,
      projectId: draft.projectId || null,
      projectName: draft.projectName || draft.payload?.layout?.title || 'Untitled map',
    };
  }

  return {
    project: fallbackProject,
    projectId: null,
    projectName: fallbackProject?.layout?.title || 'Untitled map',
  };
}

// --- Mutation helpers ---

export function renameProjectRecord(id, newName) {
  const projects = unwrapProjects(readProjects());
  const index = projects.findIndex((item) => item.id === id);
  if (index < 0) return false;
  projects[index] = { ...projects[index], name: newName.trim() || projects[index].name };
  return writeProjects(projects).ok;
}

export function deleteProjectRecord(id) {
  const projects = unwrapProjects(readProjects());
  const next = projects.filter((item) => item.id !== id);
  if (next.length === projects.length) return false;
  const result = writeProjects(next);
  try {
    const lastId = localStorage.getItem(LAST_OPENED_PROJECT_KEY);
    if (lastId === id) localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
  } catch { /* noop */ }
  return result.ok;
}

export function clearActiveProjectContext() {
  try { localStorage.removeItem(LAST_OPENED_PROJECT_KEY); } catch { /* noop */ }
}

export function touchLastOpenedProject(projectId) {
  if (projectId) safeSetItem(LAST_OPENED_PROJECT_KEY, projectId);
  else { try { localStorage.removeItem(LAST_OPENED_PROJECT_KEY); } catch { /* noop */ } }
}
