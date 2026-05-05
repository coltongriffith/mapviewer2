import { safeColor } from './colorUtils.js';

/**
 * SVG path data for custom marker icons.
 * All paths are designed for a 24x24 viewBox, stroke-rendered (fill="none").
 * Using stroke-based paths (like Lucide icons) gives cleaner rendering at small
 * sizes and correct appearance in both the editor and PNG/SVG export.
 * Pickaxe and shovel paths are from Lucide Icons (MIT license).
 */

export const MARKER_ICON_PATHS = {
  pickaxe: {
    viewBox: '0 0 24 24',
    paths: [
      'm14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999',
      'M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024',
      'M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069',
      'M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z',
    ],
  },
  shovel: {
    viewBox: '0 0 24 24',
    paths: [
      'M21.56 4.56a1.5 1.5 0 0 1 0 2.122l-.47.47a3 3 0 0 1-4.212-.03 3 3 0 0 1 0-4.243l.44-.44a1.5 1.5 0 0 1 2.121 0z',
      'M3 22a1 1 0 0 1-1-1v-3.586a1 1 0 0 1 .293-.707l3.355-3.355a1.205 1.205 0 0 1 1.704 0l3.296 3.296a1.205 1.205 0 0 1 0 1.704l-3.355 3.355a1 1 0 0 1-.707.293z',
      'm9 15 7.879-7.878',
    ],
  },
  star: {
    viewBox: '0 0 24 24',
    paths: ['M12 2 L14.4 9.1 L22 9.1 L15.8 13.8 L18.2 21 L12 16.3 L5.8 21 L8.2 13.8 L2 9.1 L9.6 9.1 Z'],
  },
};

/**
 * Returns a React-renderable inline SVG element for a given icon type, size, and color.
 * Used in AnnotationOverlay for the editor view.
 */
export function MarkerSvgIcon({ type, size, color }) {
  const icon = MARKER_ICON_PATHS[type];
  if (!icon) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      {icon.paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/**
 * Returns an SVG string fragment for use in renderScene.js SVG export.
 * x, y are the center coordinates of the marker.
 */
export function markerIconSvgFragment(type, x, y, size, color) {
  const icon = MARKER_ICON_PATHS[type];
  if (!icon) return '';
  const half = size / 2;
  const safeCol = safeColor(color);
  const pathsStr = icon.paths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg x="${x - half}" y="${y - half}" width="${size}" height="${size}" viewBox="${icon.viewBox}" fill="none" stroke="${safeCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${pathsStr}</svg>`;
}

/**
 * Draws a marker icon onto a 2D canvas context at (cx, cy) center.
 * Used in renderScene.js PNG export.
 */
export function drawMarkerIconCanvas(ctx, type, cx, cy, size, color) {
  const icon = MARKER_ICON_PATHS[type];
  if (!icon) return false;

  const safeCol = safeColor(color);
  const pathsStr = icon.paths.map((d) => `<path d="${d}"/>`).join('');
  const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}" fill="none" stroke="${safeCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pathsStr}</svg>`;
  const blob = new Blob([svgSrc], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      URL.revokeObjectURL(url);
      resolve(true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
  });
}
