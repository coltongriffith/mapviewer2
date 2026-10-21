// Published results on a 2D map (the minimal adapter): each approved result in a release table becomes a
// callout on its hole's collar, with any "incl." results as its second line, and says that it sits at the
// collar. Intervals are not placed in plan (a later step). The table is read exactly as the 3D page reads it
// (src/three-d/published-results.js: records, approval, nesting and checks), and is only ever read because
// the user chose "Add published results"; nothing here guesses that a file is one.
//
// collarCallouts is pure; fromFile reads the chosen CSV for the editor, which adds the callouts it returns.

import { readResults, pubCols, pubCallouts, pubLines, isApproved } from '../three-d/published-results.js';
import { layerFeatures, isFeatureHidden } from './featureIdentity.js';

const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
const HOLE = /^(_holeid|hole_?id|hole|bhid|dhid|drill_?hole|hole_?name|hole_?number)$/;
const FROM = /^(from|from_m|depth_from|mfrom|from_depth)$/, TO = /^(to|to_m|depth_to|mto|to_depth)$/;
const m = (v) => `${+v.toFixed(3)}`;
export const COLLAR_NOTE = 'at the collar, not at depth';

// The release table's columns: Hole, From and To by name, the rest as the 3D page guesses them.
export function releaseColumns(header) {
  const n = header.map(norm), at = (re) => { const i = n.findIndex((h) => re.test(h)); return i < 0 ? undefined : i; };
  return pubCols(header, { hole: at(HOLE), from: at(FROM), to: at(TO) });
}

// Collars on the map by hole ID (case and spaces ignored): visible point features with a hole ID property.
function collarsOf(layers) {
  const out = new Map();
  (layers || []).filter((layer) => layer?.visible !== false).forEach((layer) => layerFeatures(layer).forEach((f) => {
    if (f?.geometry?.type !== 'Point' || isFeatureHidden(layer, f)) return;
    const p = f.properties || {}, k = Object.keys(p).find((key) => HOLE.test(norm(key)) && String(p[key] ?? '').trim());
    const id = k && String(p[k]).trim().toLowerCase();
    if (id && !out.has(id)) out.set(id, { layer, f });
  }));
  return out;
}

// { callouts: [{ resultId, holeId, text, subtext, anchor: { lat, lng }, layerId, featureId }], unmatched: [hole IDs
// with approved results but no collar on the map], problems: [messages] }.
export function collarCallouts(header, rows, layers) {
  const cols = releaseColumns(header), need = ['resultId', 'hole', 'from', 'to'].filter((k) => cols[k] === undefined);
  if (need.length) return { callouts: [], unmatched: [], problems: [`This table has no ${need.map((k) => ({ resultId: 'Result ID', hole: 'Hole ID', from: 'From', to: 'To' }[k])).join(', ')} column, so it is not read as published results.`] };
  const { results, problems } = readResults(header, rows, cols), collars = collarsOf(layers), key = (id) => id.trim().toLowerCase();
  const holes = [...new Set(results.map((r) => r.holeId))].filter((id) => collars.has(key(id))).map((id) => ({ id }));
  const unmatched = [...new Set(results.filter((r) => isApproved(r) && !collars.has(key(r.holeId))).map((r) => r.holeId))];
  const callouts = pubCallouts(results, holes).map((c) => {
    const { layer, f } = collars.get(key(c.h.id)), [lng, lat] = f.geometry.coordinates, L = pubLines(c);
    return { resultId: c.key, holeId: c.h.id, text: L.l1 + L.l1b, subtext: [L.l2, `${c.h.id} ${m(c.pub.fromM)}–${m(c.pub.toM)} m · published result, ${COLLAR_NOTE}`].filter(Boolean).join('\n'),
      anchor: { lat, lng }, layerId: layer.id, featureId: f.id ?? f.properties?.id ?? `${layer.id}:${lat.toFixed(6)}:${lng.toFixed(6)}` };
  });
  return { callouts, unmatched, problems: problems.filter((p) => p.kind !== 'no-status-column').map((p) => p.message) };
}

// The editor's "Add Published Results": the callouts to add and the status line to show.
export async function fromFile(file, layers) {
  try {
    const [text, { default: Papa }] = await Promise.all([file.text(), import('papaparse')]);
    const data = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' }).data;
    const { callouts, unmatched, problems } = collarCallouts(data[0] || [], data.slice(1), layers), n = callouts.length;
    return { callouts, status: { type: n ? 'success' : 'error', message: [`${n} published result${n === 1 ? '' : 's'} added on ${n === 1 ? 'its collar' : 'their collars'} (not at depth).`, unmatched.length ? `No collar on the map for ${unmatched.join(', ')}.` : '', ...problems].filter(Boolean).join(' ') } };
  } catch (err) {
    return { callouts: [], status: { type: 'error', message: `Could not read the published results: ${err.message}` } };
  }
}
