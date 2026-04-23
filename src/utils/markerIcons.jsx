import { safeColor } from './colorUtils.js';

/**
 * SVG path data for custom marker icons.
 * All paths are designed for a 24x24 viewBox and center-anchored.
 * Using these instead of emoji glyphs gives consistent cross-platform rendering
 * and correct size control in both the editor and PNG/SVG export.
 */

export const MARKER_ICON_PATHS = {
  pickaxe: {
    // Pickaxe: handle diagonal + two-headed blade
    viewBox: '0 0 24 24',
    path: 'M16.5 3.5 C17.5 2.5 19.5 2.5 20.5 3.5 C21.5 4.5 21.5 6.5 20.5 7.5 L14 14 L13 13 Z M3.5 20.5 L12 12 L12.7 12.7 L4.5 21 Z M10 14 L14 10 L14.7 10.7 L10.7 14.7 Z',
  },
  shovel: {
    // Shovel: round blade at bottom, long handle
    viewBox: '0 0 24 24',
    path: 'M12 2 L13.5 3.5 L13.5 13 C15.5 13.5 17 15.2 17 17.2 C17 19.8 14.8 22 12 22 C9.2 22 7 19.8 7 17.2 C7 15.2 8.5 13.5 10.5 13 L10.5 3.5 Z',
  },
  star: {
    // 5-pointed star
    viewBox: '0 0 24 24',
    path: 'M12 2 L14.4 9.1 L22 9.1 L15.8 13.8 L18.2 21 L12 16.3 L5.8 21 L8.2 13.8 L2 9.1 L9.6 9.1 Z',
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
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d={icon.path} />
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
  return `<svg x="${x - half}" y="${y - half}" width="${size}" height="${size}" viewBox="${icon.viewBox}" fill="${safeColor(color)}" xmlns="http://www.w3.org/2000/svg"><path d="${icon.path}" /></svg>`;
}

/**
 * Draws a marker icon onto a 2D canvas context at (cx, cy) center.
 * Used in renderScene.js PNG export.
 */
export function drawMarkerIconCanvas(ctx, type, cx, cy, size, color) {
  const icon = MARKER_ICON_PATHS[type];
  if (!icon) return false;

  // Parse the viewBox to get source dimensions
  const [, , vw, vh] = icon.viewBox.split(' ').map(Number);
  const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}"><path d="${icon.path}" fill="${safeColor(color)}"/></svg>`;
  const blob = new Blob([svgSrc], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  // Return a promise so callers can await
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
