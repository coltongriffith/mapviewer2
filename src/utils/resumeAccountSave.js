import { loadAccountSave, clearAccountSave } from './projectStorage';

let inFlight;

// Coalesce repeated auth notifications/StrictMode effects, and serialize across
// tabs when the email link signs in both the original editor and a new tab.
export function resumeAccountSave(save) {
  if (inFlight) return inFlight;
  const run = async () => {
    const request = loadAccountSave();
    if (!request) return;
    const outcome = await save(request);
    if (['saved', 'saved-but-dirty', 'stale'].includes(outcome?.status)) clearAccountSave(request.nonce);
    return outcome;
  };
  inFlight = Promise.resolve().then(() => globalThis.navigator?.locks
    ? navigator.locks.request('exploration-maps-account-save', run) : run())
    .finally(() => { inFlight = null; });
  return inFlight;
}
