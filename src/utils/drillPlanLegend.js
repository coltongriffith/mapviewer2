// The drill plan's colours and legend rows (project.drillPlan, an opt-in 2D figure layer: utils/drillPlan.js).
// Small and loaded with the editor, because the legend is derived synchronously; everything that draws the plan
// is lazy. A map without a drill plan gets no rows here, so its legend is unchanged.

// Holes in the release (with published results) take these, in hole order: 077 green, 078 cyan, ...; other
// holes are drawn white (historical holes), unless a colour is chosen per hole.
export const RELEASE_COLORS = ['#3fbf4f', '#2fb8e6', '#f59f00', '#be4bdb', '#ff6b6b', '#94d82d'];
export const OTHER_COLOR = '#ffffff';
// Assay bins for gold in g/t by default (the Tower Fig 2 classes), low to high.
export const DEFAULT_BINS = [
  { min: 0.4, color: '#f5c518' },
  { min: 1, color: '#f08c00' },
  { min: 3, color: '#e03131' },
  { min: 10, color: '#c2255c' },
];

const HEX = /^#[0-9a-f]{6}$/i;
export const byHole = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
const key = (id) => String(id ?? '').trim().toLowerCase();

/** Hole IDs with an approved published result in the plan's release table. */
export function releaseHoles(plan) {
  const ok = /^(approved|released|published|final)$/i;
  return new Set((plan?.results || []).filter((r) => ok.test(r.approvalStatus || '')).map((r) => key(r.holeId)));
}

/** Each hole's colour: its own (chosen), else the release palette in hole order, else white. Map by lower-case ID. */
export function holeColors(plan) {
  const rel = releaseHoles(plan), out = new Map();
  let i = 0;
  [...(plan?.holes || [])].sort((a, b) => byHole(a.id, b.id)).forEach((h) => {
    const k = key(h.id), own = HEX.test(h.color || '') ? h.color : null;
    out.set(k, own || (rel.has(k) ? RELEASE_COLORS[i++ % RELEASE_COLORS.length] : OTHER_COLOR));
  });
  return out;
}

/** The bins low to high, with their labels: "0.4 – 1", ..., "≥ 10". */
export function binsOf(plan) {
  const bins = (Array.isArray(plan?.bins) && plan.bins.length ? plan.bins : DEFAULT_BINS)
    .filter((b) => Number.isFinite(+b.min)).map((b) => ({ min: +b.min, color: HEX.test(b.color || '') ? b.color : '#f5c518' }))
    .sort((a, b) => a.min - b.min);
  const n = (v) => `${+v.toFixed(3)}`;
  return bins.map((b, i) => ({ ...b, label: i < bins.length - 1 ? `${n(b.min)} – ${n(bins[i + 1].min)}` : `≥ ${n(b.min)}` }));
}

const minus = (v) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}°`;

/**
 * The legend rows the plan adds: a line per release hole ("Hole 077, dip −50° (this release)"), one for the
 * other traces, the assay bins (highest first, under "Assay · Au g/t"), the section line and the highlight.
 * Shaped as the derived rows are, so the legend editor, the stage and the exporters draw them as any other.
 */
export function drillPlanLegendItems(plan) {
  if (!plan?.holes?.length || plan.legend === false) return [];
  const show = plan.show || {}, colors = holeColors(plan), rel = releaseHoles(plan), group = 'Drilling', items = [];
  const holes = [...plan.holes].sort((a, b) => byHole(a.id, b.id));
  if (show.traces !== false) {
    holes.filter((h) => rel.has(key(h.id)) || HEX.test(h.color || '')).forEach((h) => items.push({
      id: `__dp_hole_${h.id}`, role: 'drillholes', group, type: 'line',
      label: `Hole ${h.id}${Number.isFinite(h.dip) ? `, dip ${minus(h.dip)}` : ''}${rel.has(key(h.id)) ? ' (this release)' : ''}`,
      style: { stroke: colors.get(key(h.id)), strokeWidth: 5 },
    }));
    if (holes.some((h) => !rel.has(key(h.id)) && !HEX.test(h.color || ''))) {
      const n = holes.filter((h) => h.desurveyed).length, how = !n ? 'straight, collar az/dip' : n === holes.length ? 'desurveyed' : 'desurveyed, else collar az/dip';
      items.push({ id: '__dp_trace', role: 'drillholes', group, type: 'line', label: `Drill trace, plan projection (${how})`, style: { stroke: OTHER_COLOR, strokeWidth: 4 } });
    }
  }
  const el = plan.assays?.elements?.find((e) => e.name === plan.element) || plan.assays?.elements?.[0];
  if (show.bars !== false && el) {
    const head = `Assay · ${el.name}${el.unit ? ` ${el.unit}` : ''}`;
    binsOf(plan).reverse().forEach((b) => items.push({ id: `__dp_bin_${b.min}`, role: 'drillholes', group: head, type: 'polygons', label: b.label, style: { fill: b.color, fillOpacity: 1, stroke: b.color, strokeWidth: 1 } }));
  }
  if (plan.section?.a && plan.section?.b) items.push({ id: '__dp_section', role: 'other', group, type: 'line', label: `Section line ${plan.section.name || 'A–A′'}`, style: { stroke: '#5b7f9a', strokeWidth: 2.5, dashArray: '6 4' } });
  if (plan.highlight?.at) items.push({ id: '__dp_highlight', role: 'other', group, type: 'points', markerShape: 'star', label: plan.highlight.legend || 'Discovery hole', style: { markerShape: 'star', markerColor: '#5c4300', markerFill: '#f5c518' } });
  return items;
}
