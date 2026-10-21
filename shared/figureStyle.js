// The figure style: a company's look, shared by its 2D maps and 3D figures. Colours, type roles, the logo,
// panel treatment, spacing and the source note, versioned so a later shape can still read this one.
//
// Appearance only. Grade bins, geophysics units and geology categories are data styling: they belong to
// the dataset and never live here, so applying a brand cannot recolour a result or a rock.
//
// Every leaf is either a valid value or null. Null means "the figure's own": an adapter writes nothing
// for it, so a partial style never resets a setting it does not name. Pure, so the editor, /3d and the
// MCP connector read a style the same way.

export const FIGURE_STYLE_VERSION = 1;
export const STYLE_COLOURS = ['primary', 'accent', 'ink', 'muted', 'panel', 'panelBorder'];
export const STYLE_TYPE_ROLES = ['title', 'subtitle', 'label', 'note'];
// Families a style may name: Google fonts /3d can load. The 2D editor uses the ones it offers (EDITOR_FONTS
// in brandKit.js); another family leaves that figure's font as it is.
export const STYLE_FONTS = ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Source Sans 3', 'IBM Plex Mono', 'Poppins', 'Barlow', 'Barlow Semi Condensed'];
export const LOGO_PLACEMENTS = ['tl', 'tr', 'bl', 'br'];
export const PANEL_SHADOWS = ['none', 'soft'];
export const SOURCE_NOTE_POSITIONS = ['footer', 'bl', 'br'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export function normHex(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  return /^#[0-9a-f]{3}$/.test(t) ? `#${[...t.slice(1)].map((c) => c + c).join('')}` : null;
}
// A logo by reference: an image data URL (the kit's own copy) or an https address. Nothing that runs.
export function normAssetRef(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(t) || /^https:\/\/[^\s"'<>]+$/i.test(t) ? t : null;
}

// Each field: [read, what it must be]. read gives the value or null when it is invalid.
const range = (lo, hi, unit) => [(v) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null), `${lo}-${hi}${unit}`];
const oneOf = (list) => [(v) => (list.includes(v) ? v : null), `one of ${list.join(', ')}`];
const HEX = [normHex, 'a hex colour like #0c1a35'];
// Type sizes are scales of the figure's own size for that role; radius, padding and gap are px at 1x; the
// outer margin is a percentage of the figure's width (the atlas keeps furniture 2.5-3.5% in).
const ROLE = {
  family: oneOf(STYLE_FONTS),
  weight: [(v) => (Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0 ? v : null), 'a font weight from 100 to 900 in hundreds'],
  size: range(0.5, 3, " (a scale of the figure's own size)"),
};
const SCHEMA = {
  colours: Object.fromEntries(STYLE_COLOURS.map((k) => [k, HEX])),
  type: Object.fromEntries(STYLE_TYPE_ROLES.map((r) => [r, ROLE])),
  logo: { assetRef: [normAssetRef, 'an image data URL or an https address'], placement: oneOf(LOGO_PLACEMENTS) },
  panel: { radius: range(0, 24, ' px'), padding: range(0, 48, ' px'), shadow: oneOf(PANEL_SHADOWS) },
  spacing: { margin: range(0, 10, ' (% of the figure width)'), gap: range(0, 48, ' px') },
  sourceNote: {
    position: oneOf(SOURCE_NOTE_POSITIONS),
    italic: [(v) => (typeof v === 'boolean' ? v : null), 'true or false'],
    prefix: [(v) => (typeof v === 'string' && v.trim().length <= 24 ? v.trim() : null), 'text of 24 characters or fewer'],
  },
};
// A missing field is null without an error; a present invalid one is null and reported.
function read(schema, src, path, errors) {
  if (src !== undefined && src !== null && !isObj(src)) errors.push(`${path || 'style'} must be an object.`);
  const o = isObj(src) ? src : {};
  return Object.fromEntries(Object.entries(schema).map(([k, spec]) => {
    const at = path ? `${path}.${k}` : k, v = o[k];
    if (!Array.isArray(spec)) return [k, read(spec, v, at, errors)];
    const out = v === undefined || v === null ? null : spec[0](v);
    if (out === null && v !== undefined && v !== null) errors.push(`${at} must be ${spec[1]}.`);
    return [k, out];
  }));
}

// Reads any input into the full version-1 shape, with every problem listed. Never throws.
export function validateFigureStyle(input) {
  const errors = [], version = isObj(input) ? input.version ?? FIGURE_STYLE_VERSION : FIGURE_STYLE_VERSION;
  if (!Number.isInteger(version) || version < 1) errors.push('version must be a positive whole number.');
  else if (version > FIGURE_STYLE_VERSION) errors.push(`version ${version} is newer than this app reads (${FIGURE_STYLE_VERSION}); its known fields are used.`);
  const style = { version: FIGURE_STYLE_VERSION, ...read(SCHEMA, input, '', errors) };
  return { ok: errors.length === 0, errors, style };
}

// The usable style: invalid fields dropped to null (the figure's own), never an error.
export const normaliseFigureStyle = (input) => validateFigureStyle(input).style;

// Whether a style sets anything at all.
export function isEmptyFigureStyle(style) {
  const leaves = (o) => Object.values(o).flatMap((v) => (isObj(v) ? leaves(v) : [v]));
  const s = normaliseFigureStyle(style);
  delete s.version;
  return leaves(s).every((v) => v === null);
}

// What a figure records of the style it was given. An inline logo is not copied a second time: the figure
// already holds it (the 2D layout's logo, the 3D figure's), so the snapshot names that copy.
export function styleSnapshot(style) {
  const s = normaliseFigureStyle(style);
  if (s.logo.assetRef?.startsWith('data:')) s.logo.assetRef = 'figure:logo';
  return s;
}
