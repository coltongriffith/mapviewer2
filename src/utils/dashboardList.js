// Search and sort for the dashboard's lists (maps and 3D figures), so both
// behave the same: a case-insensitive name match, then most recently edited
// first or by name.

export const SORTS = [
  { id: 'recent', label: 'Last edited' },
  { id: 'name', label: 'Name' },
];

export function filterAndSort(items, query = '', sort = 'recent') {
  const q = String(query || '').trim().toLowerCase();
  const list = (items || []).filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  if (sort === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", then a date. */
export function fmtRelative(iso, now = Date.now()) {
  if (!iso) return '';
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
