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
import { applyLegendCustomization, groupLegendItems } from '../utils/legendCustomization.js';
import { getMapFrame, scaleBarHeight } from '../utils/coordinateFrame.js';
import CoordinateFrameOverlay from './CoordinateFrameOverlay.jsx';
import { MarkerSvgIcon } from '../utils/markerIcons.jsx';
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

// The shared marker renderer, as in the editable stage.
//
// This was a fifth copy of the shape table and the last one still missing
// hexagon and pin — on the worst possible surface, since a share link is what
// a reader actually receives. An author could pick hexagon in the editor, see
// it in the editor and in the export, and have the public page show a circle.
function LegendPointSwatch({ style, size = 14 }) {
  if (style?.customMarkerDataUri) {
    return (
      <span className="legend-symbol-marker" style={{ display: 'flex', flexShrink: 0 }}>
        <img src={style.customMarkerDataUri} alt="" width={size} height={size} style={{ objectFit: 'contain' }} draggable={false} />
      </span>
    );
  }
  return (
    <span className="legend-symbol-marker" style={{ display: 'flex', flexShrink: 0, width: 18, justifyContent: 'center' }}>
      <MarkerSvgIcon
        type={style?.markerShape || 'circle'}
        size={size}
        color={style?.markerColor || '#111111'}
        fillColor={style?.markerFill || style?.markerColor || '#ffffff'}
      />
    </span>
  );
}

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
  // A shared project has to show the legend its author edited, not the raw
  // derivation — otherwise entries they renamed or removed reappear for the
  // reader.
  const legendItems = useMemo(
    () => applyLegendCustomization(buildLegendItems(template, project.layers, project.layout), project.layout),
    [template, project.layers, project.layout]
  );
  const legendGroups = useMemo(() => groupLegendItems(legendItems, project.layout), [legendItems, project.layout]);
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
    '--font-title': `${project.layout.fonts?.title || 'Inter'}, Arial, Helvetica, sans-serif`,
    '--font-legend': `${project.layout.fonts?.legend || 'Inter'}, Arial, Helvetica, sans-serif`,
    '--font-label': `${project.layout.fonts?.label || 'Inter'}, Arial, Helvetica, sans-serif`,
    '--font-callout': `${project.layout.fonts?.callout || 'Inter'}, Arial, Helvetica, sans-serif`,
    '--font-footer': `${project.layout.fonts?.footer || 'Inter'}, Arial, Helvetica, sans-serif`,
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
  const niFs = Math.max(0.7, Math.min(1.4, Number(layout.stripFontScale || 1)));
  const monoFont = "'Courier New', Courier, monospace";

  return (
    <div
      ref={containerRef}
      className="map-stage"
      data-theme={layout.themeId || 'modern_rounded'}
      data-template={layout.templateId || 'technical_results_v2'}
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

      <CoordinateFrameOverlay map={map} frame={getMapFrame(layout, mapSize, { sidebarFrac: template?.sidebarFrac })} stage={mapSize} />

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
            <div className="legend-header"><h3 style={{ fontSize: Math.round(15 * (layout.legendFontScale ?? 1)) + 'px' }}>{layout.legendTitle || 'Legend'}</h3></div>
            <div className="legend-list" style={{ fontSize: Math.round(13 * (layout.legendFontScale ?? 1)) + 'px' }}>
              {legendGroups.map((group) => (
                <div key={group.heading || 'all'} className="legend-group">
                  {group.heading ? <div className="legend-group-title">{group.heading}</div> : null}
                  {group.items.map((item) => (
                    <div key={item.id} className="legend-item">
                      {item.type === 'points' ? (
                        <LegendPointSwatch style={item.style} size={item.swatchSize || 14} />
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
        <div className={`template-zone${layout.northArrowTransparent ? ' panel--transparent' : ''}`} style={zoneStyle(resolvedZones.northArrow)}>
          <NorthArrow scale={layout.northArrowHeightPx ?? 100} style={layout.northArrowStyle || 'classic'} />
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
        <div className={`template-zone${layout.scaleBarTransparent ? ' panel--transparent' : ''}`} style={{ ...zoneStyle(resolvedZones.scaleBar), width: layout.scaleBarWidthPx || resolvedZones.scaleBar?.width }}>
          <ScaleBar map={map} height={scaleBarHeight(layout)} projection={!!layout.showProjectionLabel} projectionName={layout.projectionName} />
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
