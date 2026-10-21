// Exploration Maps 3D: brand colours picked from a logo, loaded when a logo is added (studio.js setLogo).
const lumOf = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
function hslOf([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; }
const contrastWhite = (rgb) => 1.05 / (lumOf(rgb) + 0.05);
// Primary: the most common logo colour dark enough for text on white (darkened if none is).
// Accent: the most common saturated colour with a different hue; one-colour logos use it for both.
export function brandFromLogo(img) {
  const c = document.createElement('canvas'), n = 80, r = (img.naturalWidth / img.naturalHeight) || 1;
  c.width = r >= 1 ? n : Math.max(8, Math.round(n * r)); c.height = r >= 1 ? Math.max(8, Math.round(n / r)) : n;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
  let data; try { data = g.getImageData(0, 0, c.width, c.height).data; } catch { return null; }
  const bins = new Map(); let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; const R = data[i], Gc = data[i + 1], B = data[i + 2];
    if (Math.min(R, Gc, B) > 225) continue;
    const key = ((R >> 4) << 8) | ((Gc >> 4) << 4) | (B >> 4), b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += R; b.g += Gc; b.b += B; bins.set(key, b); total++;
  }
  const cols = [...bins.values()].filter((b) => b.n >= Math.max(2, total * 0.004)).map((b) => { const rgb = [b.r / b.n, b.g / b.n, b.b / b.n]; return { n: b.n, rgb, hsl: hslOf(rgb), con: contrastWhite(rgb) }; }).sort((a, b) => b.n - a.n);
  if (!cols.length) return null;
  let primary = cols.find((x) => x.con >= 4.5 && x.n >= cols[0].n * 0.12);
  if (!primary) { let rgb = cols[0].rgb.slice(); for (let i = 0; i < 30 && contrastWhite(rgb) < 4.5; i++) rgb = rgb.map((v) => v * 0.9); primary = { rgb, hsl: hslOf(rgb) }; }
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const sat = cols.filter((x) => x.hsl[1] >= 0.35 && x.hsl[2] > 0.2 && x.hsl[2] < 0.78 && x.n >= total * 0.02);
  let accent = sat.find((x) => primary.hsl[1] < 0.2 || hueGap(x.hsl[0], primary.hsl[0]) >= 25), note;
  if (accent) note = 'Colours picked from your logo. Change them if they are not quite right.';
  else if (sat.length) { accent = sat[0]; note = 'Your logo has one main colour, so it is used for both.'; }
  else { accent = primary; note = 'Your logo has no strong colour, so the dark logo colour is used for both. Pick an accent if you have one.'; }
  return { primary: toHex(primary.rgb), accent: toHex(accent.rgb), note };
}
