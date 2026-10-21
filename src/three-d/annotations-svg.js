// Exploration Maps 3D: annotations.svg for the designer layers ZIP (F3 part 2). toSVG turns the commands
// recorded by drawlist.js into an SVG the size of annotations.png that stacks over scene.png the same way:
// text stays live <text> in its font family, weight and size, lines and shapes are <path> and <rect>, and
// the logo and map inset are <image>. fontFaceCss embeds the web fonts the text uses, fetched from the
// stylesheets the page already loaded, so the file renders the same off this page. Loaded on demand by
// desk.js, only when the SVG is asked for.

export { createRecorder } from './drawlist.js'; // one chunk with the recorder

// Characters XML 1.0 cannot carry at all (C0 controls other than tab and newlines, lone surrogates, U+FFFE/F).
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const escapeXML = (s) => String(s).replace(BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); // attributes are double-quoted
const num = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${typeof v === 'number' ? num(v) : escapeXML(v)}"`).join('');

// Canvas colours come back as #rrggbb or rgba(r, g, b, a): SVG gets the hex and an opacity.
export function colour(v) {
  const s = String(v).trim(), m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; return { c: `#${m.slice(1, 4).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('')}`, a }; }
  const h = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (h) { let x = h[1]; if (x.length <= 4) x = [...x].map((c) => c + c).join(''); return { c: `#${x.slice(0, 6).toLowerCase()}`, a: x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1 }; }
  return { c: s, a: s === 'transparent' ? 0 : 1 };
}
// Font stacks in single quotes, so they sit inside a double-quoted attribute unescaped.
const family = (f) => f.replace(/"/g, "'");
const firstFamily = (f) => f.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
const pathData = (d) => {
  const segs = d.slice(); while (segs.length && segs.at(-1)[0] === 'M') segs.pop(); // a moveTo left at the end draws nothing
  return segs.map(([c, ...p]) => c + p.map(num).join(' ')).join('');
};
// Where an element goes: a uniform scale is applied to its numbers (k), so text keeps its real size; a shift
// is added (ox, oy), or with a rotation kept as translate() rotate(); any other transform stays a matrix().
function place(m) {
  const k = Math.hypot(m[0], m[1]);
  if (!(k > 0) || Math.abs(m[0] - m[3]) > 1e-9 * k || Math.abs(m[1] + m[2]) > 1e-9 * k) return { k: 1, ox: 0, oy: 0, t: `matrix(${m.map(num).join(' ')})` };
  const deg = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  return Math.abs(deg) < 1e-6 ? { k, ox: m[4], oy: m[5] } : { k, ox: 0, oy: 0, t: `translate(${num(m[4])} ${num(m[5])}) rotate(${Math.round(deg * 1e4) / 1e4})` };
}

function paintAttrs(c, k = 1) {
  if (c.fill !== undefined) { const p = colour(c.fill), a = p.a * c.alpha; return { fill: p.c, 'fill-opacity': a < 1 ? a : undefined }; }
  const p = colour(c.stroke), a = p.a * c.alpha;
  return {
    fill: 'none', stroke: p.c, 'stroke-opacity': a < 1 ? a : undefined, 'stroke-width': c.width * k,
    'stroke-linecap': c.cap !== 'butt' ? c.cap : undefined, 'stroke-linejoin': c.join !== 'miter' ? c.join : undefined,
    'stroke-miterlimit': c.join === 'miter' ? c.miter : undefined, // SVG's default is 4, Canvas's 10
    'stroke-dasharray': c.dash?.length ? c.dash.map((d) => num(d * k)).join(' ') : undefined, 'stroke-dashoffset': c.dash?.length && c.dashOffset ? c.dashOffset * k : undefined,
  };
}
const visible = (c) => c.alpha > 0 && colour(c.fill ?? c.stroke).a > 0;

function element(c) {
  if (c.op === 'path') return `<path${attrs({ d: pathData(c.d), ...paintAttrs(c), 'fill-rule': c.fill !== undefined && c.rule === 'evenodd' ? 'evenodd' : undefined })}/>`;
  if (c.op === 'rect') {
    let { x, y, w, h } = c; if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
    const { k, ox, oy, t } = place(c.m);
    return `<rect${attrs({ x: x * k + ox, y: y * k + oy, width: w * k, height: h * k, ...paintAttrs(c, k), transform: t })}/>`;
  }
  if (c.op === 'image') {
    const { k, ox, oy, t } = place(c.m);
    return `<image${attrs({ x: c.x * k + ox, y: c.y * k + oy, width: c.w * k, height: c.h * k, preserveAspectRatio: 'none', opacity: c.alpha < 1 ? c.alpha : undefined, transform: t })} xlink:href="${escapeXML(c.href)}"/>`;
  }
  // Text: one <text> per fillText or strokeText (a halo is the stroked copy under the filled one).
  const { k, ox, oy, t } = place(c.m), f = c.font;
  return `<text${attrs({
    x: c.x * k + ox, y: c.y * k + oy, 'font-family': family(f.family), 'font-size': f.size * k, 'font-weight': f.weight !== 400 ? f.weight : undefined, 'font-style': f.style !== 'normal' ? f.style : undefined,
    'letter-spacing': c.spacing ? c.spacing * k : undefined, 'text-anchor': c.anchor !== 'start' ? c.anchor : undefined,
    textLength: c.maxWidth !== undefined ? c.maxWidth * k : undefined, lengthAdjust: c.maxWidth !== undefined ? 'spacingAndGlyphs' : undefined,
    ...paintAttrs(c, k), transform: t,
  })} xml:space="preserve">${escapeXML(c.text)}</text>`;
}

// The recorder's { list, clips } as an SVG document of width × height px.
export function toSVG(rec, { width, height, fontCss = '', title = 'Annotations', note = '' } = {}) {
  const used = new Set(); rec.list.forEach((c) => { for (let id = c.clip; id && !used.has(id); id = rec.clips[id - 1].parent) used.add(id); });
  const clipDefs = rec.clips.filter((c) => used.has(c.id)).map((c) => `<clipPath${attrs({ id: `em3d-clip-${c.id}`, 'clip-path': c.parent ? `url(#em3d-clip-${c.parent})` : undefined })}><path${attrs({ d: pathData(c.d), 'clip-rule': c.rule === 'evenodd' ? 'evenodd' : undefined })}/></clipPath>`);
  const body = []; let open = 0;
  rec.list.filter(visible).forEach((c) => {
    if (c.clip !== open) { if (open) body.push('</g>'); if (c.clip) body.push(`<g clip-path="url(#em3d-clip-${c.clip})">`); open = c.clip; }
    body.push(element(c));
  });
  if (open) body.push('</g>');
  const defs = [fontCss && `<style><![CDATA[\n${fontCss.replace(/]]>/g, ']]]]><![CDATA[>')}\n]]></style>`, ...clipDefs].filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${escapeXML(title)}</title>${note ? `\n<desc>${escapeXML(note)}</desc>` : ''}
${defs.length ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''}<g id="annotations">
${body.join('\n')}
</g>
</svg>
`;
}

// ---- Fonts ----
// unicode-range: U+0000-00FF, U+0131, U+2000-206F… → [[lo, hi], …]
export function parseRanges(s) {
  return String(s).split(',').map((r) => r.trim().replace(/^u\+/i, '')).filter(Boolean).map((r) => {
    if (r.includes('?')) return [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)];
    const [a, b] = r.split('-'); return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}
// @font-face blocks of a stylesheet, each with its family, ranges and first url().
export function fontFaces(css) {
  return (String(css).match(/@font-face\s*{[^}]*}/g) || []).map((block) => ({
    block, family: block.match(/font-family:\s*['"]?([^;'"]+?)['"]?\s*;/)?.[1].trim(),
    ranges: (r => (r ? parseRanges(r[1]) : null))(block.match(/unicode-range:\s*([^;}]+)/)), url: block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1],
  }));
}
// The characters each family is asked to draw, by its first name in the stack.
export function usedChars(list) {
  const out = new Map();
  list.forEach((c) => { if (c.op !== 'text') return; const f = firstFamily(c.font.family); if (!out.has(f)) out.set(f, new Set()); for (const ch of c.text) out.get(f).add(ch.codePointAt(0)); });
  return out;
}
const MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const base64 = (buf) => { let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin); };

// @font-face rules, with the font files as data URLs, for the families the text uses: those faces of the page's
// Google Fonts stylesheets whose unicode-range covers a character drawn. Bounded in time and size; on any
// failure the SVG keeps the family names and says so, and the export goes ahead.
export async function fontFaceCss(list, { doc = globalThis.document, fetch = globalThis.fetch, ms = 5000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const used = usedChars(list), families = [...used.keys()];
  const hrefs = [...(doc?.querySelectorAll?.('link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]') || [])].map((l) => l.href);
  if (!families.length || !hrefs.length || typeof fetch !== 'function') return { css: '', embedded: [], referenced: families };
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), ms), get = (u) => fetch(u, ctrl ? { signal: ctrl.signal } : undefined).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r; });
  try {
    const sheets = await Promise.all(hrefs.map((h) => get(h).then((r) => r.text()).catch(() => '')));
    const faces = sheets.flatMap(fontFaces).filter((f) => f.url && used.has(f.family) && (!f.ranges || [...used.get(f.family)].some((cp) => f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi))));
    const files = new Map(); let bytes = 0;
    await Promise.all([...new Set(faces.map((f) => f.url))].map(async (u) => {
      const buf = new Uint8Array(await (await get(u)).arrayBuffer()); bytes += buf.length;
      if (bytes > maxBytes) throw new Error('fonts too large to embed');
      files.set(u, `data:${MIME[u.split(/[?#]/)[0].split('.').pop().toLowerCase()] || 'font/woff2'};base64,${base64(buf)}`);
    }));
    const embedded = [...new Set(faces.map((f) => f.family))];
    return { css: faces.map((f) => f.block.replace(/url\(\s*['"]?[^'")]+['"]?\s*\)/, `url("${files.get(f.url)}")`)).join('\n'), embedded, referenced: families.filter((f) => !embedded.includes(f)), bytes };
  } catch (e) {
    return { css: '', embedded: [], referenced: families, error: e.message };
  } finally { clearTimeout(timer); }
}
