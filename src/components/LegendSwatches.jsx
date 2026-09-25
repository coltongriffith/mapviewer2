import React from 'react';
import { resolvePointSymbol, symbolPath } from '../utils/pointSymbol.js';
import { isNearWhite, LIGHT_SWATCH_EDGE } from '../utils/legendCustomization.js';

// Legend swatches for the editor stage and the shared (read-only) map — one
// copy, so the two cannot drift apart again (each used to carry its own).

// Colours reach the legend from saved projects; keep them to colour syntax.
function safeColor(v, fallback) {
  return typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i.test(v.trim()) ? v : fallback;
}


function fillRgba(hex, alpha) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return safeColor(hex, '#93c5fd');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Same geometry, fill and stroke as the map symbol (utils/pointSymbol.js). The
// old icon drew a star as an unfilled outline, so a filled star on the map read
// as a thin border in the legend.
export function LegendPointSwatch({ style, size = 14 }) {
  if (style?.customMarkerDataUri) {
    return (
      <span className="legend-symbol-marker" style={{ display: 'flex', flexShrink: 0 }}>
        <img src={style.customMarkerDataUri} alt="" width={size} height={size} style={{ objectFit: 'contain' }} draggable={false} />
      </span>
    );
  }
  const sym = resolvePointSymbol({ ...(style || {}), markerSize: size, strokeWidth: Math.min(1.5, Number(style?.strokeWidth) || 1.5) });
  const box = size + 3;
  const c = box / 2;
  const light = isNearWhite(sym.stroke) && isNearWhite(sym.fill);
  return (
    <span className="legend-symbol-marker" style={{ display: 'flex', flexShrink: 0, width: 18, justifyContent: 'center' }}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
        {light ? <path d={symbolPath(sym.shape, c, c, size / 2)} fill="none" stroke={LIGHT_SWATCH_EDGE} strokeWidth={sym.strokeWidth + 1.5} strokeLinejoin="round" /> : null}
        <path d={symbolPath(sym.shape, c, c, size / 2)} fill={safeColor(sym.fill, '#ffffff')} stroke={safeColor(sym.stroke, '#111111')} strokeWidth={sym.strokeWidth} strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function LegendLineSwatch({ style = {} }) {
  const stroke = safeColor(style.stroke, '#333333');
  const w = Math.min(style.strokeWidth ?? 2, 3);
  return (
    <svg className="legend-line-svg" width="22" height="12" aria-hidden="true" style={{ flexShrink: 0 }}>
      {isNearWhite(stroke) ? <line x1="0" y1="6" x2="22" y2="6" stroke={LIGHT_SWATCH_EDGE} strokeWidth={w + 2} /> : null}
      <line x1="0" y1="6" x2="22" y2="6" stroke={stroke} strokeWidth={w} strokeDasharray={style.dashArray || ''} />
    </svg>
  );
}

export function LegendAreaSwatch({ style = {} }) {
  const stroke = style.stroke || '#3b82f6';
  return (
    <span
      className="legend-swatch"
      style={{
        borderColor: safeColor(stroke, '#3b82f6'),
        borderStyle: style.dashArray ? 'dashed' : 'solid',
        background: fillRgba(style.fill || '#93c5fd', style.fillOpacity ?? 1),
        ...(isNearWhite(stroke) ? { boxShadow: `0 0 0 1px ${LIGHT_SWATCH_EDGE}` } : {}),
      }}
    />
  );
}
