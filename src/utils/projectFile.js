const FILE_VERSION = 1;

/**
 * Serialize the current project to a portable JSON file string.
 * Format: { version, name, payload, exportedAt }
 */
export function serializeProjectFile({ payload, name }) {
  return JSON.stringify(
    {
      version: FILE_VERSION,
      name: name || payload?.layout?.title || 'Untitled map',
      payload,
      exportedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

/**
 * Parse and validate a project file JSON string.
 * Returns { name, payload } or throws with a user-readable message.
 */
export function parseProjectFile(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('Invalid file format.');
  if (!data.version || !data.payload) throw new Error('Missing required fields: version and payload.');
  if (!Array.isArray(data.payload.layers) || !data.payload.layout) {
    throw new Error('Invalid project structure: expected layers array and layout object.');
  }
  return { name: data.name || 'Imported Project', payload: data.payload };
}
