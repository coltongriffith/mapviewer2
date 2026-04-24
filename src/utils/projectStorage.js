const PROJECTS_KEY = 'mapviewer.projects.v1';
const DRAFT_KEY = 'mapviewer.draft.v1';
const LAST_OPENED_PROJECT_KEY = 'mapviewer.lastProjectId.v1';

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
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
  safeSetItem(PROJECTS_KEY, JSON.stringify(projects));
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
  safeSetItem(DRAFT_KEY, JSON.stringify({
    payload,
    projectId: projectId || null,
    projectName: projectName || null,
    updatedAt: new Date().toISOString(),
  }));
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
// These are intentionally thin wrappers over localStorage so they can be
// swapped for API calls when user accounts are introduced.

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
