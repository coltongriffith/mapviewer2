import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCloudMigration, readMigrationState } from '../src/utils/cloudMigration.js';

const USER = 'user-abc';
const proj = (id) => ({ id, name: `Project ${id}`, payload: { layers: [{}], layout: { title: id } } });

beforeEach(() => {
  localStorage.clear();
});

describe('local → cloud migration reliability', () => {
  it('one of three fails: the two successes are recorded, completion is NOT', async () => {
    const upload = vi.fn(async ({ name }) => {
      if (name === 'Project p2') throw new Error('network blip');
      return `cloud-${name}`;
    });
    const result = await runCloudMigration({
      userId: USER,
      localProjects: [proj('p1'), proj('p2'), proj('p3')],
      draft: null,
      uploadProject: upload,
    });
    expect(result).toMatchObject({ migrated: 2, failed: 1, complete: false });
    const state = readMigrationState(USER);
    expect(state.done).toBe(false);
    expect(state.projects.p1.status).toBe('done');
    expect(state.projects.p2.status).toBe('failed');
    expect(state.projects.p3.status).toBe('done');
  });

  it('on retry, the two successes are NOT duplicated and the failed one retries', async () => {
    const firstUpload = vi.fn(async ({ name }) => {
      if (name === 'Project p2') throw new Error('network blip');
      return `cloud-${name}`;
    });
    await runCloudMigration({ userId: USER, localProjects: [proj('p1'), proj('p2'), proj('p3')], draft: null, uploadProject: firstUpload });

    const secondUpload = vi.fn(async ({ name }) => `cloud-${name}`);
    const retry = await runCloudMigration({ userId: USER, localProjects: [proj('p1'), proj('p2'), proj('p3')], draft: null, uploadProject: secondUpload });

    expect(secondUpload).toHaveBeenCalledTimes(1);                    // ONLY p2
    expect(secondUpload.mock.calls[0][0].name).toBe('Project p2');
    expect(retry).toMatchObject({ migrated: 1, failed: 0, skipped: 2, complete: true });
  });

  it('completion is recorded only after all three succeed, then later runs no-op', async () => {
    const upload = vi.fn(async ({ name }) => `cloud-${name}`);
    const result = await runCloudMigration({ userId: USER, localProjects: [proj('p1'), proj('p2'), proj('p3')], draft: null, uploadProject: upload });
    expect(result.complete).toBe(true);
    expect(readMigrationState(USER).done).toBe(true);

    const again = await runCloudMigration({ userId: USER, localProjects: [proj('p1')], draft: null, uploadProject: upload });
    expect(again).toMatchObject({ attempted: 0, complete: true });
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('a crash mid-run (state persisted per job) does not re-upload completed projects', async () => {
    // First run "crashes" after p1 by throwing from p2 AND we simulate the tab
    // dying by never reading the result — the per-job persisted state is what
    // the next session sees.
    const upload1 = vi.fn(async ({ name }) => {
      if (name !== 'Project p1') throw new Error('tab closed');
      return 'cloud-p1';
    });
    await runCloudMigration({ userId: USER, localProjects: [proj('p1'), proj('p2')], draft: null, uploadProject: upload1 });

    const upload2 = vi.fn(async () => 'cloud-p2');
    await runCloudMigration({ userId: USER, localProjects: [proj('p1'), proj('p2')], draft: null, uploadProject: upload2 });
    expect(upload2).toHaveBeenCalledTimes(1); // p1 never re-uploaded
  });

  it('users migrated under the legacy single flag are treated as complete (no duplicates)', async () => {
    localStorage.setItem(`em_migrated_${USER}`, '1');
    const upload = vi.fn();
    const result = await runCloudMigration({ userId: USER, localProjects: [proj('p1')], draft: null, uploadProject: upload });
    expect(upload).not.toHaveBeenCalled();
    expect(result.complete).toBe(true);
  });

  it('an unsaved draft with content migrates once under a stable key', async () => {
    const upload = vi.fn(async () => 'cloud-draft');
    const draft = { payload: { layers: [{}], layout: { title: 'WIP' } }, projectId: null };
    await runCloudMigration({ userId: USER, localProjects: [], draft, uploadProject: upload });
    const second = await runCloudMigration({ userId: USER, localProjects: [], draft, uploadProject: upload });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(second.skipped).toBe(0); // done → whole run short-circuits as complete
    expect(second.complete).toBe(true);
  });
});
