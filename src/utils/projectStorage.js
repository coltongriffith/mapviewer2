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

function readProjects() {
  return safeParse(localStorage.getItem(PROJECTS_KEY), []);
}

function writeProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
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
  localStorage.setItem(LAST_OPENED_PROJECT_KEY, id);
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
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    payload,
    projectId: projectId || null,
    projectName: projectName || null,
    updatedAt: new Date().toISOString(),
  }));
  if (projectId) localStorage.setItem(LAST_OPENED_PROJECT_KEY, projectId);
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

export function clearActiveProjectContext() {
  localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
}

export function touchLastOpenedProject(projectId) {
  if (projectId) localStorage.setItem(LAST_OPENED_PROJECT_KEY, projectId);
  else localStorage.removeItem(LAST_OPENED_PROJECT_KEY);
}
