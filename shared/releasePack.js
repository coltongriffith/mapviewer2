// Release packs (supabase/migrations/20261103120000_release_packs.sql): is the pack's last approval still what the
// property's data and figures give, and if not, what changed, in words. Pure; the workspace's Release pack panel
// passes the current drill batches (drill_property_summary), the current maps, 3D figures and recipe.

export const ITEM_KINDS = [
  { value: 'results_table', label: 'Results table' },
  { value: 'drill_plan', label: 'Drill plan map' },
  { value: 'figure_3d', label: '3D figure' },
  { value: 'location_map', label: 'Location map' },
];
export const itemKindLabel = (k) => ITEM_KINDS.find((x) => x.value === k)?.label || k;
/** A pack holds one results table (the database refuses a second). */
export const canAddKind = (items, kind) => kind !== 'results_table' || !(items || []).some((it) => it.kind === 'results_table');
// The items that are drawn from the drill data.
const USES_DRILL = new Set(['results_table', 'drill_plan', 'figure_3d']);

const NOUN = { collars: ['collar', 'collars'], surveys: ['survey station', 'survey stations'], assays: ['assay', 'assays'], lithology: ['lithology interval', 'lithology intervals'], alteration: ['alteration interval', 'alteration intervals'], structure: ['structure measurement', 'structure measurements'] };
const count = (n, kind, adj) => { const [one, many] = NOUN[kind] || ['row', 'rows']; return `${Number(n).toLocaleString('en-US')} ${adj} ${n === 1 ? one : many}`; };
const list = (xs, max = 5) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const day = (t) => String(t || '').slice(0, 10);

/** "12 new assays in holes 077, 078" for one import batch; `holes` lists its hole ids when known. */
export function batchSentence(b, holes = null) {
  const s = b.summary || {}, parts = [];
  if (s.new) parts.push(count(s.new, b.kind, 'new'));
  if (s.changed) parts.push(count(s.changed, b.kind, 'changed'));
  const what = parts.join(' and ') || `${b.kind || 'drill'} import`;
  const ids = [...new Set(holes || [])];
  return ids.length ? `${what} in ${ids.length === 1 ? 'hole' : 'holes'} ${list(ids)}` : what;
}

/**
 * The pack against its last approval.
 *   pack: { items: [{ kind, ref }] }, approval: the latest release_pack_approvals row (or null)
 *   batches: drill_property_summary().batches (the latest 50); holes: { [batchId]: [hole ids] }
 *   approvedBatches: drill_import_batches rows for every id the approval used, read directly so a roll back of an
 *     approval's batch older than the summary's window is still seen ({ id, kind, filename, rolled_back_at }); null: not read
 *   figures: { [id]: { name, revision, savedAt, versionId, version } } for the pack's maps and 3D figures, as they are now
 *   recipes: { [name]: { id, version } }, the current saved results recipes
 * Returns { state: 'empty' | 'draft' | 'up_to_date', label, changes: [text], diff: text, items: [{ state, notes }] }.
 */
export function packStatus({ pack, approval = null, batches = [], approvedBatches = null, holes = {}, figures = {}, recipes = {} }) {
  const items = (pack?.items || []).map(() => ({ state: 'ok', notes: [] }));
  if (!items.length) return { state: 'empty', label: 'No items yet', changes: [], diff: '', items };
  const changes = [];
  const note = (i, text) => { items[i].state = 'changed'; items[i].notes.push(text); };
  const missing = (i, text) => { items[i].state = 'missing'; items[i].notes.push(text); };
  // Problems that stop an approval, whether or not one exists.
  pack.items.forEach((it, i) => {
    if (it.kind === 'results_table' && !recipes[it.ref]) missing(i, `Save the results recipe "${it.ref}" first`);
    if (it.kind !== 'results_table' && !figures[it.ref]) missing(i, 'No longer in this property');
  });
  if (!approval) return { state: 'draft', label: 'Draft: not approved yet', changes: ['Not approved yet'], diff: 'Not approved yet', items };

  const key = (xs) => (xs || []).map((it) => `${it.kind}:${it.ref}`).join('|');
  if (key(pack.items) !== key(approval.items)) changes.push('The pack’s items changed');
  const used = new Set(approval.batch_ids || []);
  const added = batches.filter((b) => !b.rolled_back_at && !used.has(b.id)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  // Each approved batch's status: read directly when given (every one), else what the summary's window shows.
  const status = new Map(batches.map((b) => [b.id, b]));
  for (const b of approvedBatches || []) status.set(b.id, { ...status.get(b.id), ...b });
  const undone = [...used].map((id) => status.get(id)).filter((b) => b?.rolled_back_at);
  const gone = approvedBatches ? [...used].filter((id) => !status.has(id)).length : 0;
  const data = [...added.map((b) => batchSentence(b, holes[b.id])), ...undone.map((b) => `${b.filename || b.kind} rolled back`)];
  if (gone) data.push(`${gone} approved import${gone === 1 ? ' is' : 's are'} no longer stored`);
  changes.push(...data);
  if (data.length) pack.items.forEach((it, i) => { if (USES_DRILL.has(it.kind) && items[i].state !== 'missing') note(i, 'Drill data changed'); });

  const then = new Map((approval.figures || []).map((f) => [f.id, f]));
  // A missing item (a map or figure deleted or moved out, an unsaved recipe) is never up to date.
  pack.items.forEach((it, i) => {
    if (items[i].state !== 'missing') return;
    const name = it.kind === 'results_table' ? `Results table (recipe "${it.ref}")` : then.get(it.ref)?.name || itemKindLabel(it.kind);
    changes.push(`${name}: ${items[i].notes.join('; ').replace(/^./, (c) => c.toLowerCase())}`);
  });
  pack.items.forEach((it, i) => {
    if (it.kind === 'results_table') {
      const r = recipes[it.ref];
      if (r && approval.recipe && (approval.recipe.name !== it.ref || approval.recipe.id !== r.id)) {
        const t = `Recipe "${it.ref}" is now version ${r.version}${approval.recipe.name === it.ref ? ` (approved: version ${approval.recipe.version})` : ''}`;
        changes.push(t); note(i, t);
      }
      return;
    }
    const now = figures[it.ref], was = then.get(it.ref);
    if (!now || !was) return;
    let t = null;
    if (was.kind === 'figure' && now.versionId && now.versionId !== was.version_id) t = `${now.name}: version ${now.version} published since approval`;
    else if (was.kind === 'map' && now.revision != null && now.revision !== was.revision) t = `${now.name} edited since approval`;
    else if (was.kind === 'figure' && now.savedAt && was.saved_at && Date.parse(now.savedAt) > Date.parse(was.saved_at)) t = `${now.name} edited since approval (not published as a version)`;
    if (t) { changes.push(t); note(i, t); }
  });

  const by = approval.approved_by_email ? ` by ${approval.approved_by_email}` : '';
  if (!changes.length) return { state: 'up_to_date', label: `Up to date: approved ${day(approval.approved_at)}${by}`, changes, diff: '', items };
  return { state: 'draft', label: 'Draft: data changed since approved', changes, diff: changes.join('; '), items };
}

/** What an approval sends: what the reviewer has on screen (the server checks it and stores its own copy). */
export function approvalRequest({ pack, batches = [], figures = {}, recipes = {} }, note = '') {
  const items = pack?.items || [];
  const recipeItem = items.find((it) => it.kind === 'results_table');
  return {
    pack_id: pack.id,
    items: items.map((it) => ({ kind: it.kind, ref: it.ref })),
    batch_ids: batches.filter((b) => !b.rolled_back_at).map((b) => b.id),
    figures: items.filter((it) => it.kind !== 'results_table').map((it) => {
      const f = figures[it.ref] || {};
      return { kind: it.kind === 'figure_3d' ? 'figure' : 'map', id: it.ref, version_id: it.kind === 'figure_3d' ? f.versionId ?? null : null, revision: it.kind === 'figure_3d' ? null : f.revision ?? null };
    }),
    recipe: recipeItem && recipes[recipeItem.ref] ? { id: recipes[recipeItem.ref].id } : null,
    note: String(note || '').trim() || null,
  };
}
