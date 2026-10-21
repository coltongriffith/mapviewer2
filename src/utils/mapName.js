// One name for a map, wherever it shows: the editor header, the dashboard
// card, the save and the copy. The saved record's name used to stay
// "Untitled map" while the editor showed the figure title, so a duplicate
// came out as "Untitled map Copy" on the dashboard and as the original's
// title in the editor.

export const UNTITLED_MAP = 'Untitled map';

/**
 * The record's name, or the figure title while the record has none of its
 * own ("Project Map" is the title a new map starts with; it names nothing).
 */
export function mapName(name, title) {
  const n = (name || '').trim(), t = (title || '').trim();
  return n && n !== UNTITLED_MAP ? n : t && t !== 'Project Map' ? t : UNTITLED_MAP;
}

/** "<name> (copy)", then "(copy 2)", "(copy 3)"… — the first not in `taken`. */
export function copyName(name, taken = []) {
  const base = mapName(name).replace(/ \(copy( \d+)?\)$/, '');
  let copy = `${base} (copy)`;
  for (let i = 2; taken.includes(copy); i += 1) copy = `${base} (copy ${i})`;
  return copy;
}
