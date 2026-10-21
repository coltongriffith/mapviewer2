// Exploration Maps 3D: a draw-command recorder for the screen-space annotation layer (F3 part 2).
// createRecorder(ctx) returns a stand-in for a Canvas 2D context that draws on ctx exactly as before and,
// alongside, records what was drawn as a short list of commands: paths, rectangles, text and images, each
// with its paint, line, alpha, transform and clip. annotations-svg.js turns the list into an editable SVG.
// Loaded only when the layers ZIP is asked for its SVG (desk.js), so the figure and the PNG never see it.
//
// Every call and property still goes to the real context, so measuring, layout and the pixels drawn are
// unchanged; the recorder only reads state from it. Path points are kept in output pixels (the current
// transform applied as each is added, as Canvas does). Text, rectangles and images keep their own
// coordinates with the transform, so text stays text at its size. Arcs become cubic Béziers.

const TAU = Math.PI * 2;
const mat = (c) => { const t = c.getTransform(); return [t.a, t.b, t.c, t.d, t.e, t.f]; };
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const invert = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
// The transform's length scale, for line widths and dashes (exact for rotation plus uniform scale).
export const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// "italic 600 18px "Source Sans 3", sans-serif" → { style, weight, size, family }
export function parseFont(font) {
  const s = String(font || ''), at = s.search(/(?:^|\s)[\d.]+px/);
  if (at < 0) return { style: 'normal', weight: 400, size: 10, family: 'sans-serif' };
  const head = s.slice(0, at).trim().split(/\s+/).filter(Boolean), rest = s.slice(at).trim(), m = rest.match(/^([\d.]+)px(?:\s*\/\s*\S+)?\s+(.+)$/);
  const w = head.find((t) => /^\d{3}$/.test(t) || t === 'bold' || t === 'lighter' || t === 'bolder');
  return { style: head.find((t) => t === 'italic' || t === 'oblique') || 'normal', weight: w === 'bold' ? 700 : w && /^\d/.test(w) ? +w : 400, size: m ? +m[1] : 10, family: m ? m[2].trim() : 'sans-serif' };
}

export function createRecorder(real) {
  const list = [], clips = [], unsupported = new Set();
  let path = [], cur = null, start = null, clip = 0, stack = [];
  const to = (x, y) => { const p = apply(mat(real), x, y); return p; };
  const moveTo = (p) => { path.push(['M', ...p]); cur = start = p; };
  const lineTo = (p) => { if (!cur) moveTo(p); else { path.push(['L', ...p]); cur = p; } };
  // An elliptical arc in user space, as Canvas draws it, in Béziers of at most 90°.
  function ellipse(x, y, rx, ry, rot, a0, a1, ccw) {
    let sweep;
    if (!ccw && a1 - a0 >= TAU) sweep = TAU; else if (ccw && a0 - a1 >= TAU) sweep = -TAU;
    else { const d = ((a1 - a0) % TAU + TAU) % TAU; sweep = ccw ? (d ? d - TAU : 0) : d; }
    // The point at angle a, moved k times the tangent (k = 0: on the ellipse), in output pixels.
    const m = mat(real), cr = Math.cos(rot), sr = Math.sin(rot);
    const pt = (a, k = 0) => { const ex = rx * (Math.cos(a) - k * Math.sin(a)), ey = ry * (Math.sin(a) + k * Math.cos(a)); return apply(m, x + ex * cr - ey * sr, y + ex * sr + ey * cr); };
    const p0 = pt(a0); if (!cur) moveTo(p0); else if (Math.hypot(p0[0] - cur[0], p0[1] - cur[1]) > 1e-9) lineTo(p0);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), step = sweep / n, k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) { const s = a0 + step * i, e = s + step; cur = pt(e); path.push(['C', ...pt(s, k), ...pt(e, -k), ...cur]); }
  }
  function arcTo(x1, y1, x2, y2, r) {
    if (!cur) { moveTo(to(x1, y1)); return; }
    const [x0, y0] = apply(invert(mat(real)), ...cur), ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cross = ax * by - ay * bx;
    if (!r || !la || !lb || Math.abs(cross) < 1e-9 * la * lb) { lineTo(to(x1, y1)); return; }
    const cos = (ax * bx + ay * by) / (la * lb), half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2, d = r / Math.tan(half);
    const t1 = [x1 + ax / la * d, y1 + ay / la * d], t2 = [x1 + bx / lb * d, y1 + by / lb * d];
    const bisx = ax / la + bx / lb, bisy = ay / la + by / lb, bl = Math.hypot(bisx, bisy), h = r / Math.sin(half), c = [x1 + bisx / bl * h, y1 + bisy / bl * h];
    ellipse(c[0], c[1], r, r, 0, Math.atan2(t1[1] - c[1], t1[0] - c[0]), Math.atan2(t2[1] - c[1], t2[0] - c[0]), cross > 0);
  }
  function roundRect(x, y, w, h, radii = 0) {
    const r = [].concat(radii).map((v) => (typeof v === 'number' ? v : v?.x ?? 0)), [tl, tr, br, bl] = r.length === 1 ? [r[0], r[0], r[0], r[0]] : r.length === 2 ? [r[0], r[1], r[0], r[1]] : r.length === 3 ? [r[0], r[1], r[2], r[1]] : r;
    moveTo(to(x + tl, y)); lineTo(to(x + w - tr, y)); if (tr) ellipse(x + w - tr, y + tr, tr, tr, 0, -Math.PI / 2, 0, false);
    lineTo(to(x + w, y + h - br)); if (br) ellipse(x + w - br, y + h - br, br, br, 0, 0, Math.PI / 2, false);
    lineTo(to(x + bl, y + h)); if (bl) ellipse(x + bl, y + h - bl, bl, bl, 0, Math.PI / 2, Math.PI, false);
    lineTo(to(x, y + tl)); if (tl) ellipse(x + tl, y + tl, tl, tl, 0, Math.PI, Math.PI * 1.5, false);
    path.push(['Z']); cur = start; moveTo(to(x, y));
  }
  // The paint and line state of the real context, read as a command is drawn.
  const base = () => {
    if (real.globalCompositeOperation !== 'source-over') unsupported.add(`composite ${real.globalCompositeOperation}`);
    if (real.shadowBlur || real.shadowOffsetX || real.shadowOffsetY) unsupported.add('shadow');
    return { alpha: real.globalAlpha, clip };
  };
  const paint = (v) => { if (typeof v === 'string') return v; unsupported.add('gradient or pattern'); return '#808080'; };
  const fillOf = () => ({ fill: paint(real.fillStyle) });
  const lineOf = (k = 1) => ({ stroke: paint(real.strokeStyle), width: real.lineWidth * k, cap: real.lineCap, join: real.lineJoin, miter: real.miterLimit, dash: real.getLineDash().map((d) => d * k), dashOffset: real.lineDashOffset * k });
  function text(kind, t, x, y, maxWidth) {
    const m = mat(real), font = parseFont(real.font), align = real.textAlign, baseline = real.textBaseline;
    const mt = real.measureText(t);
    // Moved onto the alphabetic baseline, where SVG text sits: the glyphs' top stays where Canvas put it.
    let dy = 0;
    if (baseline !== 'alphabetic') { real.textBaseline = 'alphabetic'; dy = real.measureText(t).actualBoundingBoxAscent - mt.actualBoundingBoxAscent; real.textBaseline = baseline; }
    const anchor = { center: 'middle', right: 'end', end: real.direction === 'rtl' ? 'start' : 'end', start: real.direction === 'rtl' ? 'end' : 'start' }[align] || 'start';
    const spacing = parseFloat(real.letterSpacing) || 0;
    list.push({ op: 'text', text: String(t), x, y: y + dy, m, font, anchor, spacing, width: mt.width, ...(maxWidth !== undefined && mt.width > maxWidth && { maxWidth }), ...base(), ...(kind === 'fill' ? fillOf() : lineOf()) });
  }
  const imageCache = new WeakMap();
  function imageURL(img, sx, sy, sw, sh, iw, ih) {
    const whole = !sx && !sy && sw === iw && sh === ih;
    if (whole && imageCache.has(img)) return imageCache.get(img);
    let url = null;
    try {
      if (whole && typeof img.src === 'string' && img.src.startsWith('data:')) url = img.src;
      else { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh)); c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); url = c.toDataURL('image/png'); }
    } catch { unsupported.add('image that cannot be read'); }
    if (whole) imageCache.set(img, url);
    return url;
  }
  const hooks = {
    beginPath() { path = []; cur = start = null; },
    moveTo(x, y) { moveTo(to(x, y)); },
    lineTo(x, y) { lineTo(to(x, y)); },
    closePath() { if (path.length) { path.push(['Z']); cur = start; } },
    bezierCurveTo(a, b, c, d, x, y) { if (!cur) moveTo(to(a, b)); const p = to(x, y); path.push(['C', ...to(a, b), ...to(c, d), ...p]); cur = p; },
    quadraticCurveTo(a, b, x, y) { if (!cur) moveTo(to(a, b)); const q = to(a, b), p = to(x, y), c1 = [cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1])], c2 = [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])]; path.push(['C', ...c1, ...c2, ...p]); cur = p; },
    arc(x, y, r, a0, a1, ccw) { ellipse(x, y, r, r, 0, a0, a1, !!ccw); },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { ellipse(x, y, rx, ry, rot, a0, a1, !!ccw); },
    arcTo,
    rect(x, y, w, h) { moveTo(to(x, y)); lineTo(to(x + w, y)); lineTo(to(x + w, y + h)); lineTo(to(x, y + h)); path.push(['Z']); moveTo(to(x, y)); },
    roundRect,
    fill(rule) { if (typeof rule === 'object') { unsupported.add('Path2D'); return; } if (path.length) list.push({ op: 'path', d: path.slice(), rule: rule === 'evenodd' ? 'evenodd' : 'nonzero', ...base(), ...fillOf() }); },
    stroke(p) { if (p) { unsupported.add('Path2D'); return; } if (path.length) list.push({ op: 'path', d: path.slice(), ...base(), ...lineOf(scaleOf(mat(real))) }); },
    fillRect(x, y, w, h) { list.push({ op: 'rect', x, y, w, h, m: mat(real), ...base(), ...fillOf() }); },
    strokeRect(x, y, w, h) { list.push({ op: 'rect', x, y, w, h, m: mat(real), ...base(), ...lineOf() }); },
    clearRect() { unsupported.add('clearRect'); },
    fillText(t, x, y, mw) { text('fill', t, x, y, mw); },
    strokeText(t, x, y, mw) { text('stroke', t, x, y, mw); },
    drawImage(img, ...a) {
      const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
      const [sx, sy, sw, sh, dx, dy, dw, dh] = a.length === 2 ? [0, 0, iw, ih, a[0], a[1], iw, ih] : a.length === 4 ? [0, 0, iw, ih, ...a] : a;
      const href = imageURL(img, sx, sy, sw, sh, iw, ih);
      if (href) list.push({ op: 'image', href, x: dx, y: dy, w: dw, h: dh, m: mat(real), ...base() });
    },
    clip(rule) { if (typeof rule === 'object') { unsupported.add('Path2D'); return; } clips.push({ id: clips.length + 1, d: path.slice(), rule: rule === 'evenodd' ? 'evenodd' : 'nonzero', parent: clip }); clip = clips.length; },
    save() { stack.push(clip); },
    restore() { if (stack.length) clip = stack.pop(); },
  };
  const ctx = new Proxy(real, {
    get(t, k) {
      if (Object.hasOwn(hooks, k)) return (...a) => { hooks[k](...a); return t[k](...a); };
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, list, clips, unsupported };
}
