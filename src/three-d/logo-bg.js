// Logo background removal in /3d, with the shared src/utils/logoBackground.js: EM3D.setLogo(src, { removeBackground })
// and the Brand step's toggle, offered (off until ticked) when a logo added there has a white or flat background, with
// a preview of the logo without it on a checkerboard. Loaded with the first logo added in the Brand step or the first
// removal asked for, so a figure never fetches it otherwise.
import { logoWithoutBackground } from '../utils/logoBackground.js';

const $ = (id) => document.getElementById(id);
// The logo as added (so the toggle can put it back) and whether its background is removed.
export const state = { src: null, removed: false };
const imageOf = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('That logo could not be read. Use a PNG, JPG or SVG.')); im.src = src; });

export function render() { $('logo-bg-on').checked = state.removed; if (!state.src) $('logo-bg').hidden = true; }
// setLogo: studio.js's, given the logo with its background removed (or as it is when none is found).
export async function set(setLogo, status, src, opts) {
  const r = logoWithoutBackground(await imageOf(src));
  await setLogo(r.found ? r.canvas.toDataURL('image/png') : src, { ...opts, removeBackground: false, keep: true });
  Object.assign(state, { src, removed: !!r.found }); render();
  if (!r.found) status('No white or flat background found round the logo: kept as it is.');
}
let wired = false;
export async function offer(setLogo, status, src) {
  Object.assign(state, { src, removed: false }); const r = logoWithoutBackground(await imageOf(src)); $('logo-bg').hidden = !r.found; if (!r.found) return;
  const pv = $('logo-bg-prev'); pv.innerHTML = ''; r.canvas.setAttribute('aria-label', 'Your logo without its background'); pv.appendChild(r.canvas); render();
  if (!wired) { wired = true; $('logo-bg-on').addEventListener('change', (e) => setLogo(state.src, { removeBackground: e.target.checked, autoColor: false, keep: true }).catch((err) => status(err.message))); }
}
