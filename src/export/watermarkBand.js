// The Exploration Maps watermark band, drawn under an exported figure: the mark and wordmark ("Exploration" light,
// "Maps" bold), the review status ("DRAFT FOR REVIEW · NOT FOR PUBLICATION") and a line saying who it was prepared
// for, with the year. Plain canvas 2D with no imports, so any exporter can use it: /3d loads it only for an export
// that asks for the band (EM3D.exportPNG({ watermark })), the 2D exporters for a PNG, SVG, PDF, layers ZIP or package
// export with options.watermarkBand (watermarkBandSvg below for the SVG).
//
// Everything is sized from the band's width, in the pixels of the reference band (Tower v3, 880 px wide, 55 px tall),
// so the band keeps its proportions at any export size.
export const BAND_COLORS = { ink: '#142126', orange: '#C65322', cream: '#fcfbf7', muted: '#5f6e72', rule: 'rgba(20,33,38,0.14)' };
export const BAND_STATUS = 'DRAFT FOR REVIEW · NOT FOR PUBLICATION';
const REF_W = 880, REF_H = 55;
const SANS = '"Source Sans 3", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export const bandHeight = (width) => Math.max(24, Math.round(width * REF_H / REF_W));

// The band's two lines of text. client: who the figure was prepared for (a company line such as
// "Tower Resources Ltd. · TSXV: TWR" keeps its first part); year: the © year (this year by default).
export function bandText({ client, year, status } = {}) {
  const c = String(client ?? '').split('·')[0].trim(), y = year == null || year === '' || !Number.isFinite(+year) ? new Date().getFullYear() : Math.round(+year);
  return {
    status: String(status || BAND_STATUS).toUpperCase(),
    note: `${c ? `Prepared for ${c} by Exploration Maps.` : 'Prepared by Exploration Maps.'} Not licensed for use or redistribution without written permission. © ${y} Exploration Maps`,
  };
}

// The mark (public/brand/exploration-maps-mark.svg, viewBox 480 × 520) at x, y (its top left), size tall.
function drawMark(ctx, x, y, size, c) {
  const k = size / 520, P = (px, py) => [x + px * k, y + py * k];
  const poly = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...P(...p)) : ctx.moveTo(...P(...p)))); if (close) ctx.closePath(); };
  const shape = () => poly([[60, 40], [180, 40], [180, 85], [410, 85], [410, 250], [445, 250], [445, 480], [30, 480], [30, 385], [60, 385]], true);
  shape(); ctx.fillStyle = c.ink; ctx.fill();
  ctx.save(); shape(); ctx.clip(); // the channel ends at the mark's edge (on white in the SVG; the band is cream)
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 22 * k; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  poly([[18, 180], [132, 180], [205, 250], [240, 250], [240, 325], [320, 400], [320, 490]]); ctx.stroke();
  poly([[205, 250], [260, 195]]); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(...P(250, 145), 90 * k, 90 * k); ctx.fillStyle = c.orange; ctx.fillRect(...P(273, 168), 44 * k, 44 * k);
}

const track = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; };
// The text shrunk (to 60%) until it fits maxW, then cut with an ellipsis.
function fitFont(ctx, t, weight, size, maxW, font) {
  let s = size; ctx.font = `${weight} ${s}px ${font}`;
  while (s > size * 0.6 && ctx.measureText(t).width > maxW) { s *= 0.95; ctx.font = `${weight} ${s}px ${font}`; }
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// Draws the band in the rectangle (x, y, width, bandHeight(width)). opts: { client, year, status, font }.
export function drawWatermarkBand(ctx, x, y, width, opts = {}) {
  const c = BAND_COLORS, h = bandHeight(width), s = h / REF_H, font = opts.font || SANS, T = bandText(opts);
  ctx.save();
  ctx.fillStyle = c.cream; ctx.fillRect(x, y, width, h);
  ctx.fillStyle = c.rule; ctx.fillRect(x, y, width, Math.max(1, s));
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // The mark and the wordmark, the site's address under it.
  drawMark(ctx, x + 16 * s, y + 16 * s, 23 * s, c);
  ctx.fillStyle = c.ink; ctx.font = `300 ${17 * s}px ${font}`; track(ctx, -0.2 * s); const wx = x + 42 * s, wy = y + 31 * s;
  ctx.fillText('Exploration', wx, wy); const ew = ctx.measureText('Exploration').width;
  ctx.font = `700 ${17 * s}px ${font}`; ctx.fillText('Maps', wx + ew + 4.5 * s, wy); const mw = ctx.measureText('Maps').width;
  ctx.font = `600 ${6.4 * s}px ${font}`; track(ctx, 1.1 * s); ctx.fillStyle = c.muted; ctx.fillText('EXPLORATIONMAPS.COM', wx, y + 42 * s); track(ctx, 0);
  // A rule, then the status in bold capitals after an orange square, and the note under it.
  const dx = Math.max(wx + ew + mw + 18 * s, x + 192 * s); ctx.fillStyle = c.rule; ctx.fillRect(dx, y + 15 * s, Math.max(1, s), 26 * s);
  const tx = dx + 15 * s, maxW = x + width - tx - 16 * s;
  ctx.fillStyle = c.orange; ctx.fillRect(tx, y + 19.5 * s, 7 * s, 7 * s);
  ctx.fillStyle = c.ink; track(ctx, 0.9 * s); const st = fitFont(ctx, T.status, 800, 11.5 * s, maxW - 13 * s, font); ctx.fillText(st, tx + 13 * s, y + 27 * s); track(ctx, 0);
  ctx.fillStyle = c.muted; ctx.fillText(fitFont(ctx, T.note, 400, 6.6 * s, maxW, font), tx, y + 40.5 * s);
  ctx.restore();
  return h;
}

// A new canvas: the figure with the band under it, the full width of the figure. opts.overlay: the draft mark
// (drawDraftOverlay below) across the figure too, above the band.
export function withWatermarkBand(figure, opts = {}) {
  const h = bandHeight(figure.width), out = document.createElement('canvas'); out.width = figure.width; out.height = figure.height + h;
  const ctx = out.getContext('2d'); ctx.drawImage(figure, 0, 0);
  if (opts.overlay) drawDraftOverlay(ctx, figure.width, figure.height);
  drawWatermarkBand(ctx, 0, figure.height, figure.width, opts);
  return out;
}

// ── The same band as SVG (the 2D SVG export), text kept as text ──────────────────────────────────────────────
// Laid out as drawWatermarkBand lays it out: the text is measured on a scratch canvas in the same fonts, so the
// rule and the fitted status line land where the PNG puts them. "Maps" follows "Exploration" in the text flow, so
// a viewer without Source Sans 3 (the font is named, not embedded) still sets the wordmark without overlap.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => +v.toFixed(2);
function markSvg(x, y, size, c, id) {
  const k = size / 520, pts = (a) => a.map(([px, py]) => `${n(x + px * k)},${n(y + py * k)}`).join(' ');
  const shape = pts([[60, 40], [180, 40], [180, 85], [410, 85], [410, 250], [445, 250], [445, 480], [30, 480], [30, 385], [60, 385]]);
  const line = (a) => `<polyline points="${pts(a)}" fill="none" stroke="#ffffff" stroke-width="${n(22 * k)}" stroke-linecap="butt" stroke-linejoin="miter"/>`;
  return `<clipPath id="${id}"><polygon points="${shape}"/></clipPath><polygon points="${shape}" fill="${c.ink}"/>`
    + `<g clip-path="url(#${id})">${line([[18, 180], [132, 180], [205, 250], [240, 250], [240, 325], [320, 400], [320, 490]])}${line([[205, 250], [260, 195]])}</g>`
    + `<rect x="${n(x + 250 * k)}" y="${n(y + 145 * k)}" width="${n(90 * k)}" height="${n(90 * k)}" fill="#ffffff"/><rect x="${n(x + 273 * k)}" y="${n(y + 168 * k)}" width="${n(44 * k)}" height="${n(44 * k)}" fill="${c.orange}"/>`;
}

// The band as an SVG group in the rectangle (x, y, width, bandHeight(width)). opts as drawWatermarkBand, plus
// ctx: a 2D context to measure with (a scratch canvas by default).
export function watermarkBandSvg(x, y, width, opts = {}) {
  const c = BAND_COLORS, h = bandHeight(width), s = h / REF_H, font = opts.font || SANS, T = bandText(opts);
  const ctx = opts.ctx || document.createElement('canvas').getContext('2d');
  const fam = esc(font), txt = (tx, ty, size, weight, fill, ls, t) => `<text x="${n(tx)}" y="${n(ty)}" font-family="${fam}" font-size="${n(size)}" font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${n(ls)}"` : ''}>${esc(t)}</text>`;
  ctx.save(); track(ctx, -0.2 * s);
  ctx.font = `300 ${17 * s}px ${font}`; const ew = ctx.measureText('Exploration').width;
  ctx.font = `700 ${17 * s}px ${font}`; const mw = ctx.measureText('Maps').width;
  const wx = x + 42 * s, wy = y + 31 * s, dx = Math.max(wx + ew + mw + 18 * s, x + 192 * s), tx = dx + 15 * s, maxW = x + width - tx - 16 * s;
  track(ctx, 0.9 * s); ctx.font = `800 ${11.5 * s}px ${font}`; const st = fitFont(ctx, T.status, 800, 11.5 * s, maxW - 13 * s, font), stSize = parseFloat(ctx.font.match(/([\d.]+)px/)[1]);
  track(ctx, 0); const note = fitFont(ctx, T.note, 400, 6.6 * s, maxW, font), noteSize = parseFloat(ctx.font.match(/([\d.]+)px/)[1]);
  ctx.restore();
  return `<g id="em-watermark-band"><rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${h}" fill="${c.cream}"/>`
    + `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(Math.max(1, s))}" fill="${c.rule}"/>`
    + markSvg(x + 16 * s, y + 16 * s, 23 * s, c, opts.clipId || 'em-band-mark')
    + `<text x="${n(wx)}" y="${n(wy)}" font-family="${fam}" font-size="${n(17 * s)}" fill="${c.ink}" letter-spacing="${n(-0.2 * s)}"><tspan font-weight="300">Exploration</tspan><tspan dx="${n(4.5 * s)}" font-weight="700">Maps</tspan></text>`
    + txt(wx, y + 42 * s, 6.4 * s, 600, c.muted, 1.1 * s, 'EXPLORATIONMAPS.COM')
    + `<rect x="${n(dx)}" y="${n(y + 15 * s)}" width="${n(Math.max(1, s))}" height="${n(26 * s)}" fill="${c.rule}"/>`
    + `<rect x="${n(tx)}" y="${n(y + 19.5 * s)}" width="${n(7 * s)}" height="${n(7 * s)}" fill="${c.orange}"/>`
    + txt(tx + 13 * s, y + 27 * s, stSize, 800, c.ink, 0.9 * s, st)
    + txt(tx, y + 40.5 * s, noteSize, 400, c.muted, 0, note)
    + '</g>';
}

// An exported SVG document with the band added under it: the root grows by the band's height.
export function withWatermarkBandSvg(svg, opts = {}) {
  const m = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>/);
  if (!m) return svg;
  const w = +m[1], h = +m[2], H = h + bandHeight(w);
  const root = m[0].replace(/\bheight="[\d.]+"/, `height="${H}"`).replace(/\bviewBox="[^"]*"/, `viewBox="0 0 ${w} ${H}"`);
  const at = svg.lastIndexOf('</svg>');
  return `${svg.slice(0, m.index)}${root}${svg.slice(m.index + m[0].length, at)}${watermarkBandSvg(0, h, w, opts)}</svg>`;
}

// What a 2D export needs: the band's fonts (Source Sans 3 at the weights it sets) loaded before it is drawn,
// for at most 3 s.
export async function bandFontsReady(doc = typeof document !== 'undefined' ? document : null) {
  const f = doc?.fonts; if (!f?.load) return;
  let t; await Promise.race([Promise.all([300, 400, 600, 700, 800].map((w) => f.load(`${w} 12px "Source Sans 3"`).catch(() => null))), new Promise((r) => { t = setTimeout(r, 3000); })]);
  clearTimeout(t);
}

// ── The draft mark across the figure ─────────────────────────────────────────────────────────────────────────
// The band can be cropped off; this cannot, simply: "DRAFT · EXPLORATIONMAPS.COM" with the mark, repeated on a
// loose diagonal grid (−30°) over the whole figure (map and annotations, not the band), faint enough that the map
// still reads, as a proofing mark does. On a canvas each mark takes the brand ink over light ground and cream over
// dark (sampled from the figure under it); the SVG, which cannot sample its basemap, uses one mid-grey.
export const DRAFT_TEXT = 'DRAFT · EXPLORATIONMAPS.COM';
export const DRAFT_ALPHA = { ink: 0.1, cream: 0.14, grey: 0.13 };
const DRAFT_GREY = '#76848a';
const ANGLE = -30, RAD = (ANGLE * Math.PI) / 180;
// Type size, the gap after each mark and the row pitch, from the figure's size.
export function draftGrid(w, h, textWidth) {
  const size = Math.max(10, Math.round(Math.min(w, h * 1.5) / 52));
  const markW = size * 1.15, unit = markW + size * 0.45 + textWidth(size);
  return { size, markW, dx: unit + size * 7, dy: size * 7.5, unit };
}
function draftWidth(ctx, font) {
  return (size) => { ctx.font = `700 ${size}px ${font}`; track(ctx, size * 0.12); const w = ctx.measureText(DRAFT_TEXT).width; track(ctx, 0); return w; };
}

// Draws the mark over (0, 0, w, h) of ctx's canvas. opts.font: the type family.
export function drawDraftOverlay(ctx, w, h, opts = {}) {
  const font = opts.font || SANS, g = draftGrid(w, h, draftWidth(ctx, font));
  // The figure's lightness on a coarse grid (one sample per ~24 px), to pick ink or cream for each mark.
  const k = Math.max(1, Math.ceil(Math.max(w, h) / 600)) * 4, sw = Math.max(1, Math.ceil(w / k)), sh = Math.max(1, Math.ceil(h / k));
  let lum = null;
  try {
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sg = small.getContext('2d'); sg.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, sw, sh);
    const d = sg.getImageData(0, 0, sw, sh).data; lum = new Float32Array(sw * sh);
    for (let i = 0; i < lum.length; i++) { const a = d[i * 4 + 3] / 255; lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 * a + (1 - a); }
  } catch { lum = null; } // a tainted canvas cannot be read: ink everywhere
  const light = (x, y) => { if (!lum) return 1; const i = Math.min(sh - 1, Math.max(0, Math.floor(y / k))) * sw + Math.min(sw - 1, Math.max(0, Math.floor(x / k))); return lum[i]; };
  const cos = Math.cos(RAD), sin = Math.sin(RAD), cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2 + g.dx;
  const at = (u, v) => [cx + u * cos - v * sin, cy + u * sin + v * cos];
  ctx.save();
  ctx.font = `700 ${g.size}px ${font}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (let row = 0, v = -R; v <= R; row++, v += g.dy) {
    for (let u = -R - (row % 2 ? g.dx / 2 : 0); u <= R; u += g.dx) {
      // Lightness along the mark (its two ends and middle); skip marks wholly outside the figure.
      const pts = [0, 0.5, 1].map((t) => at(u + g.unit * t, v));
      if (pts.every(([x, y]) => x < -g.size || y < -g.size || x > w + g.size || y > h + g.size)) continue;
      const inside = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h);
      const l = inside.length ? inside.reduce((s, [x, y]) => s + light(x, y), 0) / inside.length : 1;
      const dark = l < 0.45, colour = dark ? BAND_COLORS.cream : BAND_COLORS.ink;
      ctx.save();
      ctx.translate(...at(u, v)); ctx.rotate(RAD); ctx.globalAlpha = dark ? DRAFT_ALPHA.cream : DRAFT_ALPHA.ink;
      drawMark(ctx, 0, -g.markW * 0.54, g.markW, { ink: colour, orange: colour });
      ctx.fillStyle = colour; track(ctx, g.size * 0.12); ctx.fillText(DRAFT_TEXT, g.markW + g.size * 0.45, 0); track(ctx, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

// An exported SVG document with the draft mark over the whole figure: a <pattern> of the mark and text in one
// mid-grey, filling a rect on top of everything (before the band, which goes under it). opts.ctx: a 2D context
// to measure with (a scratch canvas by default).
export function withDraftOverlaySvg(svg, opts = {}) {
  const m = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>/);
  if (!m) return svg;
  const w = +m[1], h = +m[2], font = opts.font || SANS;
  const ctx = opts.ctx || document.createElement('canvas').getContext('2d');
  ctx.save(); const g = draftGrid(w, h, draftWidth(ctx, font)); ctx.restore();
  const k = g.markW / 520, P = (a) => a.map(([px, py]) => `${n(px * k)},${n(py * k - g.markW * 0.54)}`).join(' ');
  const mark = `<polygon points="${P([[60, 40], [180, 40], [180, 85], [410, 85], [410, 250], [445, 250], [445, 480], [30, 480], [30, 385], [60, 385]])}"/>`;
  const text = `<text x="${n(g.markW + g.size * 0.45)}" y="0" dominant-baseline="middle" font-family="${esc(font)}" font-size="${g.size}" font-weight="700" letter-spacing="${n(g.size * 0.12)}">${esc(DRAFT_TEXT)}</text>`;
  const cell = (x, y) => `<g transform="translate(${n(x)} ${n(y)})">${mark}${text}</g>`;
  // Two rows per tile, the second offset by half a step, as the canvas lays them.
  const pattern = `<pattern id="em-draft-mark" patternUnits="userSpaceOnUse" width="${n(g.dx)}" height="${n(g.dy * 2)}" patternTransform="translate(${n(w / 2)} ${n(h / 2)}) rotate(${ANGLE})">`
    + `<g fill="${DRAFT_GREY}">${cell(0, g.dy / 2)}${cell(-g.dx / 2, g.dy * 1.5)}${cell(g.dx / 2, g.dy * 1.5)}</g></pattern>`;
  const overlay = `<defs>${pattern}</defs><rect id="em-draft-overlay" x="0" y="0" width="${w}" height="${h}" fill="url(#em-draft-mark)" fill-opacity="${DRAFT_ALPHA.grey}" pointer-events="none"/>`;
  const at = svg.lastIndexOf('</svg>');
  return `${svg.slice(0, at)}${overlay}</svg>`;
}
