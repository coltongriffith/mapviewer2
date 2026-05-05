import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const PROJECTS_KEY = 'mapviewer.projects.v1';
const DRAFT_KEY = 'mapviewer.draft.v1';
const LAST_OPENED_PROJECT_KEY = 'mapviewer.lastProjectId.v1';
const GZ_PREFIX = 'gz1:';

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

function decompress(str) {
  if (!str || !str.startsWith(GZ_PREFIX)) return str;
  try {
    const b64 = str.slice(GZ_PREFIX.length);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return strFromU8(inflateSync(bytes));
  } catch {
    return str.slice(GZ_PREFIX.length); // fallback: raw (shouldn't happen)
  }
}

function safeParse(value, fallback) {
  try {
    if (!value) return fallback;
    const raw = decompress(value);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      window.dispatchEvent(new CustomEvent('storage-quota-exceeded'));
    }
  }
}

function readProjects() {
  return safeParse(localStorage.getItem(PROJECTS_KEY), []);
}

function writeProjects(projects) {
  safeSetItem(PROJECTS_KEY, compress(JSON.stringify(projects)));
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

export function listProjects() {
  return readProjects()
    .filter((item) => item && item.id && item.payload)
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

export function saveProjectRecord({ id, name, payload }) {
  const now = new Date().toISOString();
  const projects = readProjects();
  const next = {
    id,
    name: name || payload?.layout?.title || 'Untitled map',
    updatedAt: now,
    payload,
  };
  const index = projects.findIndex((item) => item.id === id);
  if (index >= 0) projects[index] = next;
  else projects.push(next);
  writeProjects(projects);
  safeSetItem(LAST_OPENED_PROJECT_KEY, id);
  return next;
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

export function saveDraft({ payload, projectId, projectName }) {
  safeSetItem(DRAFT_KEY, compress(JSON.stringify({
    payload,
    projectId: projectId || null,
    projectName: projectName || null,
    updatedAt: new Date().toISOString(),
  })));
  if (projectId) safeSetItem(LAST_OPENED_PROJECT_KEY, projectId);
  else localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
}

export function loadDraft() {
  return safeParse(localStorage.getItem(DRAFT_KEY), null);
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
  const projects = readProjects();
  const index = projects.findIndex((item) => item.id === id);
  if (index < 0) return false;
  projects[index] = { ...projects[index], name: newName.trim() || projects[index].name };
  writeProjects(projects);
  return true;
}

export function deleteProjectRecord(id) {
  const projects = readProjects();
  const next = projects.filter((item) => item.id !== id);
  if (next.length === projects.length) return false;
  writeProjects(next);
  const lastId = localStorage.getItem(LAST_OPENED_PROJECT_KEY);
  if (lastId === id) localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
  return true;
}

export function clearActiveProjectContext() {
  localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
}

export function touchLastOpenedProject(projectId) {
  if (projectId) safeSetItem(LAST_OPENED_PROJECT_KEY, projectId);
  else localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
}
