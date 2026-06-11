import React, { useEffect, useMemo, useRef, useState } from 'react';
import AnnotationOverlay from './AnnotationOverlay';
import CalloutsOverlay from './CalloutsOverlay';
import ShadeOverlay from './ShadeOverlay';
import LocatorInset from './LocatorInset';
import ScaleBar from './ScaleBar';
import NorthArrow from './NorthArrow';
import { getTemplate } from '../templates';
import { buildLegendItems, resolveTemplateZones } from '../templates/technicalResultsTemplate';
import { resolveNI43101Zones } from '../templates/technicalReportTemplate';
import { resolveSidePanelZones } from '../templates/sidePanelTemplate';
import { getThemeTokens } from '../utils/themeTokens';
import { fitProjectToTemplate } from '../utils/frameMapForTemplate';

const MapCanvas = React.lazy(() => import('./MapCanvas'));

// ── Helpers (mirrored from App.jsx) ──────────────────────────────────────────

function zoneStyle(zone) {
  if (!zone || !zone.width || !zone.height) return { display: 'none' };
  return { position: 'absolute', top: zone.top, left: zone.left, width: zone.width, height: zone.height, zIndex: 400 };
}

// Legend swatch fill: keep the border visible even when the layer has no fill
function legendFillRgba(hex, alpha) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderLegendGroups(items, layout) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && items.length <= 2);
  if (compact) return [{ heading: null, items }];
  const groups = [];
  for (const item of items) {
    const heading = item.group || 'Map Data';
    let bucket = groups.find((g) => g.heading === heading);
    if (!bucket) { bucket = { heading, items: [] }; groups.push(bucket); }
    bucket.items.push(item);
  }
  return groups;
}

function LegendPointSwatch({ style }) {
  const shape = style?.markerShape || 'circle';
  const fill = style?.markerFill || style?.markerColor || '#ffffff';
  const stroke = style?.markerColor || '#111111';
  const sw = 1.5;
  let inner;
  if (shape === 'triangle_down') inner = <polygon points="6,11 1,1 11,1" fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (shape === 'triangle') inner = <polygon points="6,1 11,11 1,11" fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (shape === 'square') inner = <rect x="1" y="1" width="10" height="10" fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (shape === 'diamond') inner = <polygon points="6,1 11,6 6,11 1,6" fill={fill} stroke={stroke} strokeWidth={sw} />;
  else if (shape === 'cross') inner = <><line x1="6" y1="1" x2="6" y2="11" stroke={stroke} strokeWidth={2} /><line x1="1" y1="6" x2="11" y2="6" stroke={stroke} strokeWidth={2} /></>;
  else if (shape === 'drillhole') inner = <><polygon points="6,1 11,7 1,7" fill={fill} stroke={stroke} strokeWidth={sw} /><line x1="6" y1="7" x2="6" y2="11" stroke={stroke} strokeWidth={sw} /></>;
  else if (shape === 'star') {
    const pts = Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2; const r = i % 2 === 0 ? 5 : 2.2; return `${(6 + r * Math.cos(a)).toFixed(2)},${(6 + r * Math.sin(a)).toFixed(2)}`; }).join(' ');
    inner = <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />;
  } else inner = <circle cx="6" cy="6" r="5" fill={fill} stroke={stroke} strokeWidth={sw} />;
  return <svg width="14" height="14" viewBox="0 0 12 12" style={{ flexShrink: 0, overflow: 'visible' }} aria-hidden="true">{inner}</svg>;
}

// ── NI 43-101 UTM grid overlay helpers ───────────────────────────────────────

function _haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function _latlngToUTM(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const cm = (zone - 1) * 6 - 180 + 3;
  const a = 6378137, f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const k0 = 0.9996;
  const latR = lat * Math.PI / 180;
  const dLng = (lng - cm) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = e2 / (1 - e2) * Math.cos(latR) ** 2;
  const A = dLng * Math.cos(latR);
  const e1sq = e2 / (1 - e2);
  const M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * latR - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*latR) + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*latR) - (35*e2**3/3072) * Math.sin(6*latR));
  const easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*e1sq)*A**5/120) + 500000;
  const northing = k0 * (M + N*Math.tan(latR)*(A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*e1sq)*A**6/720)) + (lat < 0 ? 10000000 : 0);
  return { easting, northing, zone };
}
function _pickUTMInterval(totalM, count) {
  const steps = [500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
  const target = totalM / count;
  return steps.find((s) => s >= target) || steps[steps.length - 1];
}
function _fmtUTMEasting(e) { const s = Math.round(e).toString().padStart(6, '0'); return s.slice(0, -3) + ' ' + s.slice(-3) + 'E'; }
function _fmtUTMNorthing(n) { const s = Math.round(n).toString(); if (s.length <= 6) return s.slice(0, -3) + ' ' + s.slice(-3) + 'N'; return s.slice(0, -6) + ' ' + s.slice(-6, -3) + ' ' + s.slice(-3) + 'N'; }

function NIMapOverlay({ map, mapSize, layout }) {
  const [, setV] = useState(0);
  useEffect(() => {
    if (!map) return;
    const bump = () => setV((v) => v + 1);
    map.on('moveend zoomend', bump);
    return () => map.off('moveend zoomend', bump);
  }, [map]);

  if (!map || !mapSize) return null;
  const STRIP_H = 72, TICK_M = 28;
  const stageW = mapSize.width || 1000, stageH = mapSize.height || 600;
  const stripPos = layout.titleStripPosition || 'bottom';
  const mapTop = TICK_M + (stripPos === 'top' ? STRIP_H : 0);
  const mapBottom = stageH - TICK_M - (stripPos === 'bottom' ? STRIP_H : 0);
  const mapLeft = TICK_M, mapRight = stageW - TICK_M;
  const mapW = mapRight - mapLeft, mapH = mapBottom - mapTop;
  const size = map.getSize();
  if (!size || size.x === 0 || size.y === 0) return null;
  const cy = size.y / 2, cx = size.x / 2;
  const centerLL = map.getCenter();
  const leftLL = map.containerPointToLatLng([0, cy]);
  const rightLL = map.containerPointToLatLng([size.x, cy]);
  const topLL = map.containerPointToLatLng([cx, 0]);
  const botLL = map.containerPointToLatLng([cx, size.y]);
  const totalW = _haversineM(leftLL.lat, leftLL.lng, rightLL.lat, rightLL.lng);
  const totalH = _haversineM(topLL.lat, topLL.lng, botLL.lat, botLL.lng);
  const xInt = _pickUTMInterval(totalW, 6), yInt = _pickUTMInterval(totalH, 5);
  const centerUTM = _latlngToUTM(centerLL.lat, centerLL.lng);
  const { zone } = centerUTM;
  const cm = (zone - 1) * 6 - 180 + 3;
  const a = 6378137, f = 1 / 298.257223563, e2 = 2 * f - f * f, k0 = 0.9996;
  const refLatR = centerLL.lat * Math.PI / 180;
  const N_ref = a / Math.sqrt(1 - e2 * Math.sin(refLatR) ** 2);
  const topUTM = _latlngToUTM(topLL.lat, topLL.lng), botUTM = _latlngToUTM(botLL.lat, botLL.lng);
  const monoFont = "'Courier New', Courier, monospace", fontSize = 9;
  const xTicks = [];
  const leftE_cz = 500000 + k0 * N_ref * Math.cos(refLatR) * (leftLL.lng - cm) * (Math.PI / 180);
  const rightE_cz = 500000 + k0 * N_ref * Math.cos(refLatR) * (rightLL.lng - cm) * (Math.PI / 180);
  const startE = Math.ceil(leftE_cz / xInt) * xInt;
  for (let e = startE; e <= rightE_cz + xInt * 0.1; e += xInt) {
    const dE = e - 500000;
    const lng = cm + (dE / (k0 * N_ref * Math.cos(refLatR))) * (180 / Math.PI);
    const pt = map.latLngToContainerPoint([centerLL.lat, lng]);
    const px = Math.round(pt.x * (mapW / size.x)) + mapLeft;
    if (px < mapLeft - 1 || px > mapRight + 1) continue;
    const lbl = _fmtUTMEasting(e);
    xTicks.push(<g key={e}><line x1={px} y1={mapTop} x2={px} y2={mapTop - 8} stroke="#000" strokeWidth="1" /><line x1={px} y1={mapBottom} x2={px} y2={mapBottom + 8} stroke="#000" strokeWidth="1" /><text x={px} y={mapTop - 10} textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000">{lbl}</text><text x={px} y={mapBottom + 10} textAnchor="middle" dominantBaseline="hanging" fontFamily={monoFont} fontSize={fontSize} fill="#000">{lbl}</text></g>);
  }
  const yTicks = [];
  const startN = Math.floor(topUTM.northing / yInt) * yInt;
  for (let n = startN; n >= botUTM.northing - yInt * 0.1; n -= yInt) {
    const lat = centerLL.lat + (n - centerUTM.northing) / 111132;
    const pt = map.latLngToContainerPoint([lat, centerLL.lng]);
    const py = Math.round(pt.y * (mapH / size.y)) + mapTop;
    if (py < mapTop - 1 || py > mapBottom + 1) continue;
    const lbl = _fmtUTMNorthing(n);
    yTicks.push(<g key={n}><line x1={mapLeft} y1={py} x2={mapLeft - 8} y2={py} stroke="#000" strokeWidth="1" /><line x1={mapRight} y1={py} x2={mapRight + 8} y2={py} stroke="#000" strokeWidth="1" /><text textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000" transform={`translate(${mapLeft - 10},${py}) rotate(-90)`}>{lbl}</text><text textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000" transform={`translate(${mapRight + 10},${py}) rotate(90)`}>{lbl}</text></g>);
  }
  return <svg style={{ position: 'absolute', top: 0, left: 0, width: stageW, height: stageH, pointerEvents: 'none', zIndex: 391 }}>{xTicks}{yTicks}</svg>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReadOnlyMapStage({ project }) {
  const containerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [mapSize, setMapSize] = useState({ width: 800, height: 600 });
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setMapSize({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const template = useMemo(
    () => getTemplate(project.layout?.templateId || 'technical_results_v2'),
    [project.layout?.templateId]
  );
  const legendItems = useMemo(
    () => buildLegendItems(template, project.layers, project.layout),
    [template, project.layers, project.layout]
  );
  const legendGroups = useMemo(() => renderLegendGroups(legendItems, project.layout), [legendItems, project.layout]);
  const resolvedZones = useMemo(() => {
    if (project.layout?.templateId === 'ni_43101_technical') return resolveNI43101Zones(template, project.layout, mapSize, legendItems);
    if (project.layout?.templateId === 'side_panel') return resolveSidePanelZones(template, project.layout, mapSize, legendItems);
    return resolveTemplateZones(template, project.layout, mapSize, legendItems);
  }, [template, project.layout, mapSize, legendItems]);

  const themeTokens = useMemo(() => {
    const layout = project.layout || {};
    const base = getThemeTokens(layout.themeId || 'investor_clean');
    const { accentColor, titleBgColor, titleFgColor, panelBgColor, panelFgColor } = layout;
    const overrides = {};
    if (accentColor) { overrides.titleAccent = accentColor; overrides.calloutBorder = accentColor; }
    if (titleBgColor) overrides.titleFill = titleBgColor;
    if (titleFgColor) { overrides.titleText = titleFgColor; overrides.subtitleText = titleFgColor + 'bb'; }
    if (panelBgColor) {
      overrides.panelFill = panelBgColor; overrides.northArrowFill = panelBgColor;
      overrides.scaleFill = panelBgColor; overrides.insetFill = panelBgColor;
      overrides.logoFill = panelBgColor; overrides.footerFill = panelBgColor;
      overrides.calloutFill = panelBgColor;
    }
    if (panelFgColor) {
      overrides.bodyText = panelFgColor; overrides.panelTitle = panelFgColor;
      overrides.northArrowText = panelFgColor; overrides.scaleStroke = panelFgColor;
      overrides.insetTitle = panelFgColor; overrides.insetMuted = panelFgColor + 'aa';
      overrides.footerText = panelFgColor; overrides.calloutText = panelFgColor;
      overrides.mutedText = panelFgColor + 'aa';
    }
    return Object.keys(overrides).length ? { ...base, ...overrides } : base;
  }, [project.layout?.themeId, project.layout?.accentColor, project.layout?.titleBgColor, project.layout?.titleFgColor, project.layout?.panelBgColor, project.layout?.panelFgColor]);

  const mapStageStyle = {
    '--template-radius': `${themeTokens.panelRadius}px`,
    '--title-radius': `${themeTokens.titleRadius}px`,
    '--panel-bg': themeTokens.panelFill,
    '--panel-border': themeTokens.panelBorder,
    '--panel-shadow': themeTokens.panelShadow,
    '--title-bg': themeTokens.titleFill,
    '--title-border': themeTokens.titleBorder,
    '--title-accent': themeTokens.titleAccent || 'transparent',
    '--title-fg': themeTokens.titleText,
    '--subtitle-fg': themeTokens.subtitleText,
    '--panel-title': themeTokens.panelTitle,
    '--body-text': themeTokens.bodyText,
    '--muted-text': themeTokens.mutedText,
    '--footer-bg': themeTokens.footerFill,
    '--footer-fg': themeTokens.footerText,
    '--callout-bg': themeTokens.calloutFill,
    '--callout-border': themeTokens.calloutBorder,
    '--callout-fg': themeTokens.calloutText,
    '--north-fill': themeTokens.northArrowFill,
    '--north-fg': themeTokens.northArrowText,
    '--scale-bg': themeTokens.scaleFill,
    '--scale-stroke': themeTokens.scaleStroke,
    '--inset-bg': themeTokens.insetFill,
    '--inset-border': themeTokens.insetBorder,
    '--inset-title': themeTokens.insetTitle,
    '--inset-muted': themeTokens.insetMuted,
    '--logo-bg': themeTokens.logoFill,
    '--logo-border': themeTokens.logoBorder,
    '--font-title': `${project.layout.fonts?.title || 'Inter'}, sans-serif`,
    '--font-legend': `${project.layout.fonts?.legend || 'Inter'}, sans-serif`,
    '--font-label': `${project.layout.fonts?.label || 'Inter'}, sans-serif`,
    '--font-callout': `${project.layout.fonts?.callout || 'Inter'}, sans-serif`,
    '--font-footer': `${project.layout.fonts?.footer || 'Inter'}, sans-serif`,
    width: '100%',
    height: '100%',
  };

  // Fit to bounds once when map is first ready
  useEffect(() => {
    if (!map || fittedRef.current) return;
    fittedRef.current = true;
    fitProjectToTemplate(project, map, { ...template, zones: resolvedZones }, 'balanced', { focusRoles: true });
  }, [map, project, template, resolvedZones]);

  const layout = project.layout || {};

  // NI 43-101 strip values
  const STRIP_H = 72;
  const niStripPos = layout.titleStripPosition || 'bottom';
  const niStageH = mapSize?.height || 600;
  const niStageW = mapSize?.width || 1000;
  const niStripY = niStripPos === 'bottom' ? niStageH - STRIP_H : 0;
  const niMapTop = 28 + (niStripPos === 'top' ? STRIP_H : 0);
  const niMapBottom = niStageH - 28 - (niStripPos === 'bottom' ? STRIP_H : 0);
  const niFs = Math.max(0.7, Math.min(1.4, Number(layout.stripFontScale || 1)));
  const monoFont = "'Courier New', Courier, monospace";

  return (
    <div
      ref={containerRef}
      className="map-stage"
      data-theme={layout.themeId || 'modern_rounded'}
      data-title-accent-style={themeTokens.titleAccentStyle || 'top'}
      style={mapStageStyle}
    >
      <React.Suspense fallback={null}>
        <MapCanvas
          onReady={(m) => { leafletMapRef.current = m; setMap(m); }}
          project={project}
          template={template}
          onFeatureClick={null}
          onMapClick={null}
          annotationToolRef={{ current: null }}
        />
      </React.Suspense>

      {map && (
        <>
          <AnnotationOverlay
            map={map}
            markers={project.markers || []}
            ellipses={project.ellipses || []}
            polygons={project.polygons || []}
            pendingPolygon={null}
            selectedMarkerId={null}
            selectedEllipseId={null}
            selectedPolygonId={null}
            onSelectMarker={null}
            onSelectEllipse={null}
            onSelectPolygon={null}
            onMoveMarker={null}
            onMoveEllipse={null}
            onMoveLabelOffset={null}
            onMoveEllipseLabelOffset={null}
            onMoveEllipseLabelAngle={null}
            onMovePolygonLabel={null}
            labelFont={layout.fonts?.label}
            pendingDistanceP1={null}
            distanceLines={project.distanceLines || []}
            selectedDistanceLineId={null}
            onSelectDistanceLine={null}
            onRemoveDistanceLine={null}
          />
          <CalloutsOverlay
            map={map}
            callouts={project.callouts || []}
            selectedCalloutId={null}
            onSelect={null}
            onMove={null}
            onUpdate={null}
            fontFamily={layout.fonts?.callout}
          />
        </>
      )}

      <ShadeOverlay map={map} ellipses={project.ellipses || []} polygons={project.polygons || []} />

      {/* NI 43-101 template */}
      {layout.templateId === 'ni_43101_technical' && (() => {
        const scaleDisplay = layout.manualScaleDenom
          ? '1:' + Number(String(layout.manualScaleDenom).replace(/[^0-9]/g, '')).toLocaleString()
          : 'Auto';
        const utmZone = (() => {
          try { const c = map?.getCenter(); if (!c) return 'WGS84'; const z = Math.floor((c.lng + 180) / 6) + 1; return `WGS84 / UTM Zone ${z}${c.lat >= 0 ? 'N' : 'S'}`; } catch { return 'WGS84'; }
        })();
        return (
          <>
            <div style={{ position: 'absolute', top: niMapTop, left: 0, width: 28, height: niMapBottom - niMapTop, background: '#fff', borderRight: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: niMapTop, left: niStageW - 28, width: 28, height: niMapBottom - niMapTop, background: '#fff', borderLeft: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 0, left: 0, width: niStageW, height: niMapTop, background: '#fff', borderBottom: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: niMapBottom, left: 0, width: niStageW, height: niStageH - niMapBottom - STRIP_H, background: '#fff', borderTop: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
            <NIMapOverlay map={map} mapSize={mapSize} layout={layout} />
            <div style={{ position: 'absolute', left: 0, top: niStripY, width: niStageW, height: STRIP_H, background: '#fff', border: '1.5px solid #000', boxSizing: 'border-box', zIndex: 410, display: 'flex', fontFamily: monoFont }}>
              <div style={{ flex: '0 0 45%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 8 * niFs, fontWeight: 700, color: '#000', marginBottom: 2 }}>TITLE</div>
                {layout.stripTitle && <div style={{ fontSize: 14 * niFs, fontWeight: 700, fontFamily: 'Arial, sans-serif', color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layout.stripTitle}</div>}
                {layout.stripSubtitle && <div style={{ fontSize: 9 * niFs, fontFamily: 'Arial, sans-serif', color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layout.stripSubtitle}</div>}
              </div>
              <div style={{ flex: '0 0 20%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 7 * niFs, fontWeight: 700, color: '#000', marginBottom: 1 }}>SCALE</div>
                <div style={{ fontSize: 10 * niFs, color: '#000', marginBottom: 4 }}>{scaleDisplay}</div>
                <div style={{ fontSize: 7 * niFs, fontWeight: 700, color: '#000', marginBottom: 1 }}>PROJECTION</div>
                <div style={{ fontSize: 8 * niFs, color: '#000' }}>{layout.projectionName || utmZone}</div>
              </div>
              <div style={{ flex: '0 0 20%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 7 * niFs, fontWeight: 700, color: '#000', marginBottom: 1 }}>QUALIFIED PERSON</div>
                <div style={{ fontSize: 10 * niFs, color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layout.qpName || '—'}</div>
                {layout.qpCredentials && <div style={{ fontSize: 8 * niFs, color: '#000' }}>{layout.qpCredentials}</div>}
                {layout.companyName && <div style={{ fontSize: 7 * niFs, color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layout.companyName}</div>}
              </div>
              <div style={{ flex: '0 0 15%', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 7 * niFs, fontWeight: 700, color: '#000', marginBottom: 1 }}>FIGURE</div>
                <div style={{ fontSize: 12 * niFs, fontWeight: 700, color: '#000' }}>{layout.figureNumber || '—'}</div>
                {layout.figureRevision && <div style={{ fontSize: 8 * niFs, color: '#000' }}>{layout.figureRevision}</div>}
                {layout.mapDate && <div style={{ fontSize: 7 * niFs, color: '#444' }}>{layout.mapDate}</div>}
              </div>
            </div>
          </>
        );
      })()}

      {/* Side panel sidebar background */}
      {layout.templateId === 'side_panel' && resolvedZones.sidebar?.width > 0 && (
        <div style={{
          position: 'absolute', top: resolvedZones.sidebar.top, left: resolvedZones.sidebar.left,
          width: resolvedZones.sidebar.width, height: resolvedZones.sidebar.height,
          background: 'var(--panel-fill, #ffffff)', borderLeft: '1.5px solid var(--panel-border, #d4deea)',
          zIndex: 4, pointerEvents: 'none',
        }} />
      )}

      {/* Title card */}
      {layout.templateId !== 'ni_43101_technical' && layout.showTitle !== false && (
        <div className="template-zone" style={{ ...zoneStyle(resolvedZones.title), zIndex: 410 }}>
          <div className={`template-card title-card${layout.titleTransparent ? ' panel--transparent' : ''}`}>
            <h2 style={{ fontSize: Math.round(22 * (layout.titleFontScale ?? 1)) + 'px' }}>{layout.title}</h2>
            <p style={{ fontSize: Math.round(12 * (layout.titleFontScale ?? 1)) + 'px' }}>{layout.subtitle}</p>
            {(() => {
              const meta = [layout.mapDate, layout.projectNumber, layout.mapScaleNote].filter(Boolean);
              return meta.length ? <div className="title-meta-row" style={{ fontSize: Math.round(10 * (layout.titleFontScale ?? 1)) + 'px' }}>{meta.join('  ·  ')}</div> : null;
            })()}
          </div>
        </div>
      )}

      {/* Legend card */}
      {legendItems.length > 0 && layout.showLegend !== false && (
        <div className="template-zone" style={zoneStyle(resolvedZones.legend)}>
          <div className={`template-card legend-card${layout.legendTransparent ? ' panel--transparent' : ''}`}>
            <div className="legend-header"><h3 style={{ fontSize: Math.round(15 * (layout.legendFontScale ?? 1)) + 'px' }}>Legend</h3></div>
            <div className="legend-list" style={{ fontSize: Math.round(13 * (layout.legendFontScale ?? 1)) + 'px' }}>
              {legendGroups.map((group) => (
                <div key={group.heading || 'all'} className="legend-group">
                  {group.heading ? <div className="legend-group-title">{group.heading}</div> : null}
                  {group.items.map((item) => (
                    <div key={item.id} className="legend-item">
                      {item.type === 'points' ? (
                        <LegendPointSwatch style={item.style} />
                      ) : item.type === 'line' ? (
                        <svg className="legend-line-svg" width="22" height="12" aria-hidden="true" style={{ flexShrink: 0 }}>
                          <line x1="0" y1="6" x2="22" y2="6" stroke={item.style.stroke || '#333'} strokeWidth={Math.min(item.style.strokeWidth ?? 2, 3)} strokeDasharray={item.style.dashArray || ''} />
                        </svg>
                      ) : (
                        <span className="legend-swatch" style={{ borderColor: item.style.stroke || '#3b82f6', borderStyle: item.style.dashArray ? 'dashed' : 'solid', background: legendFillRgba(item.style.fill || '#93c5fd', item.style.fillOpacity ?? 1) }} />
                      )}
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* North arrow */}
      {layout.showNorthArrow !== false && resolvedZones.northArrow?.width > 0 && (
        <div className="template-zone" style={zoneStyle(resolvedZones.northArrow)}>
          <NorthArrow scale={layout.northArrowHeightPx ?? 100} />
        </div>
      )}

      {/* Locator inset */}
      {layout.insetEnabled !== false && resolvedZones.inset?.width ? (
        <div className="template-zone" style={zoneStyle(resolvedZones.inset)}>
          <LocatorInset
            layers={project.layers}
            insetMode={layout.insetMode}
            insetImage={layout.insetImage}
            autoInsetRegion={layout.autoInsetRegion}
            insetTitle={layout.insetTitle}
            insetLabel={layout.insetLabel}
            mode={layout.mode}
            zone={{ width: '100%', height: '100%' }}
            regionFill={layout.insetRegionFill}
            regionStroke={layout.insetRegionStroke}
            bgFill={layout.insetBgFill}
            markerColor={layout.insetMarkerColor}
          />
        </div>
      ) : null}

      {/* Scale bar */}
      {layout.showScaleBar !== false && (
        <div className="template-zone" style={{ ...zoneStyle(resolvedZones.scaleBar), width: layout.scaleBarWidthPx || resolvedZones.scaleBar?.width }}>
          <ScaleBar map={map} height={layout.scaleBarHeightPx ?? 48} />
        </div>
      )}

      {/* Footer */}
      {layout.templateId !== 'ni_43101_technical' && layout.footerText && layout.footerEnabled !== false && (
        <div className="template-zone" style={{ ...zoneStyle(resolvedZones.footer), zIndex: 408, height: layout.footerHeightPx || resolvedZones.footer?.height }}>
          <div className="template-card footer-card">{layout.footerText}</div>
        </div>
      )}

      {/* Logo */}
      {layout.logo && (
        <div className="template-zone" style={zoneStyle(resolvedZones.logo)}>
          <div className={`template-card logo-card${layout.logoTransparent ? ' panel--transparent' : ''}`}>
            <img src={layout.logo} alt="Logo" />
          </div>
        </div>
      )}
    </div>
  );
}
