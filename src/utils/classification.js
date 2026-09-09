// Symbology by attribute: colour (and, for points, size) a layer by one of
// its columns, either in numeric ranges or by unique value.
//
// This is how a soil grid reads as "0–50 / 50–100 / 100–200 / >200 ppm Cu"
// in four colours and four sizes from ONE layer, and how a geology sheet
// shows each unit in its own colour from one polygon file. Before this the
// only way was to split the file into a layer per class in another program,
// and the legend then showed four unrelated rows.
//
// No React and no Leaflet imports. The editor map, both exporters and the
// legend builders all read a layer's classification through the functions
// here, so a class cannot colour a point on screen and not in the PNG.

import { layerFeatures } from './featureIdentity.js';

// Yellow → orange → red → magenta, low to high: the reading a geochemist
// expects, and the one the soil maps this was built against use.
export const GRADUATED_PALETTE = ['#fde047', '#f59e0b', '#ef4444', '#d946ef', '#7e22ce', '#1e1b4b'];
export const GRADUATED_SIZES = [6, 9, 12, 15, 18, 21];
export const CATEGORICAL_PALETTE = [
  '#a7f3d0', '#fbcfe8', '#c7d2fe', '#fde68a', '#bfdbfe', '#d9f99d',
  '#fecaca', '#ddd6fe', '#99f6e4', '#fed7aa', '#e9d5ff', '#bbf7d0',
];
export const MAX_CATEGORIES = 12;
export const MAX_CLASSES = 6;

const SAMPLE = 500;

function toNumber(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[<>,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** Property keys of a layer's features, with whether each reads as numeric. */
export function attributeFields(layer) {
  const feats = layerFeatures(layer).slice(0, SAMPLE);
  const seen = new Map();
  for (const f of feats) {
    for (const [k, v] of Object.entries(f?.properties || {})) {
      if (k.startsWith('_')) continue;
      const s = seen.get(k) || { key: k, numeric: 0, filled: 0 };
      if (v != null && v !== '') {
        s.filled += 1;
        if (Number.isFinite(toNumber(v))) s.numeric += 1;
      }
      seen.set(k, s);
    }
  }
  return [...seen.values()]
    .filter((s) => s.filled > 0)
    .map((s) => ({ key: s.key, numeric: s.numeric / s.filled >= 0.9 }));
}

export function fieldValues(layer, field) {
  return layerFeatures(layer).map((f) => f?.properties?.[field]).filter((v) => v != null && v !== '');
}

function niceNumber(x) {
  if (!Number.isFinite(x) || x === 0) return 0;
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const base = 10 ** exp;
  const m = Math.abs(x) / base;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return Math.sign(x) * nice * base;
}

/**
 * n-1 ascending class boundaries from the data: quantiles, rounded to nice
 * numbers, de-duplicated. Quantiles rather than equal intervals because
 * geochemistry is log-normal — equal intervals put every sample in class 1.
 */
export function suggestBreaks(values, n = 4) {
  const nums = values.map(toNumber).filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length < 2) return [];
  const out = [];
  for (let i = 1; i < n; i += 1) {
    const q = nums[Math.min(nums.length - 1, Math.floor((i / n) * nums.length))];
    const nice = niceNumber(q);
    if (nice > (out[out.length - 1] ?? -Infinity)) out.push(nice);
  }
  return out;
}

export function buildGraduated(layer, field, n = 4) {
  const count = Math.max(2, Math.min(MAX_CLASSES, n));
  const breaks = suggestBreaks(fieldValues(layer, field), count);
  const classes = [];
  for (let i = 0; i <= breaks.length; i += 1) {
    classes.push({
      max: i < breaks.length ? breaks[i] : null,
      color: GRADUATED_PALETTE[Math.min(i, GRADUATED_PALETTE.length - 1)],
      size: GRADUATED_SIZES[Math.min(i, GRADUATED_SIZES.length - 1)],
      label: '',
    });
  }
  return { field, mode: 'graduated', classes };
}

export function buildCategorical(layer, field) {
  const counts = new Map();
  for (const v of fieldValues(layer, field)) {
    const k = String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const values = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIES).map(([k]) => k);
  const classes = values.map((value, i) => ({
    value, color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length], size: 10, label: '',
  }));
  return { field, mode: 'categorical', classes, truncated: counts.size > MAX_CATEGORIES };
}

export function isClassified(layer) {
  const c = layer?.classification;
  return !!(c && c.field && Array.isArray(c.classes) && c.classes.length);
}

/** Which class a feature falls in, or -1 when it has no usable value. */
export function classIndexFor(classification, feature) {
  if (!classification?.field || !classification.classes?.length) return -1;
  const raw = feature?.properties?.[classification.field];
  if (raw == null || raw === '') return -1;
  if (classification.mode === 'categorical') {
    return classification.classes.findIndex((c) => String(c.value) === String(raw));
  }
  const v = toNumber(raw);
  if (!Number.isFinite(v)) return -1;
  const idx = classification.classes.findIndex((c) => c.max == null || v <= c.max);
  return idx;
}

/**
 * The style a class contributes: for a point, colour and size; for an area,
 * fill. Stroke is left to the layer so a classified geology sheet keeps one
 * contact line weight.
 */
export function classStyle(classification, feature, isPoint) {
  const i = classIndexFor(classification, feature);
  if (i < 0) return null;
  const c = classification.classes[i];
  const out = isPoint
    ? { markerColor: c.color, markerFill: c.color }
    : { fill: c.color };
  if (isPoint && Number.isFinite(c.size)) out.markerSize = c.size;
  if (c.shape) out.markerShape = c.shape;
  return out;
}

function fmt(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(n);
}

/** Legend text for one class: "≤ 50", "50 – 100", "> 200", or the value. */
export function classLabel(classification, i) {
  const c = classification.classes[i];
  if (c.label && String(c.label).trim()) return String(c.label).trim();
  if (classification.mode === 'categorical') return String(c.value);
  const prev = i > 0 ? classification.classes[i - 1].max : null;
  if (c.max == null) return prev == null ? 'All values' : `> ${fmt(prev)}`;
  if (prev == null) return `≤ ${fmt(c.max)}`;
  return `${fmt(prev)} – ${fmt(c.max)}`;
}

/**
 * One legend row per class, in the same shape a layer's own row takes so the
 * renderers treat them as ordinary rows. Ids are stable per class index, so
 * a rename in the legend survives rebuilding the classes.
 */
export function classLegendItems(layer, baseStyle, baseLabel, group, isPoint) {
  const c = layer.classification;
  return c.classes.map((cls, i) => {
    const style = { ...baseStyle, ...classStyle(c, { properties: { [c.field]: c.mode === 'categorical' ? cls.value : (cls.max ?? Infinity) } }, isPoint) };
    if (isPoint && Number.isFinite(cls.size)) style.markerSize = cls.size;
    return {
      id: `${layer.id}::class:${i}`,
      role: layer.role,
      group,
      label: classLabel(c, i),
      type: isPoint ? 'points' : (layer.type === 'line' ? 'line' : 'polygon'),
      markerShape: style.markerShape || 'circle',
      style,
      // Graduated point rows read best when the swatch grows with the class.
      swatchSize: isPoint && Number.isFinite(cls.size) ? Math.max(8, Math.min(18, cls.size)) : undefined,
      classed: true,
      classLayerLabel: baseLabel,
    };
  });
}
