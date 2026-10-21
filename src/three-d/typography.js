// A figure's brand style in /3d (EXT hook "type" in studio.js): the controlled typography adapter, and
// EM3D.setFigureStyle, which applies a shared figure style (shared/figureStyle.js) through to3DSettings.
// Loaded when a figure has a brand style (S.brandStyle) or one is applied, so a figure without one never
// fetches it and keeps the Source Sans 3 and IBM Plex Mono it was drawn with.
//
// A new family takes effect only once its faces have loaded: until then, and if they never arrive, the
// figure stays in its earlier fonts. So labels, wall text and exports are never measured or drawn in a
// fallback face that a moment later becomes another.
import { STYLE_FONTS, validateFigureStyle } from '../../shared/figureStyle.js';
import { to3DSettings, brandStyleRecord } from '../../shared/brandKit.js';

let H = null; // host (studio.js), set by init
export function init(host) { H = host; }

export const LEGACY = { sans: '"Source Sans 3", "Segoe UI", sans-serif', mono: '"IBM Plex Mono", monospace' };
const PAGE_FONTS = ['Source Sans 3', 'IBM Plex Mono']; // linked by 3d/index.html already
// Google Fonts refuses a request naming a weight a family lacks: these two have no 600.
const WEIGHTS = { Lato: '400;700', Roboto: '400;500;700' };
export const stackOf = (family) => (family === 'Source Sans 3' ? LEGACY.sans : `"${family}", "Segoe UI", sans-serif`);
export const fontCssUrl = (family) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${WEIGHTS[family] || '400;600;700'}&display=swap`;

const timeout = (ms, v) => new Promise((r) => { setTimeout(() => r(v), ms); });
// Loads the regular and bold faces of one allowed family. Bounded: a font host that never answers gives
// false, and the caller keeps the figure's earlier fonts.
export async function loadFamily(family, { doc = globalThis.document, ms = 5000 } = {}) {
  if (!STYLE_FONTS.includes(family) || !doc?.fonts?.load) return false;
  const id = `em3d-font-${family.replace(/\W+/g, '-').toLowerCase()}`;
  if (!PAGE_FONTS.includes(family) && !doc.getElementById(id)) {
    const link = Object.assign(doc.createElement('link'), { id, rel: 'stylesheet', href: fontCssUrl(family) });
    const ready = new Promise((r) => { link.onload = () => r(true); link.onerror = () => r(false); });
    doc.head.appendChild(link);
    if (!(await Promise.race([ready, timeout(ms, false)]))) return false;
  }
  const faces = Promise.all([400, 700].map((w) => doc.fonts.load(`${w} 16px "${family}"`))).then((f) => f.every((x) => x.length > 0), () => false);
  return Promise.race([faces, timeout(ms, false)]);
}

// The figure's fonts from S.brandStyle, once loaded. Called when a figure settles (opened, undo/redo)
// and after a style is applied. The latest call wins.
let seq = 0;
export async function sync() {
  const t = ++seq, family = H.S.brandStyle?.fonts?.sans || null;
  let sans = LEGACY.sans;
  if (family && family !== 'Source Sans 3') {
    if (await loadFamily(family)) sans = stackOf(family);
    else H.status(`The ${family} font could not be loaded, so this figure stays in Source Sans 3.`);
  }
  if (t !== seq || H.fonts() === sans) return;
  H.fonts(sans); H.buildWallLabels(); H.redraw();
}

// EM3D.setFigureStyle(style, { brandKitId, brandRevision }): a figure style's colours, logo and fonts
// on this figure, recorded in S.brandStyle with the kit and revision it came from. null removes the
// record and returns the text to the default fonts (colours and logo stay as they are). Grade, geology
// and geophysics colours are data styling and never change here.
export async function setFigureStyle(style, meta = {}) {
  if (style === null) { H.S.brandStyle = null; await sync(); return; }
  const { errors } = validateFigureStyle(style);
  if (errors.length) throw new Error(`setFigureStyle: ${errors.join(' ')}`);
  const s = to3DSettings(style), EM = globalThis.EM3D;
  if (s.primary || s.accent) EM.setBrand({ ...(s.primary && { primary: s.primary }), ...(s.accent && { accent: s.accent }) });
  if (s.logo?.startsWith('data:')) await EM.setLogo(s.logo, { autoColor: false }); // an https logo would taint the export canvas
  H.S.brandStyle = { ...brandStyleRecord({ id: meta.brandKitId, updated_at: meta.brandRevision }, 'style', style), fonts: s.fonts || null };
  await sync();
  H.redraw();
}
