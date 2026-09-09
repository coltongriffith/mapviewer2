import { hasVisibleFeatures } from '../utils/featureIdentity.js';
import { legendRowCount } from '../utils/legendCustomization.js';
import { TICK_MARGIN, scaleBarHeight } from '../utils/coordinateFrame.js';

const SIDEBAR_FRAC = 0.28;

/**
 * Reading order down the rail: brand, title (which carries the project
 * metadata line), legend, locator, notes.
 *
 * The title used to be appended last, which put the single most important
 * element at the bottom of the panel — below the locator inset. The order is
 * data, not layout code: users can still drag any element to any row, and a
 * saved project keeps whatever order it stored.
 */
export const DEFAULT_SIDE_PANEL_GRID = ['logo', 'title', 'legend', 'inset', 'footer'];

function legendHeightFor(layout, rowCount) {
  const lfs = layout?.legendFontScale ?? 1;
  // Row pitch and chrome measured against what the legend card actually
  // renders (title + 12px rule + 10px gaps + 14px padding top and bottom).
  // The old numbers were a few pixels short per row, so a four-entry legend
  // clipped its last line in the rail and in the export alike.
  const rowH = Math.round(30 * lfs);
  // rowCount already includes one row per group heading when headings are
  // on (legendRowCount), and nothing extra when they are off — a reserved
  // row per group used to pad every legend with dead space.
  return Math.max(60, Math.min(400, 58 + rowCount * rowH));
}

export const sidePanelTemplate = {
  id: 'side_panel',
  label: 'Technical',
  sidebarFrac: SIDEBAR_FRAC,
  frame: { margin: 0, panelRadius: 0 },
  zones: {},
  roleOrder: [
    'claims', 'target_areas', 'anomalies', 'faults_structures',
    'roads_access', 'rivers_water', 'drillholes', 'labels',
  ],
  roleGroups: {
    claims: 'Property', target_areas: 'Targets', anomalies: 'Targets',
    drillholes: 'Drilling', faults_structures: 'Reference',
    roads_access: 'Infrastructure', rivers_water: 'Infrastructure', labels: 'Reference',
  },
  roleStyles: {
    claims: { stroke: '#60a5fa', fill: '#93c5fd', fillOpacity: 0.22, strokeWidth: 2 },
    drillholes: { markerColor: '#1f2937', markerFill: '#ffffff', markerSize: 12, strokeWidth: 1.8 },
    target_areas: { stroke: '#f59e0b', fill: '#fbbf24', fillOpacity: 0.16, strokeWidth: 2.2, dashArray: '8 5' },
    anomalies: { stroke: '#a21caf', fill: '#d946ef', fillOpacity: 0.18, strokeWidth: 2.1 },
    faults_structures: { stroke: '#374151', fill: '#374151', fillOpacity: 0, strokeWidth: 1.8, dashArray: '6 4' },
    roads_access: { stroke: '#7c5e43', fill: '#7c5e43', fillOpacity: 0, strokeWidth: 1.8 },
    rivers_water: { stroke: '#0ea5e9', fill: '#7dd3fc', fillOpacity: 0.16, strokeWidth: 1.8 },
    labels: { stroke: '#0f172a', fill: '#0f172a', fillOpacity: 0, strokeWidth: 1 },
    other: { stroke: '#2563eb', fill: '#93c5fd', fillOpacity: 0.2, strokeWidth: 1.8 },
  },
  modePresets: {
    project_overview: {
      basemap: 'satellite', insetMode: 'province_state', framing: 'balanced',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'anomalies', 'roads_access'],
      referenceOverlays: { context: false, labels: false, rail: false },
    },
    regional_claims: {
      basemap: 'terrain', insetMode: 'country', framing: 'regional',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
      referenceOverlays: { context: false, labels: true, rail: false },
    },
    drill_plan: {
      basemap: 'light', insetMode: 'secondary_zoom', framing: 'tight',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'roads_access'],
      referenceOverlays: { context: false, labels: true, rail: false },
    },
  },
};

export function resolveSidePanelZones(template, layout, mapSize, legendItems) {
  const W = mapSize?.width || 1600;
  const H = mapSize?.height || 1000;
  const sbLeft = Math.round(W * (1 - SIDEBAR_FRAC));
  const sbW = W - sbLeft;
  const margin = 16;
  const innerW = sbW - margin * 2;
  const gap = 10;

  // --- Element heights ---
  const resolvedItems = legendItems || layout?.legendItems || [];
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(H - 320, layout.legendHeightPx))
    : legendHeightFor(layout, legendRowCount(resolvedItems, layout));

  const titleHeight = Math.max(72, Math.min(180, layout?.titleHeightPx ?? 108));
  const logoScale = Math.max(0.7, Math.min(1.2, Number(layout?.logoScale || 1)));
  const logoH = layout?.logo ? (layout?.logoHeightPx ? Math.max(20, Math.min(160, layout.logoHeightPx)) : Math.round(52 * logoScale)) : 0;
  const naH = layout?.northArrowHeightPx ?? 72;
  const naW = Math.round(naH * 0.9);
  const footerH = layout?.footerHeightPx ? Math.max(22, Math.min(200, layout.footerHeightPx)) : 28;
  const scaleBarW = layout?.scaleBarWidthPx || 160;
  const scaleBarActualH = scaleBarHeight(layout);

  // Inset: full inner width, height = 22% of canvas or user-set
  const insetEnabled = layout?.insetEnabled !== false;
  const insetH = layout?.insetHeightPx
    ? Math.max(80, Math.min(300, layout.insetHeightPx))
    : Math.round(H * 0.22);

  // Determine which elements are in the sidebar grid
  const rawGrid = layout?.sidePanelGrid || layout?.sidePanelOrder || DEFAULT_SIDE_PANEL_GRID;
  // Migrate old saves that predate 'title' being included. It goes to the top of
  // the rail (under the logo when there is one), never appended to the bottom:
  // appending is what buried the title below the locator in every legacy save.
  const gridHasId = (g, eid) => g.some(item => Array.isArray(item) ? item.includes(eid) : item === eid);
  const grid = gridHasId(rawGrid, 'title')
    ? rawGrid
    : (() => {
      const at = gridHasId([rawGrid[0]], 'logo') ? 1 : 0;
      return [...rawGrid.slice(0, at), 'title', ...rawGrid.slice(at)];
    })();
  const gridHas = (eid) => gridHasId(grid, eid);
  const northArrowInGrid = gridHas('northArrow');
  const scaleBarInGrid = gridHas('scaleBar');

  // --- Zone accumulators ---
  let insetZone = { top: 0, left: 0, width: 0, height: 0 };
  let legendZone = { top: 0, left: 0, width: 0, height: 0 };
  let logoZone = { top: 0, left: 0, width: 0, height: 0 };
  let titleZone = { top: 0, left: 0, width: 0, height: 0 };
  let footerZone = { top: 0, left: 0, width: 0, height: 0 };
  let northArrowZone = { top: 0, left: 0, width: 0, height: 0 };
  let scaleBarZone = { top: 0, left: 0, width: 0, height: 0 };

  const getElemH = (eid) => {
    if (eid === 'inset') return fittedInsetH;
    if (eid === 'legend') return fittedLegendH;
    if (eid === 'logo') return layout?.logo ? logoH : 0;
    if (eid === 'title') return titleHeight;
    if (eid === 'footer') return layout?.footerEnabled && layout?.footerText ? footerH : 0;
    if (eid === 'northArrow') return naH;
    if (eid === 'scaleBar') return scaleBarActualH;
    return 0;
  };
  const setElemZone = (eid, top, left, width, height) => {
    const z = { top, left, width, height };
    if (eid === 'inset') insetZone = z;
    else if (eid === 'legend') legendZone = z;
    else if (eid === 'logo') logoZone = z;
    else if (eid === 'title') titleZone = z;
    else if (eid === 'footer') footerZone = z;
    else if (eid === 'northArrow') northArrowZone = z;
    else if (eid === 'scaleBar') scaleBarZone = z;
  };

  // --- Fit the stack to the rail -------------------------------------------
  // Everything except the legend and the locator has a height it must keep
  // (a title cannot be 12px tall, a footer line cannot be 4px). Those two are
  // the elastic ones, so when the requested heights exceed the rail they give
  // back space — in that order — instead of the last row falling off the
  // bottom edge. This is why the footer no longer clips.
  const rowHeightFor = (eid) => {
    if (eid === 'inset') return insetEnabled ? insetH : 0;
    if (eid === 'legend') return legendHeight;
    if (eid === 'logo') return layout?.logo ? logoH : 0;
    if (eid === 'title') return titleHeight;
    if (eid === 'footer') return layout?.footerEnabled && layout?.footerText ? footerH : 0;
    if (eid === 'northArrow') return northArrowInGrid ? naH : 0;
    if (eid === 'scaleBar') return scaleBarInGrid ? scaleBarActualH : 0;
    return 0;
  };
  const rows = grid.map((item) => {
    if (!item) return { kind: 'spacer' };
    const ids = Array.isArray(item) ? item : [item];
    return { kind: 'row', ids, height: Math.max(...ids.map(rowHeightFor), 0) };
  });
  const emptyRowH = Math.floor((H - margin * 2) / 5);
  const usedGaps = Math.max(0, rows.filter((r) => r.kind === 'spacer' || r.height > 0).length - 1) * gap;
  const requested = rows.reduce((sum, r) => sum + (r.kind === 'spacer' ? emptyRowH : r.height), 0) + usedGaps;
  let overflow = requested - (H - margin * 2);

  let fittedLegendH = legendHeight;
  let fittedInsetH = insetEnabled ? insetH : 0;
  if (overflow > 0 && grid.some((i) => (Array.isArray(i) ? i : [i]).includes('legend'))) {
    const give = Math.min(overflow, Math.max(0, fittedLegendH - 60));
    fittedLegendH -= give;
    overflow -= give;
  }
  if (overflow > 0 && fittedInsetH > 0) {
    const give = Math.min(overflow, Math.max(0, fittedInsetH - 70));
    fittedInsetH -= give;
    overflow -= give;
  }

  // --- Stack from TOP in configurable grid order ---
  // Null/undefined rows act as empty spacer rows contributing a fixed height
  let stackY = margin;
  for (const item of grid) {
    if (!item) {
      // Empty spacer row
      stackY += emptyRowH + gap;
      continue;
    }
    if (Array.isArray(item)) {
      // Two elements side by side (column split)
      const [id1, id2] = item;
      const colW = Math.floor((innerW - gap) / 2);
      const h1 = getElemH(id1);
      const h2 = getElemH(id2);
      if (h1 > 0) setElemZone(id1, stackY, sbLeft + margin, colW, h1);
      if (h2 > 0) setElemZone(id2, stackY, sbLeft + margin + colW + gap, colW, h2);
      const rowH = Math.max(h1, h2);
      if (rowH > 0) stackY += rowH + gap;
    } else {
      // Full width
      const h = getElemH(item);
      if (h === 0) continue;
      setElemZone(item, stackY, sbLeft + margin, innerW, h);
      stackY += h + gap;
    }
  }

  // --- North arrow and scale bar in MAP area (when not in grid) ---
  const mapW = sbLeft;
  // The coordinate frame's tick margin is white space nothing may sit in.
  const mapMargin = margin + (layout?.showCoordinateFrame ? TICK_MARGIN : 0);

  if (!northArrowInGrid) {
    const sp = layout?.sidePanelPositions || {};
    northArrowZone = {
      top: H - mapMargin - naH,
      left: mapW - mapMargin - naW,
      width: naW,
      height: naH,
    };
    if (sp.northArrow?.top != null) northArrowZone = { ...northArrowZone, top: sp.northArrow.top };
    if (sp.northArrow?.left != null) northArrowZone = { ...northArrowZone, left: sp.northArrow.left };
  }

  if (!scaleBarInGrid) {
    const sp = layout?.sidePanelPositions || {};
    scaleBarZone = {
      top: H - mapMargin - scaleBarActualH,
      left: mapMargin,
      width: scaleBarW,
      height: scaleBarActualH,
    };
    if (sp.scaleBar?.top != null) scaleBarZone = { ...scaleBarZone, top: sp.scaleBar.top };
    if (sp.scaleBar?.left != null) scaleBarZone = { ...scaleBarZone, left: sp.scaleBar.left };
  }

  // Resolve overlap: if northArrow and scaleBar are both in map area and intersect, push scaleBar below northArrow
  if (!northArrowInGrid && !scaleBarInGrid) {
    const naR = northArrowZone.left + northArrowZone.width;
    const sbR2 = scaleBarZone.left + scaleBarZone.width;
    const xOverlap = northArrowZone.left < sbR2 && scaleBarZone.left < naR;
    const yOverlap = northArrowZone.top < scaleBarZone.top + scaleBarZone.height &&
                     scaleBarZone.top < northArrowZone.top + northArrowZone.height;
    if (xOverlap && yOverlap) {
      scaleBarZone = { ...scaleBarZone, top: northArrowZone.top + northArrowZone.height + gap };
    }
  }

  // Sidebar background — full height right panel
  const sidebarZone = { top: 0, left: sbLeft, width: sbW, height: H };

  return {
    sidebar: sidebarZone,
    inset: insetZone,
    legend: legendZone,
    logo: logoZone,
    northArrow: northArrowZone,
    scaleBar: scaleBarZone,
    title: titleZone,
    footer: footerZone,
  };
}

// ─── Map area slot system (for north arrow / scale bar) ─────────────────────

/** Returns pixel {left, top} for each map slot. Right/bottom slots snap to actual canvas edge. */
export function mapSlotPositions(mapAreaW, mapH, elemW = 80, elemH = 80) {
  const m = 14; // edge margin
  const cx = Math.round((mapAreaW - elemW) / 2);
  const rx = mapAreaW - m - elemW;
  const by = mapH - m - elemH;
  return {
    'map-tl': { left: m,  top: m },
    'map-tc': { left: cx, top: m },
    'map-tr': { left: rx, top: m },
    'map-bl': { left: m,  top: by },
    'map-bc': { left: cx, top: by },
    'map-br': { left: rx, top: by },
  };
}

export function buildSidePanelLegendItems(layers, _layout) {
  const items = [];
  for (const layer of (layers || [])) {
    if (!layer.visible || !layer.geojson) continue;
    if (layer.legend?.enabled === false) continue;
    // A layer whose every shape has been removed is absent from the map, so it
    // must not be named in the legend. Third builder with this rule — the other
    // two are in technicalResultsTemplate and technicalReportTemplate.
    if (!hasVisibleFeatures(layer)) continue;
    const label = layer.legend?.label || layer.displayName || layer.name;
    const baseStyle = sidePanelTemplate.roleStyles?.[layer.role] || sidePanelTemplate.roleStyles?.other || {};
    const style = { ...baseStyle, ...(layer.style || {}) };
    items.push({ id: layer.id, label, type: layer.type, role: layer.role, style });
  }
  return items;
}
