import { resolveClaimKeySnapshot } from './claimKeyCandidates.js';
import { featureKey, visibleGeojson, layerFeatures } from './featureIdentity.js';
import { fxScene } from './geoStyle.js';
import { claimKeyTable } from './claimKeyTable.js';

/** Unexposed shared placement adapter. A reserved table is an obstacle before
 * labels are placed. Rows come only from actual clear in-frame references.
 * Table typography/overflow and editor wiring are separate unfinished work.
 */
export function claimKeyScene(project, snapshot, view, tableBox, styleOf = () => ({})) {
  const resolved = resolveClaimKeySnapshot(project, snapshot);
  if (!resolved.ok) return resolved;
  const validBox = tableBox && ['left', 'top', 'width', 'height'].every((key) => Number.isFinite(tableBox[key]));
  if (!validBox || tableBox.width <= 0 || tableBox.height <= 0 || tableBox.left < 0 || tableBox.top < 0
    || tableBox.left + tableBox.width > view.W || tableBox.top + tableBox.height > view.H) {
    return { ok: false, reason: 'key-box-required', entries: [] };
  }
  const source = project.layers.find((layer) => layer.id === snapshot.layerId);
  const rows = new Map(resolved.entries.map((row) => [row.identity, row]));
  // A temporary label-only layer leaves actual geometry/style rendering and
  // scientific/source attributes untouched. Existing manual labels are not
  // replaced by this adapter; callers must obtain explicit opt-in first.
  const layer = { ...source, fx: { label: { per: 'feature', size: 13, minSize: 7,
    fit: 'hide', nudge: true, caps: false, ls: 0 } } };
  const scene = fxScene([{ layer, features: layerFeatures({ geojson: visibleGeojson(source) }), styleOf,
    labelForFeature: (feature) => {
      const row = rows.get(String(featureKey(feature)));
      return row ? { text: row.reference, link: { identity: row.identity, reference: row.reference } } : null;
    } }], { ...view, obstacles: [...(view.obstacles || []), { ...tableBox, key: 'claim key' }] });
  const printed = scene.placed.filter((item) => item.link).map((item) => ({ ...rows.get(item.link.identity) }));
  printed.sort((a, b) => Number(a.reference.slice(1)) - Number(b.reference.slice(1)));
  const omitted = resolved.total - printed.length;
  const table = claimKeyTable(printed, snapshot.field, tableBox, { omitted, hidden: resolved.hidden, family: view.family });
  if (!table.ok) return { ok: false, reason: table.reason, labels: [], rows: [], placed: [] };
  return { ok: true, reason: null, labels: scene.labels, placed: scene.placed,
    rows: printed, omitted, hidden: resolved.hidden, table: table.primitives, notice: table.notice, tableBox: { ...tableBox } };
}
