import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  safeSetItem, saveProjectRecord, listProjects, saveDraft, loadDraft,
  getRecoveryInfo, exportRecoveryRecord, discardRecoveryRecord,
  migratePayload, STORAGE_SCHEMA_VERSION,
} from '../src/utils/projectStorage.js';

const PROJECTS_KEY = 'mapviewer.projects.v1';
const DRAFT_KEY = 'mapviewer.draft.v1';

beforeEach(() => {
  localStorage.clear();
});

function withFailingSetItem(error, fn) {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = vi.fn(() => { throw error; });
  try { return fn(); } finally { Storage.prototype.setItem = original; }
}

describe('safeSetItem structured results', () => {
  it('reports success', () => {
    expect(safeSetItem('k', 'v')).toEqual({ ok: true });
    expect(localStorage.getItem('k')).toBe('v');
  });

  it('distinguishes quota exhaustion and fires the quota event', () => {
    const err = new DOMException('quota', 'QuotaExceededError');
    const events = [];
    const listener = () => events.push('quota');
    window.addEventListener('storage-quota-exceeded', listener);
    const result = withFailingSetItem(err, () => safeSetItem('k', 'v'));
    window.removeEventListener('storage-quota-exceeded', listener);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('quota');
    expect(events).toHaveLength(1);
  });

  it('distinguishes disabled storage', () => {
    const err = new DOMException('denied', 'SecurityError');
    const result = withFailingSetItem(err, () => safeSetItem('k', 'v'));
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('reports unknown storage errors', () => {
    const result = withFailingSetItem(new Error('weird'), () => safeSetItem('k', 'v'));
    expect(result).toMatchObject({ ok: false, reason: 'unknown', message: 'weird' });
  });
});

describe('project record round-trip and failure honesty', () => {
  it('saves and lists a project with a success result', () => {
    const saved = saveProjectRecord({ id: 'p1', name: 'Test', payload: { layers: [], layout: {} } });
    expect(saved.storage.ok).toBe(true);
    expect(listProjects().map((p) => p.id)).toEqual(['p1']);
  });

  it('a failed write reports ok:false so the UI cannot claim success', () => {
    const err = new DOMException('quota', 'QuotaExceededError');
    const saved = withFailingSetItem(err, () =>
      saveProjectRecord({ id: 'p1', name: 'Test', payload: { layers: [] } }));
    expect(saved.storage.ok).toBe(false);
    expect(listProjects()).toHaveLength(0);
  });

  it('serialization failures are reported, not thrown', () => {
    const circular = {}; circular.self = circular;
    const saved = saveProjectRecord({ id: 'p1', name: 'Test', payload: circular });
    expect(saved.storage).toMatchObject({ ok: false, reason: 'serialize' });
  });
});

describe('corrupted compressed records', () => {
  it('does not parse corrupted gz1: data as JSON, preserves the original, and keeps the app running', () => {
    const corrupt = 'gz1:!!!!not-actually-deflate!!!!';
    localStorage.setItem(PROJECTS_KEY, corrupt);
    // Read path: returns empty rather than crashing…
    expect(listProjects()).toEqual([]);
    // …and the original bytes are preserved under the recovery key.
    const info = getRecoveryInfo();
    expect(info).toHaveLength(1);
    expect(info[0].key).toBe(PROJECTS_KEY);
    expect(exportRecoveryRecord(PROJECTS_KEY)).toBe(corrupt);
  });

  it('the recovery copy is never overwritten by a second corruption', () => {
    localStorage.setItem(PROJECTS_KEY, 'gz1:first-corruption');
    listProjects();
    localStorage.setItem(PROJECTS_KEY, 'gz1:second-corruption');
    listProjects();
    expect(exportRecoveryRecord(PROJECTS_KEY)).toBe('gz1:first-corruption');
  });

  it('removal is manual and explicit only', () => {
    localStorage.setItem(DRAFT_KEY, 'gz1:corrupt-draft');
    expect(loadDraft()).toBeNull();
    expect(getRecoveryInfo()).toHaveLength(1);
    expect(discardRecoveryRecord(DRAFT_KEY)).toBe(true);
    expect(getRecoveryInfo()).toHaveLength(0);
  });
});

describe('schema versioning', () => {
  it('legacy unversioned records (bare array) still open', () => {
    // Simulates a pre-versioning store: bare array, uncompressed JSON.
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([
      { id: 'old1', name: 'Legacy', updatedAt: '2025-01-01T00:00:00Z', payload: { layers: [], layout: { title: 'Legacy' } } },
    ]));
    const projects = listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].payload.layout.title).toBe('Legacy');
  });

  it('legacy unversioned drafts still open', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      payload: { layers: [], layout: { title: 'Old draft' } }, projectId: null, projectName: 'Old draft',
    }));
    expect(loadDraft().payload.layout.title).toBe('Old draft');
  });

  it('new writes are stamped with the current schema version', () => {
    saveDraft({ payload: { layers: [] }, projectId: null, projectName: 'X' });
    const draft = loadDraft();
    expect(draft.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
  });

  it('migratePayload chains deterministically and rejects unknown versions', () => {
    const payload = { layers: [] };
    expect(migratePayload(payload, 0)).toEqual(payload);
    expect(() => migratePayload(payload, -3)).toThrow(/no migration/i);
  });
});
