/**
 * SVG path data for custom marker icons.
 * All paths are designed for a 24x24 viewBox and center-anchored.
 * Using these instead of emoji glyphs gives consistent cross-platform rendering
 * and correct size control in both the editor and PNG/SVG export.
 */

export const MARKER_ICON_PATHS = {
  pickaxe: {
    // Mining pickaxe: classic cross-pick head with angled handle.
    // Head runs top-left to bottom-right; spike tip at top-right; hammer face at bottom-left.
    viewBox: '0 0 24 24',
    path: 'M20.5 3.5 C19 2 16.5 2 15 3.5 L12.8 5.7 L10.5 3.5 C9 2 6.5 2 5 3.5 C3.5 5 3.5 7.5 5 9 L7.2 11.2 L3 21 L5.2 21 L8.5 13.5 L10.8 15.8 L4 20.5 L5.5 22 L12 17 L14.3 19.3 C15.8 20.8 18.3 20.8 19.8 19.3 C21.3 17.8 21.3 15.3 19.8 13.8 L17.5 11.5 L19.7 9.3 C21.2 7.8 21.2 5.2 19.8 3.8 Z M16.5 10 L14 7.5 L15.5 6 L18 8.5 Z',
  },
  shovel: {
    // Mining shovel / geologist spade: flat rectangular blade, straight handle, D-grip at top.
    viewBox: '0 0 24 24',
    path: 'M10 2 L14 2 L14 3.5 C15.5 3.5 16.5 4.5 16.5 6 L16.5 7 L7.5 7 L7.5 6 C7.5 4.5 8.5 3.5 10 3.5 Z M8.5 8.5 L15.5 8.5 L15.5 14 L13.5 14 L13.5 20 L15 20 L15 22 L9 22 L9 20 L10.5 20 L10.5 14 L8.5 14 Z',
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
  return `<svg x="${x - half}" y="${y - half}" width="${size}" height="${size}" viewBox="${icon.viewBox}" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="${icon.path}" /></svg>`;
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
  const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}"><path d="${icon.path}" fill="${color}"/></svg>`;
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
