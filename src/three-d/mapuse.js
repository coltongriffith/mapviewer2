// Exploration Maps 3D: what a figure is for (S.mapInfo.use). A presentation figure (the default, and every figure
// made before this setting) sits beside a slide or a release that carries its details, so the figure carries
// little text. A standalone map is read on its own: its title, what it shows, the project and company, the date,
// the coordinate system, the data sources and the notes go into one block at the top of the legend, and the footer
// keeps only the "Made with" line. Loaded by studio.js for a standalone figure, or on EM3D.setMapUse.
let H = null;
export function init(host) { H = host; }
const USES = ['presentation', 'standalone'], FIELDS = ['what', 'project', 'date', 'sources'];
export const on = () => H.S.mapInfo?.use === 'standalone';
export function set(o = {}) {
  const M = H.S.mapInfo, was = M.use;
  if (o.use !== undefined) { if (!USES.includes(o.use)) throw new Error('use must be "presentation" (a figure beside a slide or release) or "standalone" (its details and notes in the legend).'); M.use = o.use; }
  FIELDS.forEach((k) => { if (o[k] !== undefined) M[k] = String(o[k] ?? '').trim().slice(0, 200); });
  // A block section turning standalone (or back) is framed again, so its details card has the free side of the frame.
  if (M.use !== was && H.S.block) return H.load('block').then((b) => b.reframe());
  return null;
}
export function renderUI(el) { if (el) el.hidden = !on(); }
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
// What the block says, in order: the map's title (in the header), what it shows, then label and value rows (empty
// rows left out).
export function details(view = '3d') {
  const S = H.S, M = S.mapInfo, head = S.title.split('·')[0].trim() || S.title;
  return { title: S.title, what: M.what || S.subtitle, rows: [
    ['Project', [M.project || head, S.company].filter(Boolean).join(' · ')],
    ['Date', M.date || today()],
    ['Coordinates', H.geo()?.label || 'Not set'],
    ['Sources', [M.sources, ...H.terrainCredits(view === '3d')].filter(Boolean).join(' · ')],
    ['Notes', [S.footnote, ...H.autoNotes(view)].filter(Boolean).join(' ')],
  ].filter(([, v]) => v) };
}
const wrap = (ctx, t, max) => {
  const out = []; let line = '';
  t.split(/\s+/).filter(Boolean).forEach((w) => { const s = line ? `${line} ${w}` : w; if (line && ctx.measureText(s).width > max) { out.push(line); line = w; } else line = s; });
  if (line) out.push(line);
  return out.map((l) => H.fitText(ctx, l, max));
};
// The block as the top section of the figure's legend card (studio.js drawCard): what the map shows in the legend
// headings' type and colour, the label and value rows, and a thin rule above the legend's own entries. The card
// keeps its place in the layout pass and grows to fit; 230u wide (the wrapping is known before the card is
// sized), narrow enough to stay clear of the block beside it. The title itself stays in the figure's header.
export const CARD_W = 230;
export function secs(ctx, K) {
  const { u, font } = K, D = details('3d'), LW = 64, TW = CARD_W - 24, LH = 12.5, rows = [];
  if (D.what) {
    font(700, 13); const L = wrap(ctx, D.what, TW * u);
    rows.push({ h: L.length * 16 + 3, full: (c, k, x, y) => { k.font(700, 13); c.fillStyle = H.brandTone('head'); L.forEach((t, i) => c.fillText(t, x, y + (8 + 16 * i) * u)); } });
  }
  D.rows.forEach(([label, v]) => {
    font(400, 10.5); const L = wrap(ctx, v, (TW - LW) * u);
    rows.push({ h: L.length * LH + 3, full: (c, k, x, y) => {
      k.font(700, 8.5); c.fillStyle = H.MUTED; c.fillText(label.toUpperCase(), x, y + 6.5 * u);
      k.font(400, 10.5); c.fillStyle = H.INK; L.forEach((t, i) => c.fillText(t, x + LW * u, y + (6.5 + LH * i) * u));
    } });
  });
  rows.push({ h: 7, full: (c, k, x, y, w) => { c.strokeStyle = H.RULE; c.lineWidth = u; c.beginPath(); c.moveTo(x, y + 4 * u); c.lineTo(x + w, y + 4 * u); c.stroke(); } });
  return [{ key: 'info', minW: CARD_W, rows }];
}
