// A page opened before a deploy asks for a hashed chunk that the deploy removed. Every browser words the
// failure differently, and only some of them pass through Vite's vite:preloadError (a chunk with no
// dependencies has no preload wrapper), so this is the one place that recognises one by its message.
// Shared by the 2D app (src/utils/preloadGuard.js, the reporter, the root ErrorBoundary) and /3d (studio.js);
// pure, no imports, so each entry carries its own copy (vite.config.js, em-shared-maths-per-entry).

const CHUNK_ERROR = new RegExp([
  'Failed to fetch dynamically imported module', // Chrome, Edge
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Unable to preload CSS for', // Vite's CSS preload
  'Failed to load module script', // a missing chunk answered with HTML (wrong MIME type)
  "is not a valid JavaScript MIME type",
  'Loading (CSS )?chunk \\S+ failed', // webpack-style wording from third-party bundles
].join('|'), 'i');

/** True when `error` (an Error, a rejection reason or a message) is a lazy chunk that failed to load. */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const message = typeof error === 'string' ? error : error.message;
  return typeof message === 'string' && CHUNK_ERROR.test(message);
}

// A stylesheet Vite failed to preload. Not retried: Vite's preload helper marks each dependency as seen
// before loading it, so a second import() skips the stylesheet and "succeeds" with the part unstyled.
const CSS_PRELOAD_ERROR = /Unable to preload CSS for/i;

/**
 * Run a dynamic import, and run it once more after a short pause when its JS fails to load: a dropped
 * connection reads exactly like a stale chunk ("Failed to fetch …"), and the second try is what tells
 * them apart. A CSS preload failure is never retried (see above). Any other error, or a second failure,
 * is the caller's.
 */
export function retryImport(load, { retries = 1, delayMs = 400 } = {}) {
  return load().catch((error) => {
    if (retries < 1 || !isChunkLoadError(error) || CSS_PRELOAD_ERROR.test(String(error?.message || ''))) throw error;
    return new Promise((resolve) => { setTimeout(resolve, delayMs); })
      .then(() => retryImport(load, { retries: retries - 1, delayMs }));
  });
}
