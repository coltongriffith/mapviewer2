import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { lazyGuarded } from '../utils/preloadGuard';
import {
  studioOn, studioCard, titleCardPrims, scaleCardPrims, northCardPrims, insetCardPrims, studioScaleHome,
  studioMetresPerPx, labelHalo, loadStudioFonts, STUDIO_SHADOW,
} from '../utils/studioCards.js';
import { projectionLabel } from '../utils/coordinateFrame.js';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { visibleGeojson } from '../utils/featureIdentity.js';
import { detectRegion } from '../utils/detectRegion';
const SatelliteInset = lazyGuarded(() => import('./SatelliteInset'));

// The Studio look's cards on the editor stage (and the shared map page), drawn from the same primitives the
// PNG and SVG exporters paint (utils/studioCards.js), inside the template zones the editor drags and resizes.
// kind "style" adds the stage CSS for what stays HTML (the legend card, results cards, label halos) and loads
// Studio's font weights.

const fontFamily = (p) => p.css || `'${p.family || 'Inter'}', Arial, sans-serif`;

// One primitive as React SVG (also the drill plan's, components/DrillPlanOverlay.jsx).
export function Prim({ p, shadowId, clipId }) {
  switch (p.t) {
    case 'rect':
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r || 0} fill={p.fill || 'none'} fillOpacity={p.opacity ?? 1} stroke={p.stroke || undefined} strokeWidth={p.stroke ? p.sw || 1 : undefined} filter={p.shadow && p.fill ? `url(#${shadowId})` : undefined} />;
    case 'path':
      return <path d={p.d} fill={p.fill} />;
    case 'text':
      return (
        <text
          x={p.x} y={p.y} textAnchor={p.anchor || 'start'} fontFamily={fontFamily(p)} fontSize={p.size} fontWeight={p.weight}
          fill={p.fill} fillOpacity={p.opacity ?? 1} letterSpacing={p.ls || undefined} transform={p.rot ? `rotate(${p.rot} ${p.x} ${p.y})` : undefined}
          {...(p.halo ? { stroke: p.halo.color, strokeOpacity: p.halo.opacity, strokeWidth: p.halo.width, strokeLinejoin: 'round', paintOrder: 'stroke' } : {})}
        >{p.s}</text>
      );
    case 'line':
      return <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeOpacity={p.opacity ?? 1} strokeWidth={p.sw || 1} />;
    case 'pline':
      return <polyline points={p.pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={p.stroke} strokeOpacity={p.opacity ?? 1} strokeWidth={p.sw || 1} strokeLinecap={p.cap || 'round'} strokeLinejoin="round" strokeDasharray={p.dash ? p.dash.join(' ') : undefined} />;
    case 'circle':
      return <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill || 'none'} fillOpacity={p.fo ?? 1} stroke={p.stroke || undefined} strokeWidth={p.stroke ? p.sw || 1 : undefined} strokeOpacity={p.opacity ?? 1} />;
    case 'poly':
      return <polygon points={p.pts.map(([x, y]) => `${x},${y}`).join(' ')} fill={p.fill || 'none'} fillOpacity={p.opacity ?? 1} stroke={p.stroke || undefined} strokeWidth={p.stroke ? p.sw || 1 : undefined} strokeLinejoin="round" />;
    case 'image':
      return (
        <>
          <clipPath id={clipId}><rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r || 0} /></clipPath>
          <image href={p.href} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
        </>
      );
    default:
      return null;
  }
}

function Layer({ prims, w, h, id }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy={STUDIO_SHADOW.dy} stdDeviation={STUDIO_SHADOW.blur / 2} floodColor="#101820" floodOpacity="0.2" />
        </filter>
      </defs>
      {prims.map((p, i) => <Prim key={i} p={p} shadowId={`${id}-shadow`} clipId={`${id}-clip-${i}`} />)}
    </svg>
  );
}

// Re-render when the map moves: the scale bar's length and the datum follow the view.
function useMapTick(map, on) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map || !on) return undefined;
    const bump = () => setTick((t) => t + 1);
    map.on('moveend zoomend resize', bump);
    return () => map.off('moveend zoomend resize', bump);
  }, [map, on]);
}

function StudioStyle({ layout }) {
  useEffect(() => { loadStudioFonts(layout); }, [layout.fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const halo = labelHalo(layout), css = [];
  if (halo) {
    const { color, width, opacity } = halo, r = width / 2;
    css.push(`.map-stage text.map-label{stroke:${color};stroke-width:${width}px;stroke-opacity:${opacity};stroke-linejoin:round;paint-order:stroke}`);
    const ring = [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]].map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(',');
    css.push(`.map-stage .map-callout.plain .map-callout-title,.map-stage .map-callout.plain .map-callout-subtext{text-shadow:${ring}}`);
  }
  if (studioOn(layout)) {
    const st = '.map-stage[data-theme="studio"]', drop = `0 ${STUDIO_SHADOW.dy}px ${STUDIO_SHADOW.blur}px ${STUDIO_SHADOW.color}`;
    const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;
    // A card's radius, accent bar (an inset shadow, under the text) and soft shadow; its paper unless the
    // element keeps its own (a callout's colours).
    const shell = (c, paper) => [
      `border-radius:${c.radius}px!important`,
      `box-shadow:${[c.accent === 'left' ? `inset 5px 0 0 ${c.accentColor}` : c.accent === 'top' ? `inset 0 4px 0 ${c.accentColor}` : '', c.shadow ? drop : ''].filter(Boolean).join(',') || 'none'}!important`,
      paper && `background:${c.opacity ? rgba(c.fill, c.opacity) : 'transparent'}!important`,
      paper && `border-color:${c.opacity && c.edge ? c.edge : 'transparent'}!important`,
    ].filter(Boolean).join(';');
    const lg = studioCard(layout, 'legend'), co = studioCard(layout, 'callout'), dark = co.tone === 'dark';
    css.push(`${st} .legend-card{${shell(lg, true)}}${st} .legend-card h3{font-weight:650;color:${lg.head}}${st} .legend-group-title{font-weight:600;letter-spacing:0.08em;color:${lg.muted}}${st} .legend-item,${st} .legend-note{color:${lg.ink}}`);
    // Light results cards keep each callout's own colour (--co-bg, set by CalloutsOverlay) at the card's opacity,
    // as the exporters fill them.
    const coPaper = dark ? '' : `;background:${co.opacity ? `color-mix(in srgb, var(--co-bg) ${Math.round(co.opacity * 100)}%, transparent)` : 'transparent'}!important`;
    css.push(`${st} .map-callout.boxed,${st} .map-callout.leader{${shell(co, dark)}${coPaper}}`);
    if (dark) css.push(`${st} .map-callout.boxed .map-callout-title,${st} .map-callout.leader .map-callout-title{color:#fff!important}${st} .map-callout.boxed .map-callout-subtext,${st} .map-callout.leader .map-callout-subtext{color:rgba(255,255,255,0.78)!important}`);
  }
  return css.length ? <style data-studio-stage="">{css.join('\n')}</style> : null;
}

// The locator card's satellite picture: the inset's own live map, placed exactly in the card's picture area
// so the export captures the same tiles into the same box.
function SatelliteSlot({ slot, layout, layers, onMarker }) {
  return (
    <div style={{ position: 'absolute', left: slot.x, top: slot.y, width: slot.w, height: slot.h, borderRadius: slot.r, overflow: 'hidden', background: '#0b161b' }}>
      <React.Suspense fallback={null}>
        <SatelliteInset layers={layers} region={layout.autoInsetRegion} markerColor={layout.insetMarkerColor} basemap={layout.insetBasemap || 'satellite'} onMarker={onMarker} />
      </React.Suspense>
    </div>
  );
}

// The project's extent, and its province or state: the saved one, else found from the extent as LocatorInset
// finds it (a shared map made outside the editor can arrive without one).
function useRegion(layout, layers, on) {
  const bounds = useMemo(() => unionBounds((layers || []).filter((l) => l.visible !== false && l.geojson).map((l) => geojsonBounds(visibleGeojson(l))).filter(Boolean)), [layers]);
  const [found, setFound] = useState(null);
  const need = on && !layout.autoInsetRegion && !!bounds;
  useEffect(() => {
    if (!need) return undefined;
    let live = true;
    detectRegion(bounds).then((r) => { if (live) setFound(r || null); }).catch(() => {});
    return () => { live = false; };
  }, [need, bounds?.minLng, bounds?.minLat, bounds?.maxLng, bounds?.maxLat]); // eslint-disable-line react-hooks/exhaustive-deps
  return { bounds, region: layout.autoInsetRegion || (need ? found : null) };
}

export default function StudioCard({ kind, layout, zones, map, layers }) {
  const id = `studio-${kind}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [marker, setMarker] = useState(null);
  const { bounds, region } = useRegion(layout, layers, kind === 'inset');
  const onMarker = useCallback((p) => setMarker((m) => (m && Math.abs(m.x - p.x) < 0.5 && Math.abs(m.y - p.y) < 0.5 ? m : { x: p.x, y: p.y })), []);
  useMapTick(map, kind === 'title' || kind === 'scale');
  if (kind === 'style') return <StudioStyle layout={layout} />;
  const zone = zones?.[{ title: 'title', scale: 'scaleBar', north: 'northArrow', inset: 'inset' }[kind]];
  if (!zone?.width || !zone?.height) return null;
  const box = { x: 0, y: 0, w: zone.width, h: zone.height };
  const opts = { metresPerPx: map ? studioMetresPerPx(map) : null, datum: map ? projectionLabel(layout, map) : '' };
  const home = studioScaleHome(layout);
  let prims = [];
  if (kind === 'title') prims = titleCardPrims(layout, box, opts);
  else if (kind === 'scale') prims = home === 'title' ? [] : scaleCardPrims(layout, box, opts);
  else if (kind === 'north') prims = home === 'apart' ? northCardPrims(layout, box) : [];
  else if (kind === 'inset') {
    const mode = layout.insetMode === 'custom_image' ? (layout.insetImage ? 'image' : null) : layout.insetMode === 'satellite_locator' ? 'satellite' : 'region';
    prims = insetCardPrims(layout, box, { mode, image: layout.insetImage, region, bounds, marker: mode === 'satellite' ? marker : null });
  }
  if (!prims.length) return null;
  const at = prims.findIndex((p) => p.t === 'slot');
  return (
    <div className={`studio-card studio-card--${kind}`} style={{ position: 'absolute', inset: 0 }}>
      <Layer prims={at < 0 ? prims : prims.slice(0, at)} w={zone.width} h={zone.height} id={id} />
      {at >= 0 && (
        <>
          <SatelliteSlot slot={prims[at]} layout={layout} layers={layers} onMarker={onMarker} />
          <Layer prims={prims.slice(at + 1)} w={zone.width} h={zone.height} id={`${id}-top`} />
        </>
      )}
    </div>
  );
}
