import { describe, it, expect } from 'vitest';
import { createRecorder, parseFont, scaleOf } from '../src/three-d/drawlist.js';
import { toSVG, escapeXML, colour, parseRanges, fontFaces, usedChars, fontFaceCss } from '../src/three-d/annotations-svg.js';

// A stand-in for CanvasRenderingContext2D: the transform and style state with save/restore, a measureText that
// reports a width and the ascent above the current baseline, and a log of every call it receives.
class FakeCtx {
  constructor() {
    this.calls = []; this.m = [1, 0, 0, 1, 0, 0]; this.stack = []; this.dash = [];
    Object.assign(this, { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, globalAlpha: 1,
      globalCompositeOperation: 'source-over', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', letterSpacing: '0px' });
    for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'arcTo', 'rect', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage', 'clip', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse', 'roundRect']) this[k] = (...a) => { this.calls.push([k, ...a]); };
  }
  getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f }; }
  mul(n) { const m = this.m; this.m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  translate(x, y) { this.calls.push(['translate', x, y]); this.mul([1, 0, 0, 1, x, y]); }
  scale(x, y) { this.calls.push(['scale', x, y]); this.mul([x, 0, 0, y, 0, 0]); }
  rotate(a) { this.calls.push(['rotate', a]); this.mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); }
  save() { this.calls.push(['save']); this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); }
  restore() { this.calls.push(['restore']); Object.assign(this, this.stack.pop() || {}); }
  setLineDash(d) { this.dash = d.slice(); }
  getLineDash() { return this.dash.slice(); }
  measureText(t) {
    const size = parseFloat(this.font.match(/([\d.]+)px/)[1]);
    return { width: String(t).length * size * 0.5, actualBoundingBoxAscent: size * { alphabetic: 0.7, middle: 0.35, top: 0, bottom: 0.9 }[this.textBaseline] };
  }
}
const record = () => { const real = new FakeCtx(); return { real, ...createRecorder(real) }; };
const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');
const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('draw-command recorder', () => {
  it('passes every call and property through to the real context unchanged', () => {
    const { real, ctx } = record();
    ctx.font = '700 20px "Source Sans 3", sans-serif'; ctx.fillStyle = '#c65322'; ctx.letterSpacing = '2px';
    ctx.save(); ctx.translate(5, 6); ctx.fillText('Hi', 1, 2, 300); ctx.restore();
    expect(real.font).toBe('700 20px "Source Sans 3", sans-serif');
    expect(real.fillStyle).toBe('#c65322');
    expect(real.calls).toEqual([['save'], ['translate', 5, 6], ['fillText', 'Hi', 1, 2, 300], ['restore']]);
    expect(ctx.measureText('abcd').width).toBe(40); // measured by the real context
    expect('letterSpacing' in ctx).toBe(true);
    expect(ctx.getTransform()).toEqual(real.getTransform());
  });
  it('keeps path points in output pixels, under the transform current as each is added', () => {
    const { ctx, list } = record();
    ctx.scale(2, 2); ctx.beginPath(); ctx.moveTo(1, 1); ctx.translate(10, 0); ctx.lineTo(1, 1); ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.fill();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ op: 'path', d: [['M', 2, 2], ['L', 22, 2], ['Z']], fill: 'rgba(255, 255, 255, 0.5)', rule: 'nonzero', alpha: 1, clip: 0 });
  });
  it('turns arcs into Béziers that land on the circle', () => {
    const { ctx, list } = record();
    ctx.beginPath(); ctx.arc(10, 10, 5, 0, Math.PI * 2); ctx.fill();
    const d = list[0].d;
    expect(d[0]).toEqual(['M', 15, 10]);
    expect(d.slice(1).every((s) => s[0] === 'C')).toBe(true);
    expect(d).toHaveLength(5);
    near(d.at(-1).slice(5), [15, 10]);
    near(d[1].slice(5), [10, 15]); // clockwise on screen: the first quarter ends at the bottom
    // Anticlockwise from 0 to -π/2: one quarter, ending at the top.
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, -Math.PI / 2, true); ctx.stroke();
    expect(list[1].d).toHaveLength(2); near(list[1].d[1].slice(5), [0, -1]);
  });
  it('draws arcTo corners as the studio’s rounded boxes do', () => {
    const { ctx, list } = record();
    const r = 4, [x, y, w, h] = [0, 0, 40, 20];
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
    const d = list[0].d;
    // Each corner: a line to the tangent point, then a quarter circle to the next edge.
    expect(d.map((s) => s[0]).join('')).toBe('MLCLCLCLCZ');
    near(d[1].slice(1), [36, 0]); near(d[2].slice(5), [40, 4]);
    near(d[3].slice(1), [40, 16]); near(d[4].slice(5), [36, 20]);
    near(d[8].slice(5), [4, 0]);
  });
  it('scales line widths and dashes by the transform at stroke time', () => {
    const { ctx, list } = record();
    ctx.scale(3, 3); ctx.lineWidth = 2; ctx.setLineDash([4, 2]); ctx.strokeStyle = '#142126'; ctx.lineCap = 'round'; ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.stroke();
    expect(list[0]).toMatchObject({ stroke: '#142126', width: 6, dash: [12, 6], cap: 'round', alpha: 0.4 });
    expect(scaleOf([0, 2, -2, 0, 0, 0])).toBe(2);
  });
  it('records text with its font, anchor and the alphabetic baseline', () => {
    const { ctx, list } = record();
    ctx.font = 'italic 600 20px "Source Sans 3", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0a4268';
    ctx.fillText('12.0 m @ 1.20 g/t Au', 100, 50);
    expect(list[0]).toMatchObject({ op: 'text', text: '12.0 m @ 1.20 g/t Au', x: 100, anchor: 'middle', font: { style: 'italic', weight: 600, size: 20, family: '"Source Sans 3", sans-serif' }, fill: '#0a4268' });
    expect(list[0].y).toBeCloseTo(50 + 20 * (0.7 - 0.35)); // glyph tops where Canvas put them
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.strokeText('Halo', 0, 0, 10);
    expect(list[1]).toMatchObject({ anchor: 'end', y: 0, stroke: '#ffffff', width: 3, maxWidth: 10 });
  });
  it('parses canvas font strings', () => {
    expect(parseFont('700 30px "Source Sans 3", "Segoe UI", sans-serif')).toEqual({ style: 'normal', weight: 700, size: 30, family: '"Source Sans 3", "Segoe UI", sans-serif' });
    expect(parseFont('bold 12.5px/1.2 Arial')).toEqual({ style: 'normal', weight: 700, size: 12.5, family: 'Arial' });
    expect(parseFont('11px "IBM Plex Mono", monospace')).toMatchObject({ weight: 400, size: 11, family: '"IBM Plex Mono", monospace' });
  });
  it('tracks clips through save and restore', () => {
    const { ctx, list, clips } = record();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 10, 10); ctx.clip(); ctx.fillRect(0, 0, 20, 20);
    ctx.save(); ctx.beginPath(); ctx.rect(5, 5, 10, 10); ctx.clip('evenodd'); ctx.fillRect(0, 0, 20, 20); ctx.restore();
    ctx.fillRect(1, 1, 1, 1); ctx.restore(); ctx.fillRect(2, 2, 2, 2);
    expect(list.map((c) => c.clip)).toEqual([1, 2, 1, 0]);
    expect(clips[1]).toMatchObject({ id: 2, parent: 1, rule: 'evenodd' });
  });
  it('keeps images, a data URL logo as it is', () => {
    const { ctx, list } = record();
    const logo = { src: 'data:image/png;base64,AAAA', naturalWidth: 200, naturalHeight: 100 };
    ctx.drawImage(logo, 10, 20, 100, 50); ctx.drawImage(logo, 0, 0);
    expect(list[0]).toMatchObject({ op: 'image', href: 'data:image/png;base64,AAAA', x: 10, y: 20, w: 100, h: 50 });
    expect(list[1]).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
  });
  it('notes what SVG cannot carry instead of failing', () => {
    const { ctx, unsupported, list } = record();
    ctx.fillStyle = { addColorStop() {} }; ctx.fillRect(0, 0, 1, 1); ctx.clearRect(0, 0, 1, 1);
    expect([...unsupported]).toEqual(expect.arrayContaining(['gradient or pattern', 'clearRect']));
    expect(list[0].fill).toBe('#808080');
  });
});

describe('annotations SVG', () => {
  const sample = () => {
    const { ctx, list, clips, unsupported } = record();
    ctx.scale(2, 2);
    ctx.font = '700 30px "Source Sans 3", "Segoe UI", sans-serif'; ctx.fillStyle = '#0a4268'; ctx.fillText('Rift Project · Drill Results', 44, 60);
    ctx.font = '500 11.5px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(20, 33, 38, 0.5)'; ctx.fillText('48.0 m @ 1.31 g/t Au', 200, 300);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(10, 10, 50, 20);
    ctx.save(); ctx.translate(100, 100); ctx.rotate(Math.PI / 2); ctx.fillStyle = '#142126'; ctx.textAlign = 'left'; ctx.fillText('S-037', 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 100, 100); ctx.clip(); ctx.strokeStyle = '#c65322'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(50, 50); ctx.stroke(); ctx.restore();
    ctx.drawImage({ src: 'data:image/png;base64,AAAA', naturalWidth: 4, naturalHeight: 2 }, 300, 20, 40, 20);
    return { list, clips, unsupported };
  };
  it('writes a well-formed SVG of the layer’s size', () => {
    const doc = parse(toSVG(sample(), { width: 1920, height: 1080, title: 'Rift: annotations' }));
    expect(doc.querySelector('parsererror')).toBeNull();
    const svg = doc.documentElement;
    expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['1920', '1080', '0 0 1920 1080']);
    expect(doc.querySelector('title').textContent).toBe('Rift: annotations');
  });
  it('emits live text with family, weight, size, fill and anchor', () => {
    const doc = parse(toSVG(sample(), { width: 1920, height: 1080 })), t = [...doc.querySelectorAll('text')];
    expect(t.map((n) => n.textContent)).toEqual(['Rift Project · Drill Results', '48.0 m @ 1.31 g/t Au', 'S-037']);
    // A plain scale is applied to the numbers: the title is 60 px at (88, 120).
    expect(Object.fromEntries(['x', 'y', 'font-family', 'font-size', 'font-weight', 'fill'].map((a) => [a, t[0].getAttribute(a)])))
      .toEqual({ x: '88', y: '120', 'font-family': "'Source Sans 3', 'Segoe UI', sans-serif", 'font-size': '60', 'font-weight': '700', fill: '#0a4268' });
    expect([t[1].getAttribute('text-anchor'), t[1].getAttribute('fill'), t[1].getAttribute('fill-opacity'), t[1].getAttribute('font-size')]).toEqual(['middle', '#142126', '0.5', '23']);
    // Rotated text: the scale on its size, the turn kept as a rotation.
    expect([t[2].getAttribute('transform'), t[2].getAttribute('font-size'), t[2].getAttribute('x')]).toEqual(['translate(200 200) rotate(90)', '23', '0']);
    expect(t[0].getAttribute('xml:space')).toBe('preserve');
  });
  it('emits boxes, paths, clips and images', () => {
    const doc = parse(toSVG(sample(), { width: 1920, height: 1080 }));
    const rect = doc.querySelector('rect');
    expect(['x', 'y', 'width', 'height', 'fill'].map((a) => rect.getAttribute(a))).toEqual(['20', '20', '100', '40', '#ffffff']);
    const path = doc.querySelector('g[clip-path] path');
    expect(path.getAttribute('d')).toBe('M0 0L100 100');
    expect([path.getAttribute('stroke'), path.getAttribute('stroke-width'), path.getAttribute('stroke-dasharray'), path.getAttribute('stroke-miterlimit'), path.getAttribute('fill')]).toEqual(['#c65322', '3', '10 6', '10', 'none']);
    const clipId = doc.querySelector('g[clip-path]').getAttribute('clip-path').match(/#([\w-]+)/)[1];
    expect(doc.getElementById(clipId).querySelector('path').getAttribute('d')).toBe('M0 0L200 0L200 200L0 200Z');
    const img = doc.querySelector('image');
    expect(img.getAttribute('xlink:href')).toBe('data:image/png;base64,AAAA');
    expect(['x', 'y', 'width', 'height'].map((a) => img.getAttribute(a))).toEqual(['600', '40', '80', '40']);
  });
  it('keeps a transform that is not a turn and a scale as a matrix', () => {
    const { ctx, list, clips } = record();
    ctx.scale(2, 1); ctx.fillRect(1, 2, 3, 4); ctx.fillText('wide', 5, 6);
    const doc = parse(toSVG({ list, clips }, { width: 10, height: 10 }));
    expect(doc.querySelector('rect').getAttribute('transform')).toBe('matrix(2 0 0 1 0 0)');
    expect([doc.querySelector('text').getAttribute('x'), doc.querySelector('text').getAttribute('transform')]).toEqual(['5', 'matrix(2 0 0 1 0 0)']);
  });
  it('leaves out what is invisible', () => {
    const { ctx, list, clips } = record();
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'; ctx.fillRect(0, 0, 5, 5); ctx.globalAlpha = 0; ctx.fillStyle = '#000000'; ctx.fillText('x', 0, 0);
    expect(parse(toSVG({ list, clips }, { width: 10, height: 10 })).querySelectorAll('rect, text')).toHaveLength(0);
  });
  it('embeds font rules in CDATA', () => {
    const svg = toSVG(sample(), { width: 10, height: 10, fontCss: '@font-face{font-family:"A";src:url("data:font/woff2;base64,AA==")}' });
    expect(parse(svg).querySelector('style').textContent).toContain('@font-face{font-family:"A"');
  });
});

describe('escaping', () => {
  it('escapes markup characters and drops what XML cannot hold', () => {
    expect(escapeXML(`<b> & "q" 'a'`)).toBe(`&lt;b&gt; &amp; &quot;q&quot; 'a'`);
    expect(escapeXML('a\u0000b\u0007c\u000Bd￾e')).toBe('abcde');
    expect(escapeXML('lone \uD800 high, pair 😀 kept, lone \uDC00 low')).toBe('lone  high, pair 😀 kept, lone  low');
    expect(escapeXML('tab\tnew\nline')).toBe('tab\tnew\nline');
  });
  it('keeps the meaning of text through the SVG', () => {
    const { ctx, list, clips } = record();
    const texts = ['Cu & Au < 0.2 %', 'Hole "S-037" ≥ 1.0 g/t', 'A–A′ <script>alert(1)</script>', ' leading space'];
    texts.forEach((t, i) => ctx.fillText(t, 0, i * 10));
    const doc = parse(toSVG({ list, clips }, { width: 10, height: 10, title: 'T & <x>' }));
    expect(doc.querySelector('parsererror')).toBeNull();
    expect([...doc.querySelectorAll('text')].map((n) => n.textContent)).toEqual(texts);
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('title').textContent).toBe('T & <x>');
  });
  it('reads canvas colours as hex and opacity', () => {
    expect(colour('#C65322')).toEqual({ c: '#c65322', a: 1 });
    expect(colour('rgba(255, 255, 255, 0.94)')).toEqual({ c: '#ffffff', a: 0.94 });
    expect(colour('rgb(20,33,38)')).toEqual({ c: '#142126', a: 1 });
    expect(colour('#fff8')).toEqual({ c: '#ffffff', a: 0x88 / 255 });
  });
});

describe('font embedding', () => {
  const css = `/* cyrillic */
@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/sss/cyr.woff2) format('woff2'); unicode-range: U+0301, U+0400-045F; }
/* latin */
@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/sss/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
/* latin */
@font-face { font-family: 'Source Sans 3'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/sss/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F; }
/* latin */
@font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/plex/latin.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;
  const doc = { querySelectorAll: () => [{ href: 'https://fonts.googleapis.com/css2?family=Source+Sans+3' }] };
  const textList = () => { const { ctx, list } = record(); ctx.font = '700 20px "Source Sans 3", sans-serif'; ctx.fillText('Rift – A', 0, 0); return list; };
  const okFetch = (seen = []) => async (url) => { seen.push(url); return url.includes('googleapis') ? { ok: true, text: async () => css } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };

  it('parses unicode ranges and faces', () => {
    expect(parseRanges('U+0000-00FF, U+0131, U+4??')).toEqual([[0, 255], [0x131, 0x131], [0x400, 0x4ff]]);
    const f = fontFaces(css);
    expect(f.map((x) => [x.family, x.url.split('/').pop()])).toEqual([['Source Sans 3', 'cyr.woff2'], ['Source Sans 3', 'latin.woff2'], ['Source Sans 3', 'latin.woff2'], ['IBM Plex Mono', 'latin.woff2']]);
    expect([...usedChars(textList()).get('Source Sans 3')]).toContain(0x2013);
  });
  it('embeds the faces that cover the characters drawn, each file fetched once', async () => {
    const seen = [], out = await fontFaceCss(textList(), { doc, fetch: okFetch(seen) });
    expect(out.embedded).toEqual(['Source Sans 3']);
    expect(out.referenced).toEqual([]);
    expect(seen.filter((u) => u.endsWith('.woff2'))).toEqual(['https://fonts.gstatic.com/s/sss/latin.woff2']); // not Cyrillic, not the unused Plex Mono
    expect(out.css.match(/@font-face/g)).toHaveLength(2); // 400 and 700 share the variable file
    expect(out.css).toContain('url("data:font/woff2;base64,AQID")');
    expect(out.css).not.toContain('gstatic');
  });
  it('names the fonts without embedding when they cannot be fetched', async () => {
    const out = await fontFaceCss(textList(), { doc, fetch: async (u) => (u.includes('googleapis') ? { ok: true, text: async () => css } : { ok: false, status: 404 }) });
    expect(out).toMatchObject({ css: '', embedded: [], referenced: ['Source Sans 3'] });
    const never = await fontFaceCss(textList(), { doc, ms: 20, fetch: (u, o) => new Promise((resolve, reject) => { o.signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
    expect(never).toMatchObject({ css: '', referenced: ['Source Sans 3'] });
    expect(await fontFaceCss(textList(), { doc, fetch: okFetch(), maxBytes: 2 })).toMatchObject({ css: '', error: 'fonts too large to embed' });
    expect(await fontFaceCss(textList(), { doc: { querySelectorAll: () => [] }, fetch: okFetch() })).toMatchObject({ css: '', referenced: ['Source Sans 3'] });
  });
});
