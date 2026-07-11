// Local → cloud project migration with per-project tracking and retries.
//
// The old implementation set a single "migrated" flag BEFORE uploading
// anything, so any project whose upload failed (network blip, tab closed
// mid-loop) was stranded locally forever. This version:
//   * tracks status per project under a stable source-local id,
//   * records global completion ONLY when every eligible project succeeded,
//   * retries failed projects on later sessions,
//   * never uploads a project that already has a recorded cloudId
//     (no duplicates on retry),
//   * never deletes local copies — cloud persistence is additive.

const STATE_PREFIX = 'em_migration_v2_';
const LEGACY_FLAG_PREFIX = 'em_migrated_';

function stateKey(userId) { return `${STATE_PREFIX}${userId}`; }

export function readMigrationState(userId) {
  try {
    const raw = localStorage.getItem(stateKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return { done: false, projects: {}, ...parsed };
  } catch { /* corrupted/unavailable → start fresh */ }
  return { done: false, projects: {} };
}

function writeMigrationState(userId, state) {
  try { localStorage.setItem(stateKey(userId), JSON.stringify(state)); } catch { /* best-effort */ }
}

function legacyFlagSet(userId) {
  try { return Boolean(localStorage.getItem(`${LEGACY_FLAG_PREFIX}${userId}`)); } catch { return false; }
}

/**
 * Run one migration pass. Idempotent and safe to call on every sign-in.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {Array<{id:string,name:string,payload:object}>} opts.localProjects
 * @param {{payload:object,projectId:?string}|null} opts.draft  unsaved draft (uploaded once, under the 'draft' id)
 * @param {(job:{name:string,payload:object}) => Promise<string>} opts.uploadProject  returns the new cloud id
 * @returns {{ attempted:number, migrated:number, failed:number, skipped:number, complete:boolean }}
 */
export async function runCloudMigration({ userId, localProjects, draft, uploadProject }) {
  // Users migrated under the old single-flag scheme are treated as complete:
  // re-uploading everything they already migrated would create duplicates.
  if (legacyFlagSet(userId)) {
    return { attempted: 0, migrated: 0, failed: 0, skipped: 0, complete: true };
  }

  const state = readMigrationState(userId);
  if (state.done) return { attempted: 0, migrated: 0, failed: 0, skipped: 0, complete: true };

  const jobs = (localProjects || [])
    .filter((p) => p && p.id && p.payload)
    .map((p) => ({ key: String(p.id), name: p.name, payload: p.payload }));
  if (draft?.payload?.layers?.length && !draft.projectId) {
    jobs.push({ key: 'draft', name: draft.payload?.layout?.title || 'Unsaved draft', payload: draft.payload });
  }

  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const prior = state.projects[job.key];
    if (prior?.status === 'done' && prior.cloudId) { skipped += 1; continue; }
    try {
      const cloudId = await uploadProject({ name: job.name, payload: job.payload });
      state.projects[job.key] = { status: 'done', cloudId, at: new Date().toISOString() };
      migrated += 1;
    } catch (e) {
      state.projects[job.key] = {
        status: 'failed',
        error: String(e?.message || e).slice(0, 200),
        at: new Date().toISOString(),
      };
      failed += 1;
    }
    writeMigrationState(userId, state); // persist progress after EVERY job
  }

  const complete = jobs.every((j) => state.projects[j.key]?.status === 'done');
  if (complete) {
    state.done = true; // recorded only when every eligible project succeeded
    writeMigrationState(userId, state);
  }

  return { attempted: jobs.length - skipped, migrated, failed, skipped, complete };
}
