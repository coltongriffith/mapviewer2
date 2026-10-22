// window.EMAP: the 2D map editor driven from the browser console or by an agent (Tower v3 spec items 43 and 45), as
// /3d's window.EM3D drives the 3D maker. App loads this module once the editor opens, never on the first load.
//
// Every setter goes through the editor's own state and actions (the bridge App hands over: setProject, updateLayout,
// updateLayer, the save and export handlers and the rest), so undo, the unsaved-changes state and autosave treat an
// API edit exactly as the same click. No native dialog opens: saveAs takes its name, and a map with unsaved changes
// is only replaced when asked to ({ discard: true }). Invalid input throws an Error that says what is allowed.

import { helpText } from './help.js';
import { ROLE_LABELS, CALLOUT_TYPES, MAP_TYPES, TEMPLATE_THEMES, FONT_OPTIONS, mapTypeOf } from '../projectState';
import { BASEMAP_KEYS } from '../utils/basemapConfig.js';
import { canExportFormat } from '../utils/entitlements';
import { geojsonBounds } from '../utils/geometry';
import { layerGeometryKind } from '../utils/featureIdentity.js';
import { insetStyle, insetStylePatch } from '../utils/insetStyle';
import { CORNER_KEY, getCornerLayout, moveToCorner } from '../utils/cornerLayout';
import { studioScaleHome } from '../utils/studioLayout.js';

export const VERSION = 1;

// Kept here rather than imported, so the API does not load the lazy modules that own them (geoStyle.js, the
// drill plan, the PDF exporter); tests/emap-api.test.js checks each list against its owner.
export const LINE_TYPES = ['plain', 'zone', 'trend', 'fault', 'thrust'];
export const NORTH_STYLES = ['classic', 'arrow', 'decorative', 'surveyor', 'rose', 'split'];
export const SHAPES = ['circle', 'square', 'triangle', 'triangle_down', 'diamond', 'cross', 'star', 'hexagon', 'pin', 'drillhole'];
export const PDF_SIZES = ['ppt_169', 'letter_landscape', 'letter_portrait', 'a4_landscape', 'a4_portrait', 'news_release'];
export const PLAN_KINDS = ['collars', 'surveys', 'assays', 'published', 'ignore'];
export const CARD_KINDS = ['title', 'legend', 'inset', 'scale', 'callout'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const MAX_FEATURES = 200000;

// ── Validation ───────────────────────────────────────────────────────────────────────────────────────────
const fail = (m) => { throw new Error(m); };
const quote = (a) => a.map((x) => `"${x}"`).join(', ');
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const has = (o, k) => o[k] !== undefined;

/** The options object fn was given, with only the keys it takes. */
export function opts(o, fn, allowed) {
  if (o === undefined) return {};
  if (!isObj(o)) fail(`${fn} takes an object, e.g. ${fn}({ ${allowed[0]}: … }).`);
  const bad = Object.keys(o).filter((k) => !allowed.includes(k));
  if (bad.length) fail(`${fn} does not take ${quote(bad)}. It takes: ${allowed.join(', ')}.`);
  return o;
}
export function num(v, k, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${k} must be a number from ${lo} to ${hi}.`);
  return v;
}
export function bool(v, k) {
  if (typeof v !== 'boolean') fail(`${k} must be true or false.`);
  return v;
}
export function text(v, k, max = 400) {
  if (typeof v !== 'string') fail(`${k} must be text (a string).`);
  if (v.length > max) fail(`${k} must be at most ${max} characters.`);
  return v;
}
export function hex(v, k, nullable = false) {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail(`${k} must be a hex colour like #2563eb${nullable ? ', or null' : ''}.`);
  return v.toLowerCase();
}
export function oneOf(v, k, list) {
  if (!list.includes(v)) fail(`${k} must be one of ${quote(list)}.`);
  return v;
}
export function latLng(v, k = 'at') {
  const [lat, lng] = Array.isArray(v) ? v : isObj(v) ? [v.lat, v.lng ?? v.lon] : [];
  if (typeof lat !== 'number' || typeof lng !== 'number' || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    fail(`${k} must be {lat, lng} (or [lat, lng]) in degrees: lat -90 to 90, lng -180 to 180.`);
  }
  return { lat, lng };
}
export function bounds(v) {
  const b = Array.isArray(v) && v.length === 2 && Array.isArray(v[0]) ? { south: v[0][0], west: v[0][1], north: v[1][0], east: v[1][1] } : v;
  if (!isObj(b) || ![b.south, b.west, b.north, b.east].every((n) => typeof n === 'number' && Number.isFinite(n))
    || b.south < -90 || b.north > 90 || b.west < -180 || b.east > 180 || b.south >= b.north || b.west >= b.east) {
    fail('bounds must be {south, west, north, east} (or [[south, west], [north, east]]) in degrees, south below north and west of east.');
  }
  return b;
}
const corner = (v, k = 'corner') => oneOf(v, k, CORNERS);

/** A GeoJSON FeatureCollection from a collection, a feature or a bare geometry, or an error saying what is wrong. */
export function featureCollection(g) {
  const GEOMS = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
  const msg = 'geojson must be a GeoJSON FeatureCollection, Feature or geometry in longitude/latitude';
  if (!isObj(g)) fail(`${msg}.`);
  const fc = g.type === 'FeatureCollection' ? g : g.type === 'Feature' ? { type: 'FeatureCollection', features: [g] }
    : GEOMS.includes(g.type) ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: g }] } : null;
  if (!fc || !Array.isArray(fc.features)) fail(`${msg} (type "${g.type}" is none of these).`);
  if (!fc.features.length) fail('geojson has no features.');
  if (fc.features.length > MAX_FEATURES) fail(`geojson has ${fc.features.length} features; a layer takes at most ${MAX_FEATURES}.`);
  fc.features.forEach((f, i) => {
    if (!isObj(f) || f.type !== 'Feature' || !isObj(f.geometry) || !GEOMS.includes(f.geometry.type) || !Array.isArray(f.geometry.coordinates)) {
      fail(`Feature ${i} is not a Feature with a ${GEOMS.join(', ')} geometry.`);
    }
  });
  const b = geojsonBounds(fc);
  if (!b || b.minLat < -90 || b.maxLat > 90 || b.minLng < -180 || b.maxLng > 180) {
    fail('geojson coordinates must be longitude, latitude in degrees (WGS 84); these are out of range, perhaps metres.');
  }
  return { ...fc, features: fc.features.map((f) => ({ ...f, properties: isObj(f.properties) ? f.properties : {} })) };
}

// ── Checks per setting ─────────────────────────────────────────────────────────────────────────────────────
const AREA_FX = ['feather', 'outline', 'plume'];
const LINE_FX = ['lineType', 'glow', 'glowOpacity', 'glowColor', 'casing', 'teeth'];
/** A layer.fx patch for a layer of this geometry ("polygon" or "line"), checked. */
export function fxPatch(o, kind, name = 'the layer') {
  opts(o, 'setGeoStyle', [...AREA_FX, ...LINE_FX]);
  const wrong = Object.keys(o).filter((k) => (kind === 'line' ? AREA_FX : LINE_FX).includes(k));
  if (wrong.length) fail(`${quote(wrong)} ${wrong.length > 1 ? 'are' : 'is'} for ${kind === 'line' ? 'areas' : 'lines'}; ${name} is ${kind === 'line' ? 'a line layer: use lineType, glow, glowOpacity, glowColor, casing, teeth' : 'an area layer: use feather, outline, plume'}.`);
  const p = {};
  if (has(o, 'feather')) p.feather = num(o.feather, 'feather', 0, 40);
  if (has(o, 'outline')) p.outline = bool(o.outline, 'outline');
  if (has(o, 'plume')) {
    if (o.plume === null || o.plume === false) p.plume = null;
    else if (o.plume === true) p.plume = { az: 225, tail: 0, blur: 4 };
    else {
      const q = opts(o.plume, 'plume', ['az', 'tail', 'blur']);
      p.plume = { az: has(q, 'az') ? num(q.az, 'plume.az', 0, 360) : 225, tail: has(q, 'tail') ? num(q.tail, 'plume.tail', 0, 1) : 0, blur: has(q, 'blur') ? num(q.blur, 'plume.blur', 0, 40) : 4 };
    }
  }
  if (has(o, 'lineType')) {
    p.lineType = oneOf(o.lineType, 'lineType', LINE_TYPES);
    if (!has(o, 'casing')) p.casing = p.lineType === 'zone'; // as the Line type picker does
  }
  if (has(o, 'glow')) p.glow = num(o.glow, 'glow', 0, 24);
  if (has(o, 'glowOpacity')) p.glowOpacity = num(o.glowOpacity, 'glowOpacity', 0, 1);
  if (has(o, 'glowColor')) p.glowColor = hex(o.glowColor, 'glowColor', true);
  if (has(o, 'casing')) p.casing = bool(o.casing, 'casing');
  if (has(o, 'teeth')) p.teeth = oneOf(o.teeth, 'teeth', ['left', 'right']);
  return p;
}

const LABEL_BOTH = ['text', 'field', 'size', 'weight', 'ls', 'caps', 'color', 'opacity', 'halo', 'nudge'];
const LABEL_LINE = ['side', 'offset', 'start', 'flip'];
const LABEL_AREA = ['sub', 'subField', 'rotate', 'fit', 'minSize', 'per'];
/** A layer.fx.label patch for a layer of this geometry, checked; fields: the property names its features have. */
export function labelPatch(o, kind, fields = []) {
  opts(o, 'setLayerLabel', [...LABEL_BOTH, ...LABEL_LINE, ...LABEL_AREA]);
  const wrong = Object.keys(o).filter((k) => (kind === 'line' ? LABEL_AREA : LABEL_LINE).includes(k));
  if (wrong.length) fail(`${quote(wrong)} ${wrong.length > 1 ? 'are' : 'is'} for ${kind === 'line' ? 'area' : 'line'} labels; this is ${kind === 'line' ? `a line layer: use ${LABEL_LINE.join(', ')}` : `an area layer: use ${LABEL_AREA.join(', ')}`}.`);
  const p = {};
  const field = (v, k) => {
    if (v === '' || v === null) return '';
    text(v, k, 120);
    if (!fields.includes(v)) fail(`${k} must be a property of the layer's features (${fields.length ? quote(fields) : 'it has none'}), or "" for none.`);
    return v;
  };
  if (has(o, 'text')) p.text = text(o.text, 'text', 120);
  if (has(o, 'field')) p.field = field(o.field, 'field');
  if (has(o, 'sub')) p.sub = text(o.sub, 'sub', 120);
  if (has(o, 'subField')) p.subField = field(o.subField, 'subField');
  if (has(o, 'size')) p.size = num(o.size, 'size', 6, 48);
  if (has(o, 'weight')) p.weight = num(o.weight, 'weight', 300, 900);
  if (has(o, 'ls')) p.ls = num(o.ls, 'ls', 0, 1);
  if (has(o, 'caps')) p.caps = bool(o.caps, 'caps');
  if (has(o, 'color')) p.color = hex(o.color, 'color', true);
  if (has(o, 'opacity')) p.opacity = num(o.opacity, 'opacity', 0.1, 1);
  if (has(o, 'halo')) p.halo = o.halo === null ? null : bool(o.halo, 'halo');
  if (has(o, 'nudge')) p.nudge = bool(o.nudge, 'nudge');
  if (has(o, 'side')) p.side = oneOf(o.side, 'side', ['left', 'right', 'on']);
  if (has(o, 'offset')) p.offset = num(o.offset, 'offset', -40, 60);
  if (has(o, 'start')) p.start = num(o.start, 'start', 0, 100);
  if (has(o, 'flip')) p.flip = bool(o.flip, 'flip');
  if (has(o, 'rotate')) p.rotate = o.rotate === 'auto' ? 'auto' : num(o.rotate, 'rotate ("auto" or degrees)', -90, 90);
  if (has(o, 'fit')) p.fit = oneOf(o.fit, 'fit', ['shrink', 'hide']);
  if (has(o, 'minSize')) p.minSize = num(o.minSize, 'minSize', 4, 24);
  if (has(o, 'per')) p.per = oneOf(o.per, 'per', ['layer', 'feature']);
  return p;
}

const STYLE_KEYS = ['fill', 'stroke', 'fillOpacity', 'strokeWidth', 'dash', 'dissolve', 'markerSize', 'markerShape'];
/** A layer.style patch, as the Customize step's controls write it (a colour to both its area and point keys). */
export function stylePatch(o, kind) {
  opts(o, 'setLayerStyle', STYLE_KEYS);
  const pts = kind === 'points';
  const wrong = Object.keys(o).filter((k) => (pts ? ['fillOpacity', 'strokeWidth', 'dash', 'dissolve'] : ['markerSize', 'markerShape']).includes(k));
  if (wrong.length) fail(`${quote(wrong)} ${wrong.length > 1 ? 'are' : 'is'} not for ${pts ? 'a points layer: use fill, stroke, markerSize, markerShape' : 'an area or line layer: use fill, stroke, fillOpacity, strokeWidth, dash, dissolve'}.`);
  const s = {};
  if (has(o, 'fill')) { s.fill = hex(o.fill, 'fill'); s.markerFill = s.fill; }
  if (has(o, 'stroke')) { s.stroke = hex(o.stroke, 'stroke'); s.markerColor = s.stroke; }
  if (has(o, 'fillOpacity')) s.fillOpacity = num(o.fillOpacity, 'fillOpacity', 0, 1);
  if (has(o, 'strokeWidth')) s.strokeWidth = num(o.strokeWidth, 'strokeWidth', 0.5, 12);
  if (has(o, 'dash')) {
    if (typeof o.dash === 'boolean') s.dashArray = o.dash ? '8 5' : '';
    else if (typeof o.dash === 'string' && /^\d+(\.\d+)?([ ,]\d+(\.\d+)?)+$/.test(o.dash.trim())) s.dashArray = o.dash.trim();
    else fail('dash must be true, false or a dash pattern in px such as "8 5".');
  }
  if (has(o, 'dissolve')) s.dissolve = bool(o.dissolve, 'dissolve');
  if (has(o, 'markerSize')) s.markerSize = num(o.markerSize, 'markerSize', 1, 64);
  if (has(o, 'markerShape')) s.markerShape = oneOf(o.markerShape, 'markerShape', SHAPES);
  return s;
}

const CALLOUT_KEYS = ['text', 'subtext', 'type', 'at', 'layer', 'offset', 'boxWidth', 'badgeValue', 'badgeColor', 'style'];
const CALLOUT_STYLE = ['background', 'border', 'textColor', 'subtextColor', 'fontSize', 'textAlign'];
/** A callout's fields, checked (at: its anchor; layer is resolved by the caller). */
export function calloutPatch(o, fn = 'addCallout') {
  opts(o, fn, CALLOUT_KEYS);
  const c = {};
  if (has(o, 'text')) c.text = text(o.text, 'text', 400);
  if (has(o, 'subtext')) c.subtext = text(o.subtext, 'subtext', 400);
  if (has(o, 'type')) c.type = oneOf(o.type, 'type', Object.keys(CALLOUT_TYPES));
  if (has(o, 'at')) c.anchor = latLng(o.at, 'at');
  if (has(o, 'offset')) {
    const q = opts(o.offset, 'offset', ['x', 'y']);
    c.offset = { x: num(q.x ?? 0, 'offset.x', -2000, 2000), y: num(q.y ?? 0, 'offset.y', -2000, 2000) };
  }
  if (has(o, 'boxWidth')) c.boxWidth = num(o.boxWidth, 'boxWidth', 80, 480);
  if (has(o, 'badgeValue')) c.badgeValue = text(String(o.badgeValue), 'badgeValue', 40);
  if (has(o, 'badgeColor')) c.badgeColor = hex(o.badgeColor, 'badgeColor');
  if (has(o, 'style')) {
    const q = opts(o.style, 'style', CALLOUT_STYLE), st = {};
    ['background', 'border', 'textColor', 'subtextColor'].forEach((k) => { if (has(q, k)) st[k] = hex(q[k], `style.${k}`); });
    if (has(q, 'fontSize')) st.fontSize = num(q.fontSize, 'style.fontSize', 6, 40);
    if (has(q, 'textAlign')) st.textAlign = oneOf(q.textAlign, 'style.textAlign', ['left', 'center', 'right']);
    c.style = st;
  }
  return c;
}

const MAP_LABEL_KEYS = ['text', 'at', 'size', 'color', 'opacity', 'rotation', 'bold', 'tracking'];
/** A free map label's fields (a marker of type "maplabel"), checked. */
export function mapLabelPatch(o, fn = 'addMapLabel') {
  opts(o, fn, MAP_LABEL_KEYS);
  const m = {};
  if (has(o, 'text')) m.label = text(o.text, 'text', 200);
  if (has(o, 'at')) Object.assign(m, latLng(o.at, 'at'));
  if (has(o, 'size')) m.size = num(o.size, 'size', 8, 120);
  if (has(o, 'color')) m.color = hex(o.color, 'color');
  if (has(o, 'opacity')) m.opacity = num(o.opacity, 'opacity', 0, 1);
  if (has(o, 'rotation')) m.rotation = num(o.rotation, 'rotation', -180, 180);
  if (has(o, 'bold')) m.bold = bool(o.bold, 'bold');
  if (has(o, 'tracking')) m.tracking = num(o.tracking, 'tracking', 0, 1);
  return m;
}

const MARKER_KEYS = ['at', 'type', 'color', 'size', 'label'];
export function markerPatch(o, fn = 'addMarker') {
  opts(o, fn, MARKER_KEYS);
  const m = {};
  if (has(o, 'at')) Object.assign(m, latLng(o.at, 'at'));
  if (has(o, 'type')) m.type = oneOf(o.type, 'type', SHAPES);
  if (has(o, 'color')) m.color = hex(o.color, 'color');
  if (has(o, 'size')) m.size = num(o.size, 'size', 6, 64);
  if (has(o, 'label')) m.label = text(o.label, 'label', 200);
  return m;
}

// ── The API ────────────────────────────────────────────────────────────────────────────────────────────────
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * The EMAP object over a bridge: getBridge() returns App's current state and actions (src/App.jsx, "window.EMAP").
 * win: where events are sent (window in the page).
 */
export function createApi(getBridge, win = typeof window !== 'undefined' ? window : null) {
  const B = () => getBridge() || fail('The map editor is not open.');
  const ed = () => {
    const b = B();
    if (b.screen !== 'editor') fail('Open the map editor first: EMAP works on the editor screen.');
    return b;
  };
  const mapOf = () => {
    const b = ed();
    if (!b.mapReady || !b.map) fail('The map is not ready yet: await EMAP.ready() first.');
    return b.map;
  };

  // A change is done once React has rendered it: wait until the bridge holds a new project (or a moment, for a
  // change that left it as it was), then one frame more for the effects that follow it.
  async function settle(before) {
    for (let i = 0; i < 12 && B().project === before; i += 1) await pause(16);
    await pause(16);
  }
  async function change(fn) {
    const b = ed(), before = b.project;
    const out = await fn(b);
    await settle(before);
    const st = getState();
    win?.dispatchEvent?.(new CustomEvent('emap:change', { detail: st }));
    return out === undefined ? st : out;
  }
  const layout = () => B().project.layout || {};
  const setLayout = (patch) => change((b) => { b.updateLayout(patch); });
  // A card moved to a corner goes to its outside, as a drop on that corner puts it.
  const cornerPatch = (id, c) => {
    const L = layout();
    return { cornerLayout: moveToCorner(getCornerLayout(L), id, corner(c)), [CORNER_KEY[id]]: c };
  };

  // ── Layers ──
  const nameOf = (l) => l.displayName || l.legend?.label || l.name || l.id;
  function layer(ref) {
    const ls = B().project.layers;
    if (typeof ref !== 'string' || !ref) fail(`Give a layer id or name. Layers: ${ls.map((l) => `${l.id} (${nameOf(l)})`).join(', ') || 'none yet'}.`);
    const byId = ls.find((l) => l.id === ref);
    if (byId) return byId;
    const byName = ls.filter((l) => [l.displayName, l.name, l.legend?.label].includes(ref));
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) fail(`More than one layer is named "${ref}": use its id (${byName.map((l) => l.id).join(', ')}).`);
    return fail(`No layer "${ref}". Layers: ${ls.map((l) => `${l.id} (${nameOf(l)})`).join(', ') || 'none yet'}.`);
  }
  const kindOf = (l) => (l.type === 'raster' || l.type === 'tiles' ? l.type : layerGeometryKind(l));
  const fieldsOf = (l) => [...new Set((l.geojson?.features || []).slice(0, 200).flatMap((f) => Object.keys(f?.properties || {})))].filter((k) => !k.startsWith('_'));
  function layerInfo(l) {
    const L = layout();
    return {
      id: l.id, name: nameOf(l), type: l.type, geometry: kindOf(l), role: l.role, visible: l.visible !== false,
      opacity: l.type === 'raster' ? l.raster?.opacity ?? 0.85 : l.type === 'tiles' ? l.tiles?.opacity ?? 0.85 : l.style?.layerOpacity ?? 1,
      legend: l.legend?.enabled !== false, style: clone(l.style || {}), fx: clone(l.fx) ?? null,
      features: l.geojson?.features?.length ?? 0, framing: L.primaryLayerId === l.id,
    };
  }
  // The same change as GeoStyleControls makes: fx replaced (or dropped), the layer marked as styled by hand.
  const writeFx = (id, next) => (b) => b.setProject((prev) => ({
    ...prev,
    layers: prev.layers.map((l) => {
      if (l.id !== id) return l;
      const { fx: _old, ...rest } = l;
      return next ? { ...rest, fx: next, userStyled: true } : rest;
    }),
  }));

  // ── View ──
  function getView() {
    const map = B().map;
    if (!map) return null;
    const c = map.getCenter(), z = map.getZoom(), bb = map.getBounds();
    return { center: { lat: c.lat, lng: c.lng }, zoom: z, bounds: { south: bb.getSouth(), west: bb.getWest(), north: bb.getNorth(), east: bb.getEast() } };
  }
  // Moves the map, then waits for the editor to keep the view (it saves a view 0.6 s after the map stops).
  async function move(run) {
    const map = mapOf();
    await change(async () => {
      const done = new Promise((r) => { const t = setTimeout(r, 1500); map.once('moveend', () => { clearTimeout(t); r(); }); });
      run(map);
      await done;
      await pause(700);
    });
    return getState();
  }

  // ── Drill plan ──
  const plan = () => B().project.drillPlan || fail('This map has no drill plan: EMAP.setDrillPlan({ files, crs }) first.');
  const planChange = (patch) => change((b) => { plan(); b.updateDrillPlan(patch); });

  // ── Export ──
  const FORMAT = { png: 'png', svg: 'svg', pdf: 'pdf', layers: 'png' };
  const EXPORT_KEYS = { png: ['as', 'band', 'bandClient', 'pixelRatio', 'width', 'height', 'background', 'filename', 'download'], svg: ['as', 'band', 'bandClient', 'filename', 'download'], pdf: ['as', 'pdfSize', 'band', 'bandClient', 'filename', 'download'], layers: ['as', 'svg', 'band', 'bandClient', 'pixelRatio', 'filename', 'download'] };
  async function exportAs(format, o, fn) {
    const b = ed();
    opts(o, fn, EXPORT_KEYS[format]);
    const as = o.as === undefined ? (format === 'svg' ? 'text' : 'dataUrl') : oneOf(o.as, 'as', format === 'svg' ? ['text', 'dataUrl', 'blob'] : ['dataUrl', 'blob']);
    const ent = b.entitlements;
    if (!canExportFormat(ent, FORMAT[format])) fail(`${format.toUpperCase()} export is not on this plan. This account exports: ${['png', 'svg', 'pdf'].filter((f) => canExportFormat(ent, f)).join(', ').toUpperCase() || 'nothing yet'}.`);
    mapOf();
    const x = {};
    if (has(o, 'band')) x.band = bool(o.band, 'band');
    if (has(o, 'bandClient')) x.bandClient = text(o.bandClient, 'bandClient', 120);
    if (has(o, 'pixelRatio')) x.pixelRatio = num(o.pixelRatio, 'pixelRatio', 1, 4);
    if (has(o, 'width') !== has(o, 'height')) fail('Give width and height together (px), or neither.');
    if (has(o, 'width')) { x.customWidth = Math.round(num(o.width, 'width', 100, 12000)); x.customHeight = Math.round(num(o.height, 'height', 100, 12000)); }
    if (has(o, 'background')) x.background = oneOf(o.background, 'background', ['white', 'transparent']);
    if (has(o, 'filename')) x.filename = text(o.filename, 'filename', 120).replace(/[\\/:*?"<>|]+/g, '-');
    if (has(o, 'pdfSize')) x.pdfSize = oneOf(o.pdfSize, 'pdfSize', PDF_SIZES);
    if (has(o, 'svg')) {
      x.layersSvg = bool(o.svg, 'svg');
      if (x.layersSvg && !canExportFormat(ent, 'svg')) fail('annotations.svg needs SVG export, which is not on this plan: use svg: false.');
    }
    const download = has(o, 'download') ? bool(o.download, 'download') : false;
    const res = await b.exportFile(format, { ...x, as: download && as !== 'blob' ? 'blob' : as });
    if (!res) fail('The export did not run.');
    let data = res.file;
    if (download) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const ext = { png: 'png', svg: 'svg', pdf: 'pdf', layers: 'zip' }[format];
      const name = `${x.filename || layout().exportSettings?.filename || 'exploration-maps-export'}${format === 'layers' ? '-layers' : ''}.${ext}`;
      const { downloadBlob, blobAs } = await import('../utils/svg');
      downloadBlob(name, blob);
      if (as !== 'blob') data = await blobAs(blob, as);
    }
    return { data, clamped: !!res.clamped, warnings: res.warnings || [] };
  }

  // ── Project ──
  const guard = (o, fn) => {
    const q = opts(o, fn, fn === 'loadProject' ? ['name', 'discard'] : ['discard']);
    if (has(q, 'discard')) bool(q.discard, 'discard');
    if (B().isDirty && !q.discard) fail(`This map has unsaved changes: EMAP.save() first, or ${fn}(…, { discard: true }) to leave them.`);
    return q;
  };
  const projects = () => (B().recentProjects || []).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updated_at || p.updatedAt || null }));
  // Saving is done when the editor has taken the saved map's id and name (or said why it could not).
  async function saved(run) {
    const b = ed(), id0 = b.projectId, name0 = b.projectName;
    const out = await run(b);
    if (out?.status === 'error') fail(`Saving failed: ${out.err?.message || 'unknown error'}.`);
    for (let i = 0; i < 40; i += 1) { await pause(25); const n = B(); if (n.projectId !== id0 || n.projectName !== name0 || !n.isDirty) break; }
    await pause(30);
    return getState();
  }

  // ── State ──
  function getState() {
    const b = B(), p = b.project, L = p.layout || {}, s = L.studio || {}, es = L.exportSettings || {}, dp = p.drillPlan;
    const markers = p.markers || [];
    return {
      version: VERSION, screen: b.screen, ready: Boolean(b.mapReady && b.map),
      map: { id: b.projectId || null, name: b.projectName || L.title || '', unsaved: Boolean(b.isDirty), signedIn: Boolean(b.user) },
      plan: { formats: ['png', 'svg', 'pdf'].filter((f) => canExportFormat(b.entitlements, f)), cleanExport: Boolean(b.entitlements?.clean_export), maxExportPixels: b.entitlements?.max_export_pixels ?? null },
      view: getView(),
      basemap: L.basemap, wash: clone(L.wash) ?? null,
      layers: p.layers.map(layerInfo),
      theme: { theme: L.themeId || 'investor_clean', mapType: mapTypeOf(L), template: L.templateId, accent: L.accentColor ?? null, titleBg: L.titleBgColor ?? null, titleText: L.titleFgColor ?? null, panelBg: L.panelBgColor ?? null, panelText: L.panelFgColor ?? null, fonts: clone(L.fonts || {}), cards: clone(s.cards || {}) },
      title: { title: L.title || '', subtitle: L.subtitle || '', kicker: s.kicker ?? null, date: L.mapDate || '', projectNumber: L.projectNumber || '', scaleNote: L.mapScaleNote || '', show: L.showTitle !== false, box: !L.titleTransparent, corner: L.titleCorner || 'tl' },
      legend: { show: L.showLegend !== false, title: L.legendTitle ?? 'Legend', corner: L.legendCorner || 'bl', box: !L.legendTransparent, items: (b.legend || []).map((i) => ({ id: i.id, label: i.label, group: i.group || null, type: i.type || null })) },
      inset: { enabled: L.insetEnabled !== false, style: insetStyle(L) === 'satellite_locator' ? 'satellite' : insetStyle(L), title: L.insetTitle ?? 'Project Locator', label: L.insetLabel || '', corner: L.insetCorner || 'tr', pill: s.pill ?? null, projectLabel: s.projectLabel ?? null, region: L.autoInsetRegion?.name || null },
      scaleNorth: { scaleBar: L.showScaleBar !== false, northArrow: L.showNorthArrow !== false, northStyle: L.northArrowStyle || 'classic', home: L.themeId === 'studio' ? studioScaleHome(L) : null, datumNote: s.datumNote ?? null, datumSub: s.datumSub ?? null, corner: L.scaleBarCorner || 'bl', northCorner: L.northArrowCorner || 'br' },
      footer: { text: L.footerText || '', show: L.footerEnabled !== false },
      labelHalo: clone(L.labelHalo) ?? null,
      callouts: (p.callouts || []).map((c) => ({ id: c.id, text: c.text, subtext: c.subtext || '', type: c.type, at: c.anchor ? { lat: c.anchor.lat, lng: c.anchor.lng } : null, offset: clone(c.offset) ?? null, layer: c.layerId || null })),
      mapLabels: markers.filter((m) => m.type === 'maplabel').map((m) => ({ id: m.id, text: m.label, at: { lat: m.lat, lng: m.lng }, size: m.size, color: m.color, opacity: m.opacity, rotation: m.rotation || 0 })),
      markers: markers.filter((m) => m.type !== 'maplabel' && m.type !== 'image').map((m) => ({ id: m.id, type: m.type, at: { lat: m.lat, lng: m.lng }, color: m.color, size: m.size, label: m.label || '' })),
      drillPlan: dp ? {
        holes: (dp.holes || []).map((h) => h.id), results: (dp.results || []).map((r) => ({ id: r.resultId, hole: r.holeId, from: r.fromM, to: r.toM })),
        elements: (dp.assays?.elements || []).map((e) => e.name), element: dp.element ?? null, crs: dp.crs, show: clone(dp.show || {}),
        release: clone(dp.release || {}), headings: clone(dp.headings || {}), highlight: clone(dp.highlight) ?? null, section: clone(dp.section) ?? null,
      } : null,
      export: { band: es.band ?? Boolean(b.bandDefault), bandClient: es.bandClient || '', pixelRatio: es.pixelRatio ?? 2, filename: es.filename || '', layersSvg: Boolean(es.layersSvg) },
      projects: projects().length,
    };
  }

  const api = {
    version: VERSION,
    help: (section) => helpText(section),

    // ── State ──
    getState,
    getProject: () => clone(B().project),
    async ready() {
      for (let i = 0; i < 400; i += 1) { const b = B(); if (b.screen === 'editor' && b.mapReady && b.map) return getState(); await pause(50); }
      return fail('The map did not become ready within 20 s: is the editor open?');
    },
    undo: () => change((b) => { b.step(false); }),
    redo: () => change((b) => { b.step(true); }),

    // ── View ──
    getView,
    setView(o) {
      opts(o, 'setView', ['center', 'zoom', 'bounds', 'padding']);
      if (has(o, 'bounds') && (has(o, 'center') || has(o, 'zoom'))) fail('Give bounds, or center and zoom, not both.');
      if (!has(o, 'bounds') && !has(o, 'center') && !has(o, 'zoom')) fail('setView takes {center, zoom} or {bounds}.');
      const pad = has(o, 'padding') ? num(o.padding, 'padding', 0, 400) : 40;
      if (has(o, 'bounds')) {
        const bb = bounds(o.bounds);
        return move((map) => map.fitBounds([[bb.south, bb.west], [bb.north, bb.east]], { padding: [pad, pad], animate: false }));
      }
      const c = has(o, 'center') ? latLng(o.center, 'center') : null, z = has(o, 'zoom') ? num(o.zoom, 'zoom', 1, 22) : null;
      return move((map) => map.setView(c ? [c.lat, c.lng] : map.getCenter(), z ?? map.getZoom(), { animate: false }));
    },
    fitLayer(ref, o) {
      const q = opts(o, 'fitLayer', ['padding']), l = layer(ref), bb = l.geojson?.features?.length ? geojsonBounds(l.geojson) : null;
      if (!bb) fail(`${nameOf(l)} has no shapes to frame.`);
      const pad = has(q, 'padding') ? num(q.padding, 'padding', 0, 400) : 40;
      return move((map) => map.fitBounds([[bb.minLat, bb.minLng], [bb.maxLat, bb.maxLng]], { padding: [pad, pad], animate: false }));
    },
    fitAll: () => { mapOf(); return move(() => B().autoFrameAll()); },

    // ── Layers ──
    listLayers: () => B().project.layers.map(layerInfo),
    async addLayer(o) {
      const q = opts(o, 'addLayer', ['name', 'geojson', 'role', 'style', 'fx', 'legend']);
      ed();
      const name = text(q.name, 'name', 120).trim() || fail('name must not be empty.');
      const fc = featureCollection(q.geojson);
      if (has(q, 'role')) oneOf(q.role, 'role', Object.keys(ROLE_LABELS));
      if (has(q, 'legend')) bool(q.legend, 'legend');
      // Checked before anything is added, so a bad style adds nothing.
      const kind = layerGeometryKind({ type: fc.features.some((f) => /Point/.test(f.geometry.type)) && fc.features.every((f) => /Point/.test(f.geometry.type)) ? 'points' : 'geojson', geojson: fc });
      const style = has(q, 'style') ? stylePatch(q.style, kind) : null;
      if (has(q, 'fx') && kind === 'points') fail('Points layers have no geology style (fx); style them with style.');
      const fx = has(q, 'fx') && q.fx !== null ? fxPatch(q.fx, kind, name) : null;
      const id = await change((b) => b.addLayer(fc, `${name}.geojson`, 'api', null, q.role || null));
      await change((b) => {
        b.setDisplayLabel(id, name);
        if (style) b.updateLayer(id, { style });
        if (q.legend === false) b.updateLayer(id, { legend: { enabled: false } });
      });
      if (fx) await change(writeFx(id, fx));
      return id;
    },
    removeLayer(ref) { const l = layer(ref); return change((b) => { b.removeLayer(l.id); }); },
    moveLayer(ref, dir) { const l = layer(ref); oneOf(dir, 'direction', ['up', 'down']); return change((b) => { b.moveLayer(l.id, dir); }); },
    setLayer(ref, o) {
      const l = layer(ref), q = opts(o, 'setLayer', ['name', 'role', 'visible', 'opacity', 'legend', 'framing']);
      if (has(q, 'name')) text(q.name, 'name', 120);
      if (has(q, 'role')) oneOf(q.role, 'role', Object.keys(ROLE_LABELS));
      if (has(q, 'visible')) bool(q.visible, 'visible');
      if (has(q, 'opacity')) num(q.opacity, 'opacity', 0, 1);
      if (has(q, 'legend')) bool(q.legend, 'legend');
      if (has(q, 'framing')) bool(q.framing, 'framing');
      return change((b) => {
        if (has(q, 'name')) b.setDisplayLabel(l.id, q.name);
        if (has(q, 'role') && q.role !== l.role) b.changeLayerRole(l.id, q.role);
        if (has(q, 'visible')) b.updateLayer(l.id, { visible: q.visible });
        if (has(q, 'opacity')) b.updateLayer(l.id, l.type === 'raster' ? { raster: { opacity: q.opacity } } : l.type === 'tiles' ? { tiles: { opacity: q.opacity } } : { style: { layerOpacity: q.opacity } });
        if (has(q, 'legend')) b.updateLayer(l.id, { legend: { enabled: q.legend } });
        if (has(q, 'framing') && q.framing !== (b.project.layout.primaryLayerId === l.id)) b.setFramingLayer(l.id);
      });
    },
    setLayerStyle(ref, o) {
      const l = layer(ref), kind = kindOf(l);
      if (kind === 'raster' || kind === 'tiles') fail(`${nameOf(l)} is an image layer: only its opacity is set (setLayer(…, { opacity })).`);
      const style = stylePatch(o, kind);
      return change((b) => { b.updateLayer(l.id, { style }); });
    },
    setGeoStyle(ref, o) {
      const l = layer(ref), kind = kindOf(l);
      if (kind !== 'polygon' && kind !== 'line') fail(`${nameOf(l)} is a ${kind} layer; geology styling is for area and line layers.`);
      if (o === null) return change(writeFx(l.id, null));
      const p = fxPatch(o, kind, nameOf(l));
      return change(writeFx(l.id, { ...(l.fx || {}), ...p }));
    },
    setWash(o) {
      if (o === null) return setLayout({ wash: null });
      const q = opts(o, 'setWash', ['amount', 'vignette', 'color']);
      if (layout().basemap === 'blank') fail('The wash is drawn over a basemap; this map uses the blank one (setBasemap first).');
      const w = { amount: 0, vignette: 0, color: '#ffffff', ...(layout().wash || {}) };
      if (has(q, 'amount')) w.amount = num(q.amount, 'amount', 0, 0.8);
      if (has(q, 'vignette')) w.vignette = num(q.vignette, 'vignette', 0, 1);
      if (has(q, 'color')) w.color = hex(q.color, 'color');
      return setLayout({ wash: w.amount > 0 || w.vignette > 0 ? w : null });
    },
    setBasemap(key) { oneOf(key, 'basemap', BASEMAP_KEYS); return setLayout({ basemap: key }); },

    // ── Labels ──
    setLayerLabel(ref, o) {
      const l = layer(ref), kind = kindOf(l);
      if (kind !== 'polygon' && kind !== 'line') fail(`${nameOf(l)} is a ${kind} layer; names along lines and in areas are for line and area layers (a points layer is labelled with callouts).`);
      const fx = l.fx || {};
      if (o === null) return change(writeFx(l.id, fx.label ? { ...fx, label: { ...fx.label, on: false } } : (l.fx || null)));
      const p = labelPatch(o, kind, fieldsOf(l));
      return change(writeFx(l.id, { ...fx, label: { ...(fx.label || {}), ...p, on: true } }));
    },
    async addMapLabel(o) {
      const m = mapLabelPatch(o);
      if (!has(o, 'at')) fail('addMapLabel needs at: {lat, lng}.');
      if (!has(o, 'text')) fail('addMapLabel needs text.');
      const id = await change((b) => b.addMapLabel({ lat: m.lat, lng: m.lng }));
      await change((b) => { b.updateMarker(id, m); });
      return id;
    },
    updateMapLabel(id, o) { const mk = marker(id, true); const m = mapLabelPatch(o, 'updateMapLabel'); return change((b) => { b.updateMarker(mk.id, m); }); },
    removeMapLabel(id) { const mk = marker(id, true); return change((b) => { b.removeMarker(mk.id); }); },
    setLabelHalo(o) {
      if (o === false || o === null) return setLayout({ labelHalo: { ...(layout().labelHalo || {}), enabled: false } });
      const q = opts(o, 'setLabelHalo', ['color', 'width', 'opacity']);
      const h = { color: '#ffffff', width: 3, opacity: 0.9, ...(layout().labelHalo || {}), enabled: true };
      if (has(q, 'color')) h.color = hex(q.color, 'color');
      if (has(q, 'width')) h.width = num(q.width, 'width', 0, 8);
      if (has(q, 'opacity')) h.opacity = num(q.opacity, 'opacity', 0, 1);
      return setLayout({ labelHalo: h });
    },

    // ── Cards ──
    setTheme(o) {
      const q = opts(o, 'setTheme', ['theme', 'accent', 'titleBg', 'titleText', 'panelBg', 'panelText', 'fonts']), p = {};
      if (has(q, 'theme')) { p.themeId = oneOf(q.theme, 'theme', Object.keys(TEMPLATE_THEMES)); p.onboardingLayoutSelected = true; }
      [['accent', 'accentColor'], ['titleBg', 'titleBgColor'], ['titleText', 'titleFgColor'], ['panelBg', 'panelBgColor'], ['panelText', 'panelFgColor']].forEach(([k, key]) => { if (has(q, k)) p[key] = hex(q[k], k, true); });
      if (has(q, 'fonts')) {
        const f = opts(q.fonts, 'fonts', ['title', 'legend', 'callout', 'label', 'footer']);
        p.fonts = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, oneOf(v, `fonts.${k}`, Object.keys(FONT_OPTIONS))]));
      }
      return setLayout(p);
    },
    setMapType(type) { oneOf(type, 'type', Object.keys(MAP_TYPES)); return change((b) => { b.pickMapStyle(type); }); },
    setTitle(o) {
      const q = opts(o, 'setTitle', ['title', 'subtitle', 'kicker', 'date', 'projectNumber', 'scaleNote', 'show', 'box', 'corner']), p = {};
      if (has(q, 'title')) p.title = text(q.title, 'title', 200);
      if (has(q, 'subtitle')) p.subtitle = text(q.subtitle, 'subtitle', 200);
      if (has(q, 'kicker')) p.studio = { ...(layout().studio || {}), kicker: q.kicker === null ? undefined : text(q.kicker, 'kicker', 120) };
      if (has(q, 'date')) p.mapDate = text(q.date, 'date', 60);
      if (has(q, 'projectNumber')) p.projectNumber = text(q.projectNumber, 'projectNumber', 60);
      if (has(q, 'scaleNote')) p.mapScaleNote = text(q.scaleNote, 'scaleNote', 120);
      if (has(q, 'show')) p.showTitle = bool(q.show, 'show');
      if (has(q, 'box')) p.titleTransparent = !bool(q.box, 'box');
      if (has(q, 'corner')) Object.assign(p, cornerPatch('title', q.corner));
      return setLayout(p);
    },
    setLegend(o) {
      const q = opts(o, 'setLegend', ['show', 'title', 'corner', 'box', 'items']), p = {};
      if (has(q, 'show')) p.showLegend = bool(q.show, 'show');
      if (has(q, 'title')) p.legendTitle = text(q.title, 'title', 120);
      if (has(q, 'box')) p.legendTransparent = !bool(q.box, 'box');
      if (has(q, 'corner')) Object.assign(p, cornerPatch('legend', q.corner));
      if (has(q, 'items')) {
        if (!isObj(q.items)) fail('items must be {itemId: {label, hidden}}: ids from getState().legend.items.');
        const ids = (B().legend || []).map((i) => i.id), next = { ...(layout().legendOverrides || {}) };
        Object.entries(q.items).forEach(([id, v]) => {
          if (!ids.includes(id)) fail(`No legend item "${id}". Items: ${ids.join(', ') || 'none'}.`);
          const r = opts(v, `items["${id}"]`, ['label', 'hidden']), cur = { ...(next[id] || {}) };
          if (has(r, 'label')) cur.label = text(r.label, 'label', 120);
          if (has(r, 'hidden')) cur.hidden = bool(r.hidden, 'hidden');
          next[id] = cur;
        });
        p.legendOverrides = next;
      }
      return setLayout(p);
    },
    setInset(o) {
      const q = opts(o, 'setInset', ['enabled', 'style', 'title', 'label', 'corner', 'pill', 'projectLabel']), p = {};
      if (has(q, 'enabled')) p.insetEnabled = bool(q.enabled, 'enabled');
      if (has(q, 'style')) Object.assign(p, insetStylePatch(oneOf(q.style, 'style', ['standard', 'satellite']) === 'satellite' ? 'satellite_locator' : 'standard'));
      if (has(q, 'title')) p.insetTitle = text(q.title, 'title', 120);
      if (has(q, 'label')) p.insetLabel = text(q.label, 'label', 120);
      if (has(q, 'corner')) Object.assign(p, cornerPatch('inset', q.corner));
      if (has(q, 'pill') || has(q, 'projectLabel')) {
        p.studio = { ...(layout().studio || {}) };
        if (has(q, 'pill')) p.studio.pill = text(q.pill, 'pill', 60);
        if (has(q, 'projectLabel')) p.studio.projectLabel = text(q.projectLabel, 'projectLabel', 80);
      }
      return setLayout(p);
    },
    setScaleNorth(o) {
      const q = opts(o, 'setScaleNorth', ['scaleBar', 'northArrow', 'northStyle', 'home', 'datumNote', 'datumSub', 'corner', 'northCorner']), p = {};
      if (has(q, 'scaleBar')) p.showScaleBar = bool(q.scaleBar, 'scaleBar');
      if (has(q, 'northArrow')) p.showNorthArrow = bool(q.northArrow, 'northArrow');
      if (has(q, 'northStyle')) p.northArrowStyle = oneOf(q.northStyle, 'northStyle', NORTH_STYLES);
      if (has(q, 'home') || has(q, 'datumNote') || has(q, 'datumSub')) {
        const s = { ...(layout().studio || {}) };
        if (has(q, 'home')) {
          const h = oneOf(q.home, 'home', ['panel', 'title', 'apart']);
          s.titleScale = h === 'title'; s.scaleNorth = h !== 'apart';
        }
        if (has(q, 'datumNote')) s.datumNote = q.datumNote === null ? undefined : text(q.datumNote, 'datumNote', 120);
        if (has(q, 'datumSub')) s.datumSub = text(q.datumSub, 'datumSub', 120);
        p.studio = s;
      }
      let cl = null;
      if (has(q, 'corner')) { const c = cornerPatch('scaleBar', q.corner); cl = c.cornerLayout; Object.assign(p, c); }
      if (has(q, 'northCorner')) {
        const c = corner(q.northCorner, 'northCorner');
        p.cornerLayout = moveToCorner(cl || getCornerLayout(layout()), 'northArrow', c); p.northArrowCorner = c;
      }
      return setLayout(p);
    },
    setCard(kind, o) {
      oneOf(kind, 'kind', CARD_KINDS);
      const q = opts(o, 'setCard', ['tone', 'accent', 'radius', 'opacity', 'shadow']), c = {};
      if (has(q, 'tone')) c.tone = oneOf(q.tone, 'tone', ['light', 'dark']);
      if (has(q, 'accent')) c.accent = oneOf(q.accent, 'accent', ['left', 'top', 'none']);
      if (has(q, 'radius')) c.radius = num(q.radius, 'radius', 0, 24);
      if (has(q, 'opacity')) c.opacity = num(q.opacity, 'opacity', 0, 1);
      if (has(q, 'shadow')) c.shadow = bool(q.shadow, 'shadow');
      const s = layout().studio || {}, cards = s.cards || {};
      return setLayout({ studio: { ...s, cards: { ...cards, [kind]: { ...(cards[kind] || {}), ...c } } } });
    },
    setFooter(o) {
      const q = opts(o, 'setFooter', ['text', 'show']), p = {};
      if (has(q, 'text')) p.footerText = text(q.text, 'text', 400);
      if (has(q, 'show')) p.footerEnabled = bool(q.show, 'show');
      return setLayout(p);
    },

    // ── Callouts and markers ──
    async addCallout(o) {
      const c = calloutPatch(o);
      if (!has(o, 'text')) fail('addCallout needs text.');
      if (has(o, 'at') === has(o, 'layer')) fail('addCallout needs at: {lat, lng}, or layer: a layer id or name to anchor on (one of them).');
      let anchor = c.anchor, layerId = null;
      if (has(o, 'layer')) {
        const l = layer(o.layer);
        const { defaultAnchorForLayer } = await import('../utils/featureClusters.js');
        const a = defaultAnchorForLayer(l) || fail(`${nameOf(l)} has no shape to anchor a callout on.`);
        anchor = { lat: a.lat, lng: a.lng }; layerId = l.id;
      }
      const id = await change((b) => b.addCallout({ text: c.text, subtext: c.subtext || '', type: c.type || (layerId ? 'boxed' : 'leader'), anchor, layerId, style: c.style || {}, boxWidth: c.boxWidth || 188, badgeValue: c.badgeValue, badgeColor: c.badgeColor }));
      // Placed by hand, as a callout dragged on the stage.
      if (c.offset) await change((b) => { b.updateCallout(id, { offset: c.offset, isManualPosition: true }); });
      return id;
    },
    updateCallout(id, o) {
      const cur = callout(id), c = calloutPatch(o, 'updateCallout');
      if (has(o, 'layer')) fail('updateCallout does not move a callout to a layer: give at: {lat, lng}.');
      if (c.style) c.style = { ...(cur.style || {}), ...c.style };
      if (c.offset) c.isManualPosition = true;
      return change((b) => { b.updateCallout(cur.id, c); });
    },
    removeCallout(id) { const c = callout(id); return change((b) => { b.removeCallout(c.id); }); },
    arrangeCallouts() { mapOf(); return change((b) => b.arrangeCallouts().then(() => undefined)); },
    async addMarker(o) {
      const m = markerPatch(o);
      if (!has(o, 'at')) fail('addMarker needs at: {lat, lng}.');
      const id = await change((b) => b.addMarker({ lat: m.lat, lng: m.lng }));
      await change((b) => { b.updateMarker(id, m); });
      return id;
    },
    updateMarker(id, o) { const mk = marker(id, false); const m = markerPatch(o, 'updateMarker'); return change((b) => { b.updateMarker(mk.id, m); }); },
    removeMarker(id) { const mk = marker(id, false); return change((b) => { b.removeMarker(mk.id); }); },

    // ── Drill plan ──
    async setDrillPlan(o) {
      const q = opts(o, 'setDrillPlan', ['files', 'crs']);
      ed();
      if (!Array.isArray(q.files) || !q.files.length) fail('files must be [{name, text, kind}]: CSV text of collars, surveys, assays and published results.');
      const D = await import('../utils/drillPlanData.js');
      if (has(q, 'crs') && q.crs !== null && !D.CRS_OPTIONS.some((c) => c.code === q.crs)) fail(`crs must be "EPSG:4326", a UTM zone such as "EPSG:26910" (NAD83 / UTM 10N), "EPSG:32611" or "EPSG:32719", or "EPSG:3005" (BC Albers).`);
      const tables = [];
      for (const [i, f] of q.files.entries()) {
        const r = opts(f, `files[${i}]`, ['name', 'text', 'kind']);
        text(r.name, `files[${i}].name`, 200);
        if (typeof r.text !== 'string' || !r.text.trim()) fail(`files[${i}].text must be the file's CSV text.`);
        const t = await D.parseTable(r.text);
        tables.push({ name: r.name, ...t, kind: has(r, 'kind') ? oneOf(r.kind, `files[${i}].kind`, PLAN_KINDS) : D.guessKind(t.header, t.rows, r.name) });
      }
      const prev = B().project.drillPlan || null;
      const { plan: next, notes, problems } = await D.buildPlan(tables, { crs: q.crs || null, prev });
      await change((b) => { b.replaceDrillPlan(next); });
      // A new plan is framed once its legend rows have settled, as the panel frames it.
      if (!prev && B().map) { await pause(450); await api.fitDrillPlan(); }
      return { holes: next.holes.length, assays: Object.values(next.assays.rows).reduce((s, l) => s + l.length, 0), results: next.results.length, notes, problems };
    },
    updateDrillPlan(o) {
      const q = opts(o, 'updateDrillPlan', ['show', 'element', 'bins', 'fan', 'legend']), p = {}, cur = plan();
      if (has(q, 'show')) {
        const s = opts(q.show, 'show', ['traces', 'bars', 'pills', 'collars', 'tags', 'padTag', 'card', 'highlight']);
        Object.entries(s).forEach(([k, v]) => bool(v, `show.${k}`));
        p.show = { ...(cur.show || {}), ...s };
      }
      if (has(q, 'element')) p.element = oneOf(q.element, 'element', (cur.assays?.elements || []).map((e) => e.name));
      if (has(q, 'bins')) {
        if (!Array.isArray(q.bins) || !q.bins.length || q.bins.length > 8) fail('bins must be 1 to 8 [{min, color}], lowest first.');
        p.bins = q.bins.map((x, i) => { const r = opts(x, `bins[${i}]`, ['min', 'color']); return { min: num(r.min, `bins[${i}].min`, 0, 1e9), color: hex(r.color, `bins[${i}].color`) }; });
      }
      if (has(q, 'fan')) {
        if (!isObj(q.fan)) fail('fan must be {padKey: true | false}: pad keys look like "pad:077+078".');
        Object.entries(q.fan).forEach(([k, v]) => { if (!/^pad:/.test(k)) fail(`fan keys are pad keys such as "pad:077+078", not "${k}".`); bool(v, `fan["${k}"]`); });
        p.fan = { ...(cur.fan || {}), ...q.fan };
      }
      if (has(q, 'legend')) p.legend = bool(q.legend, 'legend');
      return planChange(p);
    },
    setResultsCard(o) {
      const q = opts(o, 'setResultsCard', ['show', 'title', 'date', 'isNew']), cur = plan(), p = {};
      if (has(q, 'show')) p.show = { ...(cur.show || {}), card: bool(q.show, 'show') };
      if (has(q, 'title') || has(q, 'date') || has(q, 'isNew')) {
        p.release = { ...(cur.release || {}) };
        if (has(q, 'title')) p.release.title = text(q.title, 'title', 120);
        if (has(q, 'date')) p.release.date = q.date === null ? undefined : text(q.date, 'date', 40);
        if (has(q, 'isNew')) p.release.isNew = bool(q.isNew, 'isNew');
      }
      return planChange(p);
    },
    setIntervalTags(o) {
      const q = opts(o, 'setIntervalTags', ['show', 'padTag', 'headings']), cur = plan(), p = {};
      if (has(q, 'show') || has(q, 'padTag')) {
        p.show = { ...(cur.show || {}) };
        if (has(q, 'show')) p.show.tags = bool(q.show, 'show');
        if (has(q, 'padTag')) p.show.padTag = bool(q.padTag, 'padTag');
      }
      if (has(q, 'headings')) {
        if (!isObj(q.headings)) fail('headings must be {resultId: text}: result ids from getState().drillPlan.results.');
        const ids = (cur.results || []).map((r) => String(r.resultId));
        Object.entries(q.headings).forEach(([k, v]) => { if (!ids.includes(k)) fail(`No published result "${k}". Results: ${ids.join(', ') || 'none'}.`); text(v, `headings["${k}"]`, 80); });
        p.headings = { ...(cur.headings || {}), ...q.headings };
      }
      return planChange(p);
    },
    setHighlightCard(o) {
      const cur = plan();
      if (o === null) return planChange({ highlight: null });
      const q = opts(o, 'setHighlightCard', ['at', 'heading', 'sub', 'main', 'second']);
      const h = { heading: 'Discovery', sub: '', main: '', second: '', ...(cur.highlight || {}) };
      if (has(q, 'at')) {
        if (typeof q.at === 'string') {
          const hole = (cur.holes || []).find((x) => String(x.id).toLowerCase() === q.at.toLowerCase()) || fail(`No hole "${q.at}" in the plan. Holes: ${(cur.holes || []).map((x) => x.id).join(', ')}.`);
          h.at = { lat: hole.lat, lng: hole.lng };
        } else h.at = latLng(q.at, 'at');
      } else if (!h.at) h.at = { lat: cur.holes[0].lat, lng: cur.holes[0].lng };
      ['heading', 'sub', 'main', 'second'].forEach((k) => { if (has(q, k)) h[k] = text(q[k], k, 120); });
      return planChange({ highlight: h });
    },
    async fitDrillPlan() {
      const p = plan(), map = mapOf();
      const { fitPlan } = await import('../utils/drillPlan.js');
      return move(() => fitPlan(map, p, B().zones, layout()));
    },
    removeDrillPlan() { plan(); return change((b) => { b.replaceDrillPlan(null); }); },

    // ── Export ──
    exportPNG: (o = {}) => exportAs('png', o, 'exportPNG'),
    exportSVG: (o = {}) => exportAs('svg', o, 'exportSVG'),
    exportPDF: (o = {}) => exportAs('pdf', o, 'exportPDF'),
    exportLayers: (o = {}) => exportAs('layers', o, 'exportLayers'),
    setExport(o) {
      const q = opts(o, 'setExport', ['band', 'bandClient', 'pixelRatio', 'filename', 'layersSvg']), es = {};
      if (has(q, 'band')) es.band = bool(q.band, 'band');
      if (has(q, 'bandClient')) es.bandClient = text(q.bandClient, 'bandClient', 120);
      if (has(q, 'pixelRatio')) es.pixelRatio = num(q.pixelRatio, 'pixelRatio', 1, 4);
      if (has(q, 'filename')) es.filename = text(q.filename, 'filename', 120).replace(/[\\/:*?"<>|]+/g, '-');
      if (has(q, 'layersSvg')) es.layersSvg = bool(q.layersSvg, 'layersSvg');
      return setLayout({ exportSettings: es });
    },

    // ── Project ──
    save: () => saved((b) => b.save()),
    saveAs(name) {
      const n = text(name, 'name', 200).trim() || fail('saveAs needs a name, e.g. EMAP.saveAs("Rabbit North Fig 1").');
      return saved((b) => b.saveAs(n));
    },
    duplicate: () => saved((b) => b.duplicate()),
    listProjects: projects,
    openProject(ref, o) {
      guard(o, 'openProject');
      const list = B().recentProjects || [];
      const byId = list.find((p) => p.id === ref), byName = list.filter((p) => p.name === ref);
      if (!byId && byName.length > 1) fail(`More than one saved map is named "${ref}": use its id (${byName.map((p) => p.id).join(', ')}).`);
      const entry = byId || byName[0] || fail(`No saved map "${ref}". Saved maps: ${list.map((p) => `${p.id} (${p.name})`).join(', ') || 'none'}.`);
      return saved((b) => b.open(entry));
    },
    newMap(o) { guard(o, 'newMap'); return change((b) => { b.newMap(); }); },
    loadProject(project, o) {
      const q = guard(o, 'loadProject');
      if (!isObj(project) || !Array.isArray(project.layers) || !isObj(project.layout)) fail('loadProject expects a project from EMAP.getProject() ({ layers: [...], layout: {...}, ... }).');
      const name = has(q, 'name') ? text(q.name, 'name', 200) : String(project.layout.title || 'Untitled map');
      return saved((b) => b.open({ id: null, name, payload: clone(project) }));
    },
  };

  function callout(id) {
    const list = B().project.callouts || [];
    return list.find((c) => c.id === id) || fail(`No callout "${id}". Callouts: ${list.map((c) => `${c.id} (${String(c.text).slice(0, 24)})`).join(', ') || 'none'}.`);
  }
  function marker(id, isLabel) {
    const list = (B().project.markers || []).filter((m) => (m.type === 'maplabel') === isLabel);
    return list.find((m) => m.id === id) || fail(`No ${isLabel ? 'map label' : 'marker'} "${id}". ${isLabel ? 'Map labels' : 'Markers'}: ${list.map((m) => m.id).join(', ') || 'none'}.`);
  }

  // Whatever returns a Promise reports a bad argument by rejecting it, never by throwing first, so
  // EMAP.setTitle(x).catch(…) and await both see it. help, getState, getView, getProject, listLayers and
  // listProjects answer at once, and throw.
  const SYNC = ['help', 'getState', 'getProject', 'getView', 'listLayers', 'listProjects'];
  for (const [k, fn] of Object.entries(api)) {
    if (typeof fn !== 'function' || SYNC.includes(k)) continue;
    api[k] = (...args) => { try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); } };
  }
  return api;
}

/** Installs window.EMAP over App's bridge and announces it ("emap:ready"). */
export function install(getBridge) {
  if (window.EMAP) return window.EMAP;
  const api = Object.freeze(createApi(getBridge, window));
  Object.defineProperty(window, 'EMAP', { value: api, configurable: true, writable: false });
  window.dispatchEvent(new CustomEvent('emap:ready'));
  return api;
}
