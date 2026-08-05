// Read a credential from the environment without inheriting whatever the
// clipboard added to it.
//
// WHY THIS EXISTS
//   The first production sync failed like this:
//
//     [tenure-sync] failed: Could not read the last successful run:
//     TypeError: Headers.set: "***
//     ***" is an invalid header value.
//
//   SUPABASE_SERVICE_ROLE_KEY had been saved with a newline in it. supabase-js
//   puts the key in an Authorization header, headers cannot contain line
//   breaks, and the runtime threw several frames away from anything that named
//   the cause. GitHub masks each LINE of a secret separately, which is the only
//   reason the two `***` on separate lines gave it away at all.
//
//   Nothing about that error says "your secret has a newline in it", and the
//   same paste will produce it again on every job that touches the database.
//   A trailing newline is the single most common way a copied credential goes
//   wrong, so it is handled here rather than diagnosed again later.
//
// Trailing whitespace is stripped silently, because it is never meaningful in
// any of these values. A line break in the MIDDLE cannot be repaired by
// trimming — that is a value pasted with a hard wrap in it — so it raises an
// error that names the variable and says what to do.

// Matching control characters is the entire point here: these are exactly the
// bytes an HTTP header cannot carry, and detecting them is what turns an
// opaque TypeError from library internals into a message naming the variable.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * @param {string} name          primary env var
 * @param {object} [opts]
 * @param {string[]} [opts.fallbacks]  other names to try, in order
 * @param {boolean} [opts.required]    throw when nothing is set
 * @returns {string|null}
 */
export function credential(name, { fallbacks = [], required = false } = {}) {
  let source = name;
  let raw = process.env[name];
  for (const alt of fallbacks) {
    if (raw != null && String(raw).trim() !== '') break;
    raw = process.env[alt];
    source = alt;
  }

  if (raw == null || String(raw).trim() === '') {
    if (required) {
      throw new Error(
        `${name} is not set. In CI this comes from a repository secret — check `
        + 'Settings → Secrets and variables → Actions, and note that a value '
        + 'added under "Variables" is not visible as a secret.',
      );
    }
    return null;
  }

  const trimmed = String(raw).trim();

  if (CONTROL_CHARS.test(trimmed)) {
    throw new Error(
      `${source} contains a line break or control character in the middle of `
      + 'its value, which cannot be sent in an HTTP header. Re-copy it as a '
      + 'single unbroken line — a value pasted from a wrapped terminal or a '
      + 'reveal box often carries one.',
    );
  }

  return trimmed;
}

/** Convenience: the Supabase pair both cron jobs need, validated together. */
export function supabaseCredentials() {
  return {
    url: credential('SUPABASE_URL', { fallbacks: ['VITE_SUPABASE_URL'], required: true })
      .replace(/\/+$/, ''),
    key: credential('SUPABASE_SERVICE_ROLE_KEY', { required: true }),
  };
}
