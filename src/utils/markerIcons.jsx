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
 * Generates the inner SVG markup for a geometric marker shape at (cx, cy).
 * Returns an empty string for types handled via MARKER_ICON_PATHS (pickaxe/shovel/star).
 * Used in AnnotationOverlay inline SVG and in renderScene export.
 */
export function markerShapeInner(type, cx, cy, r, color, fillColor) {
  const fc = fillColor || color;
  const sc = color;
  const sw = Math.max(1, r * 0.12);
  switch (type) {
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${r - sw / 2}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    case 'square':
      return `<rect x="${cx - r + sw}" y="${cy - r + sw}" width="${(r - sw) * 2}" height="${(r - sw) * 2}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    case 'triangle':
      return `<polygon points="${cx},${cy - r} ${cx - r * 0.87},${cy + r * 0.5} ${cx + r * 0.87},${cy + r * 0.5}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    case 'triangle_down':
      return `<polygon points="${cx},${cy + r} ${cx - r * 0.87},${cy - r * 0.5} ${cx + r * 0.87},${cy - r * 0.5}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    case 'diamond':
      return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    case 'cross': {
      const t = r * 0.28;
      return `<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="${sc}" stroke-width="${t * 2}" stroke-linecap="round"/>
              <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${sc}" stroke-width="${t * 2}" stroke-linecap="round"/>`;
    }
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        return `${(cx + (r - sw / 2) * Math.cos(a)).toFixed(2)},${(cy + (r - sw / 2) * Math.sin(a)).toFixed(2)}`;
      }).join(' ');
      return `<polygon points="${pts}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>`;
    }
    case 'pin': {
      const cr = r * 0.6;
      const pcy = cy - r * 0.2;
      return `<circle cx="${cx}" cy="${pcy}" r="${cr}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>
              <polygon points="${cx - cr * 0.5},${pcy + cr * 0.45} ${cx + cr * 0.5},${pcy + cr * 0.45} ${cx},${cy + r}" fill="${fc}" stroke="${sc}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }
    case 'drillhole': {
      const tr = r * 0.85;
      return `<polygon points="${cx},${cy - tr} ${cx - tr * 0.82},${cy + tr * 0.5} ${cx + tr * 0.82},${cy + tr * 0.5}" fill="${fc}" stroke="${sc}" stroke-width="${sw}"/>
              <line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="${sc}" stroke-width="${sw * 1.5}" stroke-linecap="round"/>`;
    }
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fc}"/>`;
  }
}

/**
 * Returns a React-renderable inline SVG element for a given icon type, size, and color.
 * Handles both MARKER_ICON_PATHS (vector paths) and geometric shapes.
 * Used in AnnotationOverlay for the editor view.
 */
export function MarkerSvgIcon({ type, size, color, fillColor }) {
  // Path-based icons (pickaxe, shovel, star)
  const icon = MARKER_ICON_PATHS[type];
  if (icon) {
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
  // Geometric shapes — render as a tiny inline SVG so all types display correctly
  const r = size / 2;
  const inner = markerShapeInner(type, r, r, r * 0.82, color, fillColor || color);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/**
 * Returns an SVG string fragment for use in renderScene.js SVG export.
 * x, y are the center coordinates of the marker.
 */
export function markerIconSvgFragment(type, x, y, size, color, fillColor) {
  // Path-based icons
  const icon = MARKER_ICON_PATHS[type];
  if (icon) {
    const half = size / 2;
    const safeCol = safeColor(color);
    const pathsStr = icon.paths.map((d) => `<path d="${d}"/>`).join('');
    return `<svg x="${x - half}" y="${y - half}" width="${size}" height="${size}" viewBox="${icon.viewBox}" fill="none" stroke="${safeCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${pathsStr}</svg>`;
  }
  // Geometric shapes
  return `<g>${markerShapeInner(type, x, y, size / 2, safeColor(color), fillColor ? safeColor(fillColor) : safeColor(color))}</g>`;
}

/**
 * Draws a marker icon onto a 2D canvas context at (cx, cy) center.
 * Used in renderScene.js PNG export.
 */
export function drawMarkerIconCanvas(ctx, type, cx, cy, size, color, fillColor) {
  const safeCol = safeColor(color);
  const safeFill = fillColor ? safeColor(fillColor) : safeCol;

  // Path-based icons — render via SVG image for fidelity
  const icon = MARKER_ICON_PATHS[type];
  if (icon) {
    const pathsStr = icon.paths.map((d) => `<path d="${d}"/>`).join('');
    const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" width="${size}" height="${size}" fill="none" stroke="${safeCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pathsStr}</svg>`;
    const blob = new Blob([svgSrc], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size); URL.revokeObjectURL(url); resolve(true); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });
  }

  // Geometric shapes — draw directly on canvas
  const r = size / 2;
  const sw = Math.max(1, r * 0.12);
  ctx.save();
  ctx.strokeStyle = safeCol;
  ctx.fillStyle = safeFill;
  ctx.lineWidth = sw;
  switch (type) {
    case 'circle':
      ctx.beginPath(); ctx.arc(cx, cy, r - sw / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
    case 'square':
      ctx.beginPath(); ctx.rect(cx - r + sw, cy - r + sw, (r - sw) * 2, (r - sw) * 2); ctx.fill(); ctx.stroke(); break;
    case 'triangle':
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx - r * 0.87, cy + r * 0.5); ctx.lineTo(cx + r * 0.87, cy + r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'triangle_down':
      ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx - r * 0.87, cy - r * 0.5); ctx.lineTo(cx + r * 0.87, cy - r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'diamond':
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'cross':
      ctx.lineWidth = r * 0.55; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke(); break;
    case 'hexagon': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 - Math.PI / 2; const x2 = cx + (r - sw / 2) * Math.cos(a); const y2 = cy + (r - sw / 2) * Math.sin(a); i === 0 ? ctx.moveTo(x2, y2) : ctx.lineTo(x2, y2); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    }
    case 'pin': {
      const cr = r * 0.6; const pcy = cy - r * 0.2;
      ctx.beginPath(); ctx.arc(cx, pcy, cr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - cr * 0.5, pcy + cr * 0.45); ctx.lineTo(cx + cr * 0.5, pcy + cr * 0.45); ctx.lineTo(cx, cy + r); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    }
    case 'drillhole': {
      const tr = r * 0.85;
      ctx.beginPath(); ctx.moveTo(cx, cy - tr); ctx.lineTo(cx - tr * 0.82, cy + tr * 0.5); ctx.lineTo(cx + tr * 0.82, cy + tr * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = sw * 1.5; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); break;
    }
    default:
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); break;
  }
  ctx.restore();
  return Promise.resolve(true);
}
