const LEAD_KEY = 'mapviewer.hdLeadCaptures';

/**
 * Saves a lead capture entry to localStorage.
 * Replace the localStorage write here with an API POST to connect to a CRM or backend.
 *
 * @param {{ email: string, projectTitle?: string }} options
 */
export function saveLead({ email, projectTitle = '' }) {
  const entry = {
    email: email.trim().toLowerCase(),
    projectTitle,
    capturedAt: new Date().toISOString(),
  };
  const existing = readLeads();
  existing.push(entry);
  try {
    localStorage.setItem(LEAD_KEY, JSON.stringify(existing));
  } catch {
    // localStorage quota exceeded or unavailable — fail silently
  }
  return entry;
}

/**
 * Returns the email from the most recently saved lead, or null.
 * Used to pre-fill the modal on repeat visits.
 */
export function getLastLeadEmail() {
  const all = readLeads();
  return all.length ? all[all.length - 1].email : null;
}

/**
 * Returns all stored leads. Useful for future backend sync.
 */
export function readLeads() {
  try {
    return JSON.parse(localStorage.getItem(LEAD_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Developer-only CSV export utility. Not exposed in the UI.
 * Access via browser DevTools console: __exportLeads()
 */
export function exportLeadsCsv() {
  const leads = readLeads();
  if (!leads.length) {
    // eslint-disable-next-line no-console
    console.log('No leads collected yet.');
    return;
  }
  const rows = leads.map((l) =>
    [l.email, (l.projectTitle || '').replace(/,/g, ' '), l.capturedAt].join(',')
  );
  const csv = ['email,projectTitle,capturedAt', ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'mapviewer-leads.csv';
  a.click();
}
