// Studio: the /3d figure look on a 2D map (opt-in, themeId 'studio'). Rounded cards with a soft shadow, a brand
// accent bar, dark or light paper per card, one sans in four weights (300/600/650/800) with mono numerals, a
// title card with a caps kicker, a scale bar beside its north arrow, a dark locator card and haloed labels.
//
// Each card is laid out here once, as primitives (rect, path, text, line, circle, polygon, image and a
// "slot" the host fills; the drill plan adds open polylines, rotated text and a circle's fill opacity), in
// composition px. The PNG exporter paints them on its canvas (paintCanvas), the
// SVG exporter writes them as markup (paintSvg) and the editor stage draws them as React SVG
// (components/StudioCard.jsx), so the three cannot disagree about where anything sits. Text is measured with
// one canvas context in all three.
//
// Loaded only by the export renderer and the lazy Studio editor parts; the sizes the layout needs are in
// studioLayout.js, which this reads.
import { northArrowShapes, NORTH_ARROW_FONT } from './northArrowGeometry.js';
import { SCALE_STEPS, formatScaleLength, formatScaleHalf } from './scaleBar.js';
import { haversineMeters } from './coordinateFrame.js';
import { escapeXml } from './svg.js';
import { studioOn, studioPad, studioKicker, studioInfo, studioScaleHome, studioTitleRows, STUDIO_SCALE_ROW } from './studioLayout.js';

export { studioOn, studioScaleHome };

export const STUDIO = { ink: '#142126', muted: '#5f6e72', paper: '#ffffff', dark: '#14262e', accent: '#c65322', marker: '#e5483b' };
export const STUDIO_MONO = 'IBM Plex Mono';
export const STUDIO_SHADOW = { color: 'rgba(16,24,32,0.2)', blur: 14, dy: 4 };
// The brand weights Studio sets type in, light to heavy.
export const STUDIO_WEIGHTS = [300, 400, 600, 650, 700, 800];

// Every card kind with its look by default. A map overrides any of these per card in layout.studio.cards.
const CARD_DEFAULTS = {
  title: { tone: 'light', accent: 'left' },
  legend: { tone: 'light', accent: 'none' },
  inset: { tone: 'dark', accent: 'none' },
  scale: { tone: 'light', accent: 'none' },
  callout: { tone: 'light', accent: 'left' },
};
export const STUDIO_CARD_KINDS = Object.keys(CARD_DEFAULTS);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hex6 = (v) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(t)) return t;
  return /^#[0-9a-f]{3}$/i.test(t) ? `#${[...t.slice(1)].map((c) => c + c).join('')}` : null;
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const textOn = (hex) => (lum(hex) > 0.45 ? STUDIO.ink : '#ffffff');

// The brand's colours as Studio uses them: the accent for kickers, bars and pills; the primary (the title
// block colour) for titles on light cards and as the dark cards' paper when it is dark; ink and paper.
export function studioPalette(layout = {}) {
  const ink = hex6(layout.panelFgColor) || STUDIO.ink, primary = hex6(layout.titleBgColor);
  return {
    accent: hex6(layout.accentColor) || STUDIO.accent,
    ink,
    primary: primary || ink,
    paper: hex6(layout.panelBgColor) || STUDIO.paper,
    dark: primary && lum(primary) < 0.2 ? primary : STUDIO.dark,
  };
}

// One card's resolved look. Radius and shadow default to the brand's figure style (shared/figureStyle.js
// panel, recorded when a kit is applied), else 8 px and soft.
export function studioCard(layout = {}, kind = 'title') {
  const pal = studioPalette(layout), fs = layout.brandStyle?.style?.panel || {};
  const o = { ...CARD_DEFAULTS[kind], ...(layout.studio?.cards?.[kind] || {}) };
  // "Title box" and "Legend box" off leave the text on the map, as in every theme.
  const bare = (kind === 'title' && layout.titleTransparent) || (kind === 'legend' && layout.legendTransparent);
  const dark = o.tone === 'dark', opacity = bare ? 0 : clamp(num(o.opacity) ?? 0.96, 0, 1);
  return {
    kind,
    tone: dark ? 'dark' : 'light',
    accent: !bare && ['left', 'top'].includes(o.accent) ? o.accent : 'none',
    radius: clamp(num(o.radius) ?? fs.radius ?? 8, 0, 24),
    opacity,
    shadow: opacity > 0 && (typeof o.shadow === 'boolean' ? o.shadow : fs.shadow !== 'none'),
    pad: studioPad(layout),
    fill: dark ? pal.dark : pal.paper,
    edge: dark ? null : 'rgba(20,33,38,0.12)',
    ink: dark ? '#ffffff' : pal.ink,
    muted: dark ? 'rgba(255,255,255,0.74)' : STUDIO.muted,
    rule: dark ? 'rgba(255,255,255,0.22)' : 'rgba(20,33,38,0.16)',
    head: dark ? '#ffffff' : pal.primary,
    accentColor: pal.accent,
  };
}

// The outline drawn round map labels and callout text: layout.labelHalo, on by default in Studio only.
export function labelHalo(layout = {}) {
  const h = layout.labelHalo;
  if (h === false || h?.enabled === false || (!h && layout.themeId !== 'studio')) return null;
  return { color: hex6(h?.color) || '#ffffff', width: clamp(num(h?.width) ?? 3, 0, 12), opacity: clamp(num(h?.opacity) ?? 0.9, 0, 1) };
}

// Type: the brand kit's families (layout.fonts) and its weights (the figure style's type roles), and
// IBM Plex Mono for numerals.
const fam = (f) => `'${String(f || 'Inter').replace(/['"\\]/g, '')}', Arial, sans-serif`;
const weightOf = (layout, role, def) => layout.brandStyle?.style?.type?.[role]?.weight ?? def;
export function studioFontFamilies(layout = {}) {
  const f = layout.fonts || {};
  return [...new Set(['Inter', f.title, f.legend, f.label, f.callout, f.footer, STUDIO_MONO].filter(Boolean))];
}
// The Google Fonts query for one family with every Studio weight: a variable family serves 300 to 800 from
// one file; Lato is static, and IBM Plex Mono is used at two weights.
export function studioFontQuery(family) {
  const w = family === STUDIO_MONO ? '400;600' : family === 'Lato' ? '300;400;700;900' : '300..800';
  return `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${w}`;
}

// Those stylesheets on the page (once each): the editor's own loads its usual weights only. Resolves when
// they have loaded or failed.
export function loadStudioFonts(layout, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.head) return Promise.resolve();
  return Promise.all(studioFontFamilies(layout).map((f) => {
    let el = [...doc.querySelectorAll('link[data-studio-font]')].find((l) => l.dataset.studioFont === f);
    if (!el) {
      el = doc.createElement('link');
      el.rel = 'stylesheet'; el.href = `https://fonts.googleapis.com/css2?${studioFontQuery(f)}&display=swap`; el.dataset.studioFont = f;
      doc.head.append(el);
    }
    return el.sheet ? null : new Promise((r) => { el.addEventListener('load', r, { once: true }); el.addEventListener('error', r, { once: true }); setTimeout(r, 4000); });
  }));
}

// Text measured with one canvas context (the editor's and the exporters' fonts are the same document's);
// estimated where there is no canvas (tests, workers).
let measureCtx;
export function measureText(s, size, weight = 400, family = 'Inter', ls = 0, css = null) {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { measureCtx = null; }
  }
  const t = String(s ?? '');
  if (!measureCtx?.measureText) return t.length * size * 0.56 + ls * t.length;
  measureCtx.font = `${weight} ${size}px ${css || fam(family)}`;
  return measureCtx.measureText(t).width + ls * t.length;
}
function fitTo(s, maxW, size, weight, family, ls = 0) {
  let t = String(s ?? '');
  if (measureText(t, size, weight, family, ls) <= maxW) return t;
  while (t.length > 1 && measureText(`${t}…`, size, weight, family, ls) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
const text = (x, y, s, size, weight, family, fill, o = {}) => ({ t: 'text', x, y, s, size, weight, family, fill, anchor: 'start', ls: 0, ...o });

// A bar along one edge of a rounded card, clipped to its corners, as a path.
function barPath(x, y, w, h, r, side) {
  const b = side === 'left' ? 5 : 4, rr = Math.min(r, w / 2, h / 2);
  if (side === 'top') {
    if (rr <= b) return `M${x},${y + b}L${x},${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}L${x + w - rr},${y}A${rr},${rr} 0 0 1 ${x + w},${y + rr}L${x + w},${y + b}Z`;
    const d = rr - Math.sqrt(rr * rr - (rr - b) ** 2);
    return `M${x + d},${y + b}A${rr},${rr} 0 0 1 ${x + rr},${y}L${x + w - rr},${y}A${rr},${rr} 0 0 1 ${x + w - d},${y + b}Z`;
  }
  if (rr <= b) return `M${x + b},${y}L${x + rr},${y}A${rr},${rr} 0 0 0 ${x},${y + rr}L${x},${y + h - rr}A${rr},${rr} 0 0 0 ${x + rr},${y + h}L${x + b},${y + h}Z`;
  const d = rr - Math.sqrt(rr * rr - (rr - b) ** 2);
  return `M${x + b},${y + d}A${rr},${rr} 0 0 0 ${x},${y + rr}L${x},${y + h - rr}A${rr},${rr} 0 0 0 ${x + b},${y + h - d}Z`;
}

// The card itself: paper, edge, shadow and accent bar.
export function cardShell(c, x, y, w, h) {
  const out = [];
  if (c.opacity > 0) out.push({ t: 'rect', x, y, w, h, r: c.radius, fill: c.fill, opacity: c.opacity, stroke: c.edge, sw: 1, shadow: c.shadow });
  if (c.accent !== 'none') out.push({ t: 'path', d: barPath(x, y, w, h, c.radius, c.accent), fill: c.accentColor });
  return out;
}

// The north arrow's own geometry (northArrowGeometry.js) in a card's colours. Studio draws the classic
// choice as its designed rose.
export const studioNorthStyle = (layout = {}) => { const s = layout.northArrowStyle || 'classic'; return s === 'classic' ? 'rose' : s; };
function northPrims(layout, c, x, y, w, h) {
  const paint = (k) => (k === 'bg' ? c.fill : c.ink);
  return northArrowShapes(studioNorthStyle(layout), w, h).map((s) => {
    if (s.kind === 'polygon') return { t: 'poly', pts: s.points.map(([px, py]) => [x + px, y + py]), fill: s.fill && paint(s.fill), opacity: s.opacity ?? 1, stroke: s.stroke && paint(s.stroke), sw: s.strokeWidth };
    if (s.kind === 'circle') return { t: 'circle', cx: x + s.cx, cy: y + s.cy, r: s.r, fill: s.fill && paint(s.fill), stroke: s.stroke && paint(s.stroke), sw: s.strokeWidth, opacity: s.opacity ?? 1 };
    if (s.kind === 'line') return { t: 'line', x1: x + s.x1, y1: y + s.y1, x2: x + s.x2, y2: y + s.y2, stroke: paint(s.stroke), sw: s.strokeWidth, opacity: s.opacity ?? 1 };
    return text(x + s.x, y + s.y, s.value, s.size, s.weight, null, c.ink, { anchor: s.anchor, css: NORTH_ARROW_FONT });
  });
}

// Metres per composition px across the map's middle, as the scale bar picker measures it (scaleBar.js).
export function studioMetresPerPx(map) {
  try {
    const size = map.getSize(), cy = size.y / 2, a = map.containerPointToLatLng([0, cy]), b = map.containerPointToLatLng([200, cy]);
    return (typeof a.distanceTo === 'function' ? a.distanceTo(b) : haversineMeters(a.lat, a.lng, b.lat, b.lng)) / 200;
  } catch { return null; }
}
// The longest round length whose bar fits maxPx, drawn at its true length: down to half a metre for a close
// zoom, and none (no bar) when not even that fits, so a bar never runs into the north arrow.
const STEPS = [0.5, 1, 2, 5, ...SCALE_STEPS];
export function scaleStep(mpp, maxPx) {
  if (!(mpp > 0) || !(maxPx > 0)) return null;
  const metres = STEPS.filter((n) => n / mpp <= maxPx).at(-1);
  return metres ? { metres, px: metres / mpp, label: formatScaleLength(metres), half: formatScaleHalf(metres) } : null;
}

// A four-part bar, alternating ink and paper, with 0 / middle / end in mono under it.
function barPrims(c, x, y, step) {
  const out = [], seg = step.px / 4, h = 5;
  for (let i = 0; i < 4; i += 1) out.push({ t: 'rect', x: x + i * seg, y, w: seg, h, fill: i % 2 ? c.fill : c.ink, opacity: 1 });
  out.push({ t: 'rect', x, y, w: step.px, h, stroke: c.ink, sw: 1 });
  const ly = y + h + 11;
  out.push(text(x, ly, '0', 9.5, 400, STUDIO_MONO, c.ink));
  out.push(text(x + step.px / 2, ly, step.half, 9.5, 400, STUDIO_MONO, c.ink, { anchor: 'middle' }));
  out.push(text(x + step.px, ly, step.label, 9.5, 400, STUDIO_MONO, c.ink, { anchor: 'end' }));
  return out;
}

// The scale and north row inside box r: the north arrow (north: its height, which may reach into the card's
// padding) at the right, vertically centred; the bar at the left with the datum note above it (stacked, the
// scale card) or beside it (the title card's row).
function scaleRow(layout, c, r, opts, { stacked, north, scale }) {
  const out = [];
  let right = r.x + r.w;
  if (north) {
    const nh = north, nw = nh * 0.9;
    out.push(...northPrims(layout, c, right - nw, r.y + (r.h - nh) / 2, nw, nh));
    right -= nw + 12;
  }
  if (!scale) return out;
  const datum = String(layout.studio?.datumNote ?? opts.datum ?? '').toUpperCase(), sub = String(layout.studio?.datumSub || '');
  const room = right - r.x;
  if (stacked) {
    const barY = r.y + (datum ? 17 : (r.h - 21) / 2);
    if (datum) out.push(text(r.x, r.y + 8, fitTo(datum, room, 8.5, 650, layout.fonts?.legend, 0.6), 8.5, 650, layout.fonts?.legend, c.ink, { ls: 0.6 }));
    const step = scaleStep(opts.metresPerPx, room - 14);
    if (step) out.push(...barPrims(c, r.x, barY, step));
    return out;
  }
  const step = scaleStep(opts.metresPerPx, Math.min(170, room * 0.5));
  const barY = r.y + r.h / 2 - 9;
  if (step) out.push(...barPrims(c, r.x, barY, step));
  const nx = r.x + (step ? step.px + 26 : 0), nRoom = right - nx;
  if (datum && nRoom > 40) {
    const two = sub ? 7 : 0;
    out.push(text(nx, r.y + r.h / 2 + 3 - two, fitTo(datum, nRoom, 8.5, 650, layout.fonts?.legend, 0.6), 8.5, 650, layout.fonts?.legend, c.ink, { ls: 0.6 }));
    if (sub) out.push(text(nx, r.y + r.h / 2 + 3 + two, fitTo(sub, nRoom, 9, 400, layout.fonts?.legend), 9, 400, layout.fonts?.legend, c.muted));
  }
  return out;
}

// The title card: caps kicker in the accent, the title (shrunk to fit its width, never wrapped), subtitle,
// muted info line, and (studio.titleScale) a rule over the scale and north row.
export function titleCardPrims(layout, box, opts = {}) {
  const c = studioCard(layout, 'title'), tf = layout.fonts?.title || 'Inter';
  const x0 = box.x + c.pad + (c.accent === 'left' ? 9 : 0), maxW = box.x + box.w - c.pad - x0;
  const out = cardShell(c, box.x, box.y, box.w, box.h);
  for (const r of studioTitleRows(layout).rows) {
    const top = box.y + r.top;
    if (r.kind === 'kicker') {
      const ls = r.size * 0.12;
      out.push(text(x0, top + r.size * 0.8, fitTo(studioKicker(layout), maxW, r.size, 650, tf, ls), r.size, 650, tf, c.accentColor, { ls, role: 'kicker' }));
    } else if (r.kind === 'title') {
      const w = weightOf(layout, 'title', 800), t = layout.title || 'Project Map';
      let size = r.size;
      while (size > 15 && measureText(t, size, w, tf) > maxW) size -= 1;
      out.push(text(x0, top + r.size * 0.86, fitTo(t, maxW, size, w, tf), size, w, tf, c.head, { role: 'title' }));
    } else if (r.kind === 'subtitle') {
      const w = weightOf(layout, 'subtitle', 600);
      out.push(text(x0, top + r.size * 0.86, fitTo(layout.subtitle, maxW, r.size, w, tf), r.size, w, tf, c.head, { role: 'subtitle' }));
    } else if (r.kind === 'info') {
      const w = weightOf(layout, 'note', 300);
      out.push(text(x0, top + r.size * 0.86, fitTo(studioInfo(layout), maxW, r.size, w, tf), r.size, w, tf, c.muted, { role: 'info' }));
    } else if (r.kind === 'rule') {
      out.push({ t: 'line', x1: x0, y1: top, x2: x0 + maxW, y2: top, stroke: c.rule, sw: 1 });
    } else if (r.kind === 'scale') {
      out.push(...scaleRow(layout, c, { x: x0, y: top, w: maxW, h: STUDIO_SCALE_ROW }, opts, { north: layout.showNorthArrow !== false && STUDIO_SCALE_ROW + 8, scale: layout.showScaleBar !== false }));
    }
  }
  return out;
}

// The scale card: the bar with its datum note, and the north arrow beside it when they share the card,
// as tall as the card less 5 px top and bottom (its N included), so it reads at the bar's weight.
export function scaleCardPrims(layout, box, opts = {}) {
  const c = studioCard(layout, 'scale'), p = Math.min(c.pad, 12);
  return [...cardShell(c, box.x, box.y, box.w, box.h), ...scaleRow(layout, c, { x: box.x + p, y: box.y + p, w: box.w - 2 * p, h: box.h - 2 * p }, opts,
    { stacked: true, north: studioScaleHome(layout) === 'panel' && box.h - 10, scale: true })];
}

// The north arrow on its own card (when the scale bar is off, or kept apart).
export function northCardPrims(layout, box) {
  const c = studioCard(layout, 'scale'), p = Math.min(c.pad, 10), h = box.h - 2 * p, w = Math.min(box.w - 2 * p, h * 0.9);
  return [...cardShell(c, box.x, box.y, box.w, box.h), ...northPrims(layout, c, box.x + (box.w - w) / 2, box.y + p, w, h)];
}

// The locator card's picture area, below the heading row and above the caption.
export function insetArea(layout, box) {
  const p = Math.min(studioPad(layout), 12);
  return { x: box.x + p, y: box.y + p + 20, w: box.w - 2 * p, h: Math.max(10, box.h - 2 * p - 40) };
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
// The jurisdiction drawn to fit the area, and where the project's centre falls on it.
function regionPrims(region, bounds, a) {
  const [w0, s0, e0, n0] = region.bbox, pad = 0.06, dx = (e0 - w0) * pad, dy = (n0 - s0) * pad;
  const [w, s, e, n] = [w0 - dx, s0 - dy, e0 + dx, n0 + dy];
  const tw = ((e - w) * Math.PI) / 180, th = mercY(n) - mercY(s), k = Math.min((a.w - 12) / tw, (a.h - 12) / th);
  const ox = a.x + (a.w - tw * k) / 2, oy = a.y + (a.h - th * k) / 2;
  const at = (lng, lat) => [ox + ((lng - w) * Math.PI / 180) * k, oy + (mercY(n) - mercY(lat)) * k];
  const prims = (region.coordinates || []).filter((ring) => ring.length > 2).map((ring) => ({
    t: 'poly', pts: ring.map(([lng, lat]) => at(lng, lat)), fill: '#ffffff', opacity: 0.16, stroke: 'rgba(255,255,255,0.8)', sw: 0.9,
  }));
  const point = bounds ? at((bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2) : null;
  return { prims, point };
}

// The locator card: dark paper, a caps heading, an optional pill (the ticker), the picture — the satellite
// locator (a slot the host fills with the inset's own capture), the jurisdiction, or an uploaded image —
// with a ringed marker and the project's name on it, and a caption.
// opts: { mode: 'satellite'|'image'|'region'|null, image, region, bounds, marker: {x, y} in the area }.
export function insetCardPrims(layout, box, opts = {}) {
  const c = studioCard(layout, 'inset'), p = Math.min(c.pad, 12), s = layout.studio || {}, lf = layout.fonts?.legend || 'Inter';
  const out = cardShell(c, box.x, box.y, box.w, box.h), a = insetArea(layout, box), ar = Math.max(2, c.radius - 4);
  let headRoom = box.w - 2 * p;
  if (s.pill) {
    const t = String(s.pill).toUpperCase(), pw = measureText(t, 8.5, 700, lf, 0.4) + 14, px = box.x + box.w - p - pw;
    out.push({ t: 'rect', x: px, y: box.y + p - 1, w: pw, h: 15, r: 7.5, fill: c.accentColor, opacity: 1 });
    out.push(text(px + 7, box.y + p + 9.5, t, 8.5, 700, lf, textOn(c.accentColor), { ls: 0.4, role: 'pill' }));
    headRoom -= pw + 8;
  }
  const heading = String(layout.insetTitle || 'Project location').toUpperCase();
  out.push(text(box.x + p, box.y + p + 9, fitTo(heading, headRoom, 9.5, 650, lf, 1.1), 9.5, 650, lf, c.head, { ls: 1.1, role: 'heading' }));
  out.push({ t: 'rect', x: a.x, y: a.y, w: a.w, h: a.h, r: ar, fill: c.tone === 'dark' ? '#0b161b' : '#eef2f3', opacity: 1 });
  const region = opts.region?.bbox && opts.region?.coordinates?.length ? regionPrims(opts.region, opts.bounds, a) : null;
  let point = null;
  if (opts.mode === 'image' && opts.image) out.push({ t: 'image', href: opts.image, x: a.x, y: a.y, w: a.w, h: a.h, r: ar });
  else if (opts.mode === 'satellite') {
    out.push({ t: 'slot', name: 'satellite', x: a.x, y: a.y, w: a.w, h: a.h, r: ar, fallback: region?.prims || [] });
    point = opts.marker ? [a.x + opts.marker.x, a.y + opts.marker.y] : region?.point;
  } else if (region) { out.push(...region.prims); point = region.point; }
  if (point && opts.mode !== 'image') {
    const [mx, my] = [clamp(point[0], a.x + 6, a.x + a.w - 6), clamp(point[1], a.y + 6, a.y + a.h - 6)];
    out.push({ t: 'circle', cx: mx, cy: my, r: 10, stroke: 'rgba(255,255,255,0.6)', sw: 1.3 });
    out.push({ t: 'circle', cx: mx, cy: my, r: 4.6, fill: hex6(layout.insetMarkerColor) || STUDIO.marker, stroke: '#ffffff', sw: 1.6 });
    if (s.projectLabel) {
      const t = String(s.projectLabel).toUpperCase(), tw = measureText(t, 9, 700, lf, 0.6), left = mx - 14 - tw >= a.x + 2;
      out.push(text(left ? mx - 14 - tw : mx + 14, my + 3.2, t, 9, 700, lf, '#ffffff', { ls: 0.6, halo: { color: '#0b161b', width: 3, opacity: 0.7 }, role: 'project' }));
    }
  }
  const caption = layout.insetLabel || opts.region?.name || '';
  if (caption) out.push(text(box.x + p, box.y + box.h - p - 2, fitTo(caption, box.w - 2 * p, 10.5, 400, lf), 10.5, 400, lf, c.muted, { role: 'caption' }));
  return out;
}

// ── Painters ─────────────────────────────────────────────────────────────────────────────────────────
const fontCss = (p) => p.css || fam(p.family);
function rrect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
// Paints primitives on a canvas at the export scale. Synchronous unless a primitive is an image or a slot
// (opts.slot(p, ctx) draws it and resolves false when it could not, for the primitive's fallback).
export async function paintCanvas(ctx, prims, s, opts = {}) {
  for (const p of prims) {
    ctx.save();
    if (p.t === 'rect') {
      rrect(ctx, p.x * s, p.y * s, p.w * s, p.h * s, (p.r || 0) * s);
      if (p.fill) {
        if (p.shadow) { ctx.shadowColor = STUDIO_SHADOW.color; ctx.shadowBlur = STUDIO_SHADOW.blur * s; ctx.shadowOffsetY = STUDIO_SHADOW.dy * s; }
        ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = p.fill; ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1;
      }
      if (p.stroke) { ctx.lineWidth = (p.sw || 1) * s; ctx.strokeStyle = p.stroke; ctx.stroke(); }
    } else if (p.t === 'path') {
      ctx.scale(s, s); ctx.fillStyle = p.fill; ctx.fill(new Path2D(p.d));
    } else if (p.t === 'text') {
      if (p.rot) { ctx.translate(p.x * s, p.y * s); ctx.rotate((p.rot * Math.PI) / 180); ctx.translate(-p.x * s, -p.y * s); }
      ctx.font = `${p.weight} ${p.size * s}px ${fontCss(p)}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(p.ls || 0) * s}px`;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      if (p.halo) {
        ctx.globalAlpha = p.halo.opacity; ctx.strokeStyle = p.halo.color; ctx.lineWidth = p.halo.width * s; ctx.lineJoin = 'round';
        ctx.strokeText(p.s, p.x * s, p.y * s);
      }
      ctx.globalAlpha = p.opacity ?? 1; ctx.fillStyle = p.fill; ctx.fillText(p.s, p.x * s, p.y * s);
    } else if (p.t === 'line') {
      ctx.globalAlpha = p.opacity ?? 1; ctx.strokeStyle = p.stroke; ctx.lineWidth = (p.sw || 1) * s;
      ctx.beginPath(); ctx.moveTo(p.x1 * s, p.y1 * s); ctx.lineTo(p.x2 * s, p.y2 * s); ctx.stroke();
    } else if (p.t === 'pline') {
      ctx.globalAlpha = p.opacity ?? 1; ctx.strokeStyle = p.stroke; ctx.lineWidth = (p.sw || 1) * s;
      ctx.lineCap = p.cap || 'round'; ctx.lineJoin = 'round'; if (p.dash) ctx.setLineDash(p.dash.map((d) => d * s));
      ctx.beginPath(); p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s))); ctx.stroke();
    } else if (p.t === 'circle' || p.t === 'poly') {
      ctx.beginPath();
      if (p.t === 'circle') ctx.arc(p.cx * s, p.cy * s, p.r * s, 0, Math.PI * 2);
      else { p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s))); ctx.closePath(); }
      if (p.fill) { ctx.globalAlpha = p.t === 'poly' ? p.opacity ?? 1 : p.fo ?? 1; ctx.fillStyle = p.fill; ctx.fill(); }
      if (p.stroke) { ctx.globalAlpha = p.t === 'circle' ? p.opacity ?? 1 : 1; ctx.strokeStyle = p.stroke; ctx.lineWidth = (p.sw || 1) * s; ctx.lineJoin = 'round'; ctx.stroke(); }
    } else if (p.t === 'image') {
      const img = await opts.loadImage?.(p.href).catch(() => null);
      if (img) {
        rrect(ctx, p.x * s, p.y * s, p.w * s, p.h * s, (p.r || 0) * s); ctx.clip();
        const iw = img.naturalWidth || img.width || 1, ih = img.naturalHeight || img.height || 1, k = Math.max(p.w / iw, p.h / ih);
        ctx.drawImage(img, (p.x + (p.w - iw * k) / 2) * s, (p.y + (p.h - ih * k) / 2) * s, iw * k * s, ih * k * s);
      } else opts.onMissing?.(p);
    } else if (p.t === 'slot') {
      ctx.restore();
      const ok = opts.slot ? await opts.slot(p, ctx) : false;
      if (!ok && p.fallback?.length) await paintCanvas(ctx, p.fallback, s, opts);
      continue;
    }
    ctx.restore();
  }
}

// An rgba() colour as an SVG paint and its opacity (rgba() is not SVG 1.1, and Illustrator ignores it).
function svgPaint(attr, color, alpha = 1) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(String(color));
  const hex = m ? `#${[m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('')}` : escapeXml(color);
  const a = (m && m[4] != null ? +m[4] : 1) * alpha;
  return ` ${attr}="${hex}"${a < 1 ? ` ${attr}-opacity="${+a.toFixed(3)}"` : ''}`;
}
const f2 = (v) => +v.toFixed(2);
// The same primitives as SVG markup at the export scale. Shared definitions (the shadow filter, clip paths)
// go into defs; opts.slot(p) returns the markup for a slot, or '' to fall back.
export function paintSvg(prims, s, defs = [], opts = {}) {
  const shadowId = 'em-studio-shadow';
  return prims.map((p) => {
    if (p.t === 'rect') {
      let filter = '';
      if (p.shadow && p.fill) {
        if (!defs.some((d) => d.includes(`id="${shadowId}"`))) defs.push(`<filter id="${shadowId}" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="${f2(STUDIO_SHADOW.dy * s)}" stdDeviation="${f2(STUDIO_SHADOW.blur * s / 2)}" flood-color="#101820" flood-opacity="0.2" /></filter>`);
        filter = ` filter="url(#${shadowId})"`;
      }
      const fill = p.fill ? svgPaint('fill', p.fill, p.opacity ?? 1) : ' fill="none"';
      const stroke = p.stroke ? `${svgPaint('stroke', p.stroke)} stroke-width="${f2((p.sw || 1) * s)}"` : '';
      return `<rect x="${f2(p.x * s)}" y="${f2(p.y * s)}" width="${f2(p.w * s)}" height="${f2(p.h * s)}"${p.r ? ` rx="${f2(p.r * s)}"` : ''}${fill}${stroke}${filter} />`;
    }
    if (p.t === 'path') return `<path d="${escapeXml(p.d)}"${svgPaint('fill', p.fill)} transform="scale(${s})" />`;
    if (p.t === 'text') {
      const halo = p.halo ? `${svgPaint('stroke', p.halo.color, p.halo.opacity)} stroke-width="${f2(p.halo.width * s)}" stroke-linejoin="round" paint-order="stroke"` : '';
      const anchor = p.anchor && p.anchor !== 'start' ? ` text-anchor="${p.anchor}"` : '';
      const ls = p.ls ? ` letter-spacing="${f2(p.ls * s)}"` : '';
      const cls = p.role ? ` class="em-studio-${p.role}"` : '';
      const rot = p.rot ? ` transform="rotate(${f2(p.rot)} ${f2(p.x * s)} ${f2(p.y * s)})"` : '';
      return `<text${cls} x="${f2(p.x * s)}" y="${f2(p.y * s)}"${rot}${anchor} font-family="${escapeXml(fontCss(p))}" font-size="${f2(p.size * s)}" font-weight="${p.weight}"${svgPaint('fill', p.fill, p.opacity ?? 1)}${ls}${halo}>${escapeXml(p.s)}</text>`;
    }
    if (p.t === 'line') return `<line x1="${f2(p.x1 * s)}" y1="${f2(p.y1 * s)}" x2="${f2(p.x2 * s)}" y2="${f2(p.y2 * s)}"${svgPaint('stroke', p.stroke, p.opacity ?? 1)} stroke-width="${f2((p.sw || 1) * s)}" />`;
    if (p.t === 'pline') {
      const dash = p.dash ? ` stroke-dasharray="${p.dash.map((d) => f2(d * s)).join(' ')}"` : '';
      return `<polyline points="${p.pts.map(([x, y]) => `${f2(x * s)},${f2(y * s)}`).join(' ')}" fill="none"${svgPaint('stroke', p.stroke, p.opacity ?? 1)} stroke-width="${f2((p.sw || 1) * s)}" stroke-linecap="${p.cap || 'round'}" stroke-linejoin="round"${dash}${p.role ? ` class="em-studio-${p.role}"` : ''} />`;
    }
    if (p.t === 'circle' || p.t === 'poly') {
      const fill = p.fill ? svgPaint('fill', p.fill, p.t === 'poly' ? p.opacity ?? 1 : p.fo ?? 1) : ' fill="none"';
      const stroke = p.stroke ? `${svgPaint('stroke', p.stroke, p.t === 'circle' ? p.opacity ?? 1 : 1)} stroke-width="${f2((p.sw || 1) * s)}" stroke-linejoin="round"` : '';
      return p.t === 'circle'
        ? `<circle cx="${f2(p.cx * s)}" cy="${f2(p.cy * s)}" r="${f2(p.r * s)}"${fill}${stroke} />`
        : `<polygon points="${p.pts.map(([x, y]) => `${f2(x * s)},${f2(y * s)}`).join(' ')}"${fill}${stroke} />`;
    }
    if (p.t === 'image' || p.t === 'slot') {
      const href = p.t === 'image' ? p.href : opts.slot?.(p);
      if (!href) return p.fallback ? paintSvg(p.fallback, s, defs, opts) : '';
      const id = `em-studio-clip-${defs.length}`;
      defs.push(`<clipPath id="${id}"><rect x="${f2(p.x * s)}" y="${f2(p.y * s)}" width="${f2(p.w * s)}" height="${f2(p.h * s)}" rx="${f2((p.r || 0) * s)}" /></clipPath>`);
      return `<image href="${escapeXml(href)}" x="${f2(p.x * s)}" y="${f2(p.y * s)}" width="${f2(p.w * s)}" height="${f2(p.h * s)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" />`;
    }
    return '';
  }).join('');
}
