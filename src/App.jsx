import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RatioSwitcher from './components/RatioSwitcher';
import Sidebar from './components/Sidebar';
import LayerList from './components/LayerList';
import LocatorInset from './components/LocatorInset';
import CalloutsOverlay from './components/CalloutsOverlay';
import LandingPage from './components/LandingPage';
import AdminPage from './components/AdminPage';
import UploadPanel from './components/UploadPanel';
import AnnotationOverlay from './components/AnnotationOverlay';
import ShadeOverlay from './components/ShadeOverlay';

const MapCanvas = React.lazy(() => import('./components/MapCanvas'));
const ExportHDModal = React.lazy(() => import('./components/ExportHDModal'));
const HowToUseModal = React.lazy(() => import('./components/HowToUseModal'));
const ColumnMapperModal = React.lazy(() => import('./components/ColumnMapperModal'));
import { loadGeoJSON, loadCSV, loadShapefileSet } from './utils/importers';
import sampleClaims from './assets/sampleClaims.json';
import sampleDrillholes from './assets/sampleDrillholes.json';
import {
  CALLOUT_TYPES,
  createInitialProjectState,
  FONT_OPTIONS,
  ROLE_LABELS,
  POINT_ROLES,
  TEMPLATE_MODES,
  TEMPLATE_THEMES,
} from './projectState';
import { EXPORT_RATIOS, SNAP_THRESHOLD } from './constants';
import { applyRoleToLayer, inferRoleFromLayer } from './mapPresets';
import { getTemplate } from './templates';
import { buildLegendItems, resolveTemplateZones } from './templates/technicalResultsTemplate';
import { resolveNI43101Zones } from './templates/technicalReportTemplate';
import { resolveSidePanelZones, mapSlotPositions } from './templates/sidePanelTemplate';
import { geojsonBounds, geojsonCenter, unionBounds } from './utils/geometry';
import { markerSvgUrl } from './utils/leaflet';
import { detectRegion } from './utils/detectRegion';
import { cleanLayerName } from './utils/cleanLayerName';
import regionsNA from './assets/regionsNA.json';
import { fitProjectToTemplate } from './utils/frameMapForTemplate';
import { getThemeTokens } from './utils/themeTokens';
import { saveLead, getLastLeadEmail } from './utils/leadCapture';
import {
  clearActiveProjectContext,
  deleteProjectRecord,
  duplicateProjectRecord,
  estimateStorageUsedBytes,
  listProjects,
  renameProjectRecord,
  resolveInitialWorkspace,
  saveDraft,
  saveProjectRecord,
  touchLastOpenedProject,
} from './utils/projectStorage';
import {
  deleteCloudProject,
  deleteTemplate,
  getDefaultTemplate,
  listCloudProjects,
  listTemplates,
  loadCloudProject,
  renameCloudProject,
  saveCloudProject,
  saveTemplate,
  setDefaultTemplate,
  updateTemplate,
  applyTemplateConfig,
  TEMPLATE_SAVEABLE_KEYS,
} from './utils/cloudStorage';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import UserMenu from './components/UserMenu';
import { CORNER_KEY, getCornerLayout, moveToCorner, moveToCornerFirst, moveToCornerBeside } from './utils/cornerLayout';

const SAMPLE_LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 56" width="220" height="56">',
  '<path d="M24 4L40 4L48 18L40 32L24 32L16 18Z" fill="#b87333"/>',
  '<polygon points="32,11 22,29 42,29" fill="white"/>',
  '<polygon points="28,29 32,21 36,29" fill="#e8a06a"/>',
  '<text x="58" y="18" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1a2635" letter-spacing="0.8">BUCKHORN CREEK</text>',
  '<text x="58" y="31" font-family="Arial,sans-serif" font-size="9" font-weight="400" fill="#b87333" letter-spacing="2">MINING CORP.</text>',
  '<text x="58" y="45" font-family="Arial,sans-serif" font-size="8" fill="#94a3b8">Cariboo Region, British Columbia</text>',
  '</svg>',
].join('');
const SAMPLE_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(SAMPLE_LOGO_SVG)}`;
const SAMPLE_ACCENT = '#b87333';

const BASEMAP_OPTIONS = [
  { key: 'light',    label: 'Light',     bg: '#dde8f0', water: '#a8c8e8' },
  { key: 'streets',  label: 'Streets',   bg: '#f5f0e8', water: '#c8dff0' },
  { key: 'dark',     label: 'Dark',      bg: '#1a2535', water: '#0f1a28' },
  { key: 'topo',     label: 'Topo',      bg: '#d4c89a', water: '#9ab8d0' },
  { key: 'terrain',  label: 'Terrain',   bg: '#ccd8b0', water: '#9ab8d0' },
  { key: 'satellite',label: 'Satellite', bg: '#2d4a3e', water: '#1a3050' },
  { key: 'blank',    label: 'Blank',     bg: '#ffffff', water: '#e8f0f8' },
];

const MARKER_TYPES = {
  circle: 'Circle',
  square: 'Square',
  triangle: 'Triangle',
  triangle_down: 'Tri ▼',
  diamond: 'Diamond',
  cross: 'Cross',
  star: 'Star',
  hexagon: 'Hexagon',
  pin: 'Pin',
  drillhole: 'DH Pin',
};

function detectLayerKind(geojson) {
  if (!geojson) return 'geojson';
  const features = geojson.type === 'FeatureCollection' ? geojson.features || [] : geojson.type === 'Feature' ? [geojson] : [];
  const first = features.find((f) => f?.geometry?.type);
  const type = first?.geometry?.type;
  if (type === 'Point' || type === 'MultiPoint') return 'points';
  return 'geojson';
}

function mergeDeep(base, patch) {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    style: patch.style ? { ...(base.style || {}), ...patch.style } : base.style,
    legend: patch.legend ? { ...(base.legend || {}), ...patch.legend } : base.legend,
  };
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function sanitizeSvgDataUrl(dataUrl) {
  // Strip scripts, event handlers, and external references from SVG before storage.
  const prefix = 'data:image/svg+xml';
  if (!dataUrl.startsWith(prefix)) return dataUrl;

  let svgText;
  if (dataUrl.startsWith('data:image/svg+xml;base64,')) {
    svgText = atob(dataUrl.slice('data:image/svg+xml;base64,'.length));
  } else {
    svgText = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
  }

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');

  // Remove dangerous elements
  doc.querySelectorAll('script, foreignObject').forEach(el => el.remove());

  // Remove <use> pointing to external resources
  doc.querySelectorAll('use').forEach(el => {
    const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (href.startsWith('http') || href.startsWith('//')) el.remove();
  });

  // Strip event handler attributes from every element
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    });
  });

  const clean = new XMLSerializer().serializeToString(doc.documentElement);
  return `data:image/svg+xml,${encodeURIComponent(clean)}`;
}

function zoneStyle(zone) {
  if (!zone || !zone.width || !zone.height) return { display: 'none' };
  return {
    position: 'absolute',
    top: zone.top,
    left: zone.left,
    width: zone.width,
    height: zone.height,
    zIndex: 400,
  };
}

function NorthArrow({ scale = 100 }) {
  const h = scale;
  const w = Math.round(h * 0.9);
  const cx = w / 2;
  const cy = h * 0.56;
  const R = h * 0.27;
  const Re = R * 0.71;
  const rn = h * 0.09;
  const r45 = rn * 0.707;
  const nx = cx; const ny = cy - R;
  const sx = cx; const sy = cy + R;
  const ex = cx + Re; const ey = cy;
  const wx = cx - Re; const wy = cy;
  const ne = [cx + r45, cy - r45];
  const se = [cx + r45, cy + r45];
  const sw = [cx - r45, cy + r45];
  const nw = [cx - r45, cy - r45];
  const fg = 'var(--north-fg, #122033)';
  return (
    <div className="template-card north-arrow-card">
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        <path d={`M ${nx} ${ny} L ${ne[0]} ${ne[1]} L ${cx} ${cy} L ${nw[0]} ${nw[1]} Z`} fill={fg} />
        <path d={`M ${sx} ${sy} L ${sw[0]} ${sw[1]} L ${cx} ${cy} L ${se[0]} ${se[1]} Z`} fill={fg} fillOpacity="0.55" />
        <path d={`M ${ex} ${ey} L ${se[0]} ${se[1]} L ${cx} ${cy} L ${ne[0]} ${ne[1]} Z`} fill={fg} fillOpacity="0.35" />
        <path d={`M ${wx} ${wy} L ${nw[0]} ${nw[1]} L ${cx} ${cy} L ${sw[0]} ${sw[1]} Z`} fill={fg} fillOpacity="0.35" />
        <circle cx={cx} cy={cy} r={R + rn * 0.5} fill="none" stroke={fg} strokeOpacity="0.2" strokeWidth={h * 0.012} />
        <circle cx={cx} cy={cy} r={h * 0.044} fill="var(--north-fill, rgba(255,255,255,0.95))" stroke={fg} strokeWidth={h * 0.018} />
        <text x={cx} y={h * 0.14} textAnchor="middle" dominantBaseline="middle" fill={fg} fontFamily="Arial, sans-serif" fontSize={h * 0.16} fontWeight="700">N</text>
      </svg>
    </div>
  );
}

function ScaleBar({ map }) {
  const [state, setState] = useState({ label: '1 km', width: 130 });

  useEffect(() => {
    if (!map) return;
    const update = () => {
      try {
        const size = map.getSize();
        const cy = size.y / 2;
        const latlng1 = map.containerPointToLatLng([0, cy]);
        const latlng2 = map.containerPointToLatLng([200, cy]);
        const metersPerPx = latlng1.distanceTo(latlng2) / 200;
        const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000, 1000000];
        const nice = steps.reduce((best, n) => (Math.abs(n / metersPerPx - 120) < Math.abs(best / metersPerPx - 120) ? n : best), steps[0]);
        setState({
          label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`,
          width: Math.max(40, Math.min(220, Math.round(nice / metersPerPx))),
        });
      } catch {
        // noop
      }
    };
    update();
    map.on('moveend zoomend resize', update);
    return () => map.off('moveend zoomend resize', update);
  }, [map]);

  return (
    <div className="template-card scale-card">
      <div className="scale-bar-track" style={{ width: state.width }}>
        <div className="scale-bar-fill" />
        <div className="scale-bar-fill light" />
      </div>
      <div className="scale-bar-label">{state.label}</div>
    </div>
  );
}

function applyModeToProject(project, template, mode) {
  const preset = template.modePresets?.[mode];
  if (!preset) return project;
  return {
    ...project,
    layers: project.layers.map((layer) => ({
      ...layer,
      visible: layer.userStyled ? layer.visible : (preset.visibleRoles ? (preset.visibleRoles.includes(layer.role) || POINT_ROLES.has(layer.role)) : layer.visible),
    })),
    layout: {
      ...project.layout,
      mode,
      basemap: preset.basemap || project.layout.basemap,
      insetMode: project.layout.insetMode === 'custom_image' ? project.layout.insetMode : preset.insetMode || project.layout.insetMode,
      compositionPreset: preset.framing || project.layout.compositionPreset,
      referenceOverlays: {
        ...project.layout.referenceOverlays,
        ...(preset.referenceOverlays || {}),
      },
      frameVersion: (project.layout.frameVersion || 0) + 1,
    },
  };
}



function LegendLabelEditable({ label, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const commit = () => { setEditing(false); if (draft !== label) onSave(draft); };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setDraft(label); setEditing(false); } }}
        onClick={(e) => e.stopPropagation()}
        style={{ font: 'inherit', fontSize: 'inherit', border: 'none', background: 'transparent', outline: '1px solid #3b82f6', borderRadius: 2, padding: '0 2px', width: '100%', minWidth: 40 }}
      />
    );
  }
  return (
    <span
      title="Click to rename"
      style={{ cursor: 'text' }}
      onClick={(e) => { e.stopPropagation(); setDraft(label); setEditing(true); }}
    >
      {label}
    </span>
  );
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

function ProjectNameInput({ initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  return (
    <input
      autoFocus
      className="project-name-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() ? onSave(value.trim()) : onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function RecentProjectsModal({ entries, currentProjectId, onOpen, onRename, onDelete, onClose }) {
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  return (
    <div className="recent-projects-modal" role="dialog" aria-modal="true">
      <div className="recent-projects-card">
        <div className="recent-projects-header">
          <h3>Saved Projects</h3>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="recent-projects-list">
          {entries.length ? entries.map((entry) => (
            <div
              key={entry.id}
              className={`recent-project-row${entry.id === currentProjectId ? ' current' : ''}`}
            >
              <div className="recent-project-main" onClick={() => editingId !== entry.id && onOpen(entry)}>
                {editingId === entry.id ? (
                  <ProjectNameInput
                    initialValue={entry.name}
                    onSave={(name) => { onRename(entry.id, name); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <strong className="recent-project-name">{entry.name}</strong>
                )}
                <span className="recent-project-date">{new Date(entry.updatedAt).toLocaleString()}</span>
              </div>
              <div className="recent-project-actions" onClick={(e) => e.stopPropagation()}>
                {confirmDeleteId === entry.id ? (
                  <>
                    <span className="recent-project-confirm-label">Delete?</span>
                    <button className="proj-action-btn danger" type="button" onClick={() => { onDelete(entry.id); setConfirmDeleteId(null); }}>Yes</button>
                    <button className="proj-action-btn" type="button" onClick={() => setConfirmDeleteId(null)}>No</button>
                  </>
                ) : (
                  <>
                    <button className="proj-action-btn" type="button" title="Rename" onClick={() => { setEditingId(entry.id); setConfirmDeleteId(null); }}>✎</button>
                    <button className="proj-action-btn danger" type="button" title="Delete" onClick={() => { setConfirmDeleteId(entry.id); setEditingId(null); }}>✕</button>
                  </>
                )}
              </div>
            </div>
          )) : <div className="small-note">No saved projects yet.</div>}
        </div>
      </div>
    </div>
  );
}

function renderLegendGroups(items, layout) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && items.length <= 2);
  if (compact) return [{ heading: null, items }];
  const groups = [];
  for (const item of items) {
    const heading = item.group || 'Map Data';
    let bucket = groups.find((g) => g.heading === heading);
    if (!bucket) {
      bucket = { heading, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(item);
  }
  return groups;
}

function getFeatureLabel(feature, layer) {
  const props = feature?.properties || {};
  return props.label || props.name || props.hole || props.hole_id || props.holeid || props.id || layer?.displayName || layer?.legend?.label || layer?.name || 'Drillhole';
}

function isPointStyledLayer(layer) {
  return layer?.type === 'points' || POINT_ROLES.has(layer?.role);
}

function selectValue(options, value, fallback = 'Inter') {
  return options[value] ? value : fallback;
}

function initialWorkspaceState() {
  const base = createInitialProjectState();
  const fallback = {
    ...base,
    layout: {
      ...base.layout,
      title: 'Project Map',
      subtitle: 'Claims, drillholes, and targets',
    },
  };
  return resolveInitialWorkspace(fallback);
}

// ─── NI 43-101 live tick overlay ────────────────────────────────────────────

function _haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function _displaceLng(lat, lng, meters) {
  return lng + (meters / (Math.cos(lat * Math.PI / 180) * 111319.9));
}
function _displaceLat(lat, meters) {
  return lat + meters / 111132;
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
  const M = a * (
    (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * latR
    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*latR)
    + (15*e2**2/256 + 45*e2**3/1024) * Math.sin(4*latR)
    - (35*e2**3/3072) * Math.sin(6*latR));
  const easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*e1sq)*A**5/120) + 500000;
  const northing = k0 * (M + N*Math.tan(latR)*(A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*e1sq)*A**6/720)) + (lat < 0 ? 10000000 : 0);
  return { easting, northing, zone, hemisphere: lat >= 0 ? 'N' : 'S' };
}
function _pickUTMInterval(totalM, count) {
  const steps = [500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
  const target = totalM / count;
  return steps.find((s) => s >= target) || steps[steps.length - 1];
}
function _fmtUTMEasting(e) {
  const s = Math.round(e).toString().padStart(6, '0');
  return s.slice(0, -3) + ' ' + s.slice(-3) + 'E';
}
function _fmtUTMNorthing(n) {
  const s = Math.round(n).toString();
  if (s.length <= 6) return s.slice(0, -3) + ' ' + s.slice(-3) + 'N';
  return s.slice(0, -6) + ' ' + s.slice(-6, -3) + ' ' + s.slice(-3) + 'N';
}

function NIMapOverlay({ map, mapSize, layout }) {
  const [, setV] = React.useState(0);
  React.useEffect(() => {
    if (!map) return;
    const bump = () => setV((v) => v + 1);
    map.on('moveend zoomend', bump);
    return () => map.off('moveend zoomend', bump);
  }, [map]);

  if (!map || !mapSize) return null;

  const STRIP_H = 72;
  const TICK_M = 28;
  const stageW = mapSize.width || 1000;
  const stageH = mapSize.height || 600;
  const stripPos = layout.titleStripPosition || 'bottom';
  const mapTop = TICK_M + (stripPos === 'top' ? STRIP_H : 0);
  const mapBottom = stageH - TICK_M - (stripPos === 'bottom' ? STRIP_H : 0);
  const mapLeft = TICK_M;
  const mapRight = stageW - TICK_M;
  const mapW = mapRight - mapLeft;
  const mapH = mapBottom - mapTop;

  const size = map.getSize();
  if (!size || size.x === 0 || size.y === 0) return null;

  const cy = size.y / 2;
  const cx = size.x / 2;
  const centerLL = map.getCenter();
  const leftLL = map.containerPointToLatLng([0, cy]);
  const rightLL = map.containerPointToLatLng([size.x, cy]);
  const topLL = map.containerPointToLatLng([cx, 0]);
  const botLL = map.containerPointToLatLng([cx, size.y]);
  const totalW = _haversineM(leftLL.lat, leftLL.lng, rightLL.lat, rightLL.lng);
  const totalH = _haversineM(topLL.lat, topLL.lng, botLL.lat, botLL.lng);
  const xInt = _pickUTMInterval(totalW, 6);
  const yInt = _pickUTMInterval(totalH, 5);

  // UTM parameters based on map center zone
  const centerUTM = _latlngToUTM(centerLL.lat, centerLL.lng);
  const { zone } = centerUTM;
  const cm = (zone - 1) * 6 - 180 + 3;
  const a = 6378137, f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const k0 = 0.9996;
  const refLatR = centerLL.lat * Math.PI / 180;
  const N_ref = a / Math.sqrt(1 - e2 * Math.sin(refLatR) ** 2);

  const leftUTM = _latlngToUTM(leftLL.lat, leftLL.lng);
  const rightUTM = _latlngToUTM(rightLL.lat, rightLL.lng);
  const topUTM = _latlngToUTM(topLL.lat, topLL.lng);
  const botUTM = _latlngToUTM(botLL.lat, botLL.lng);

  const tickLen = 8;
  const monoFont = "'Courier New', Courier, monospace";
  const fontSize = 9;

  // X ticks: vertical lines at constant UTM easting
  const xTicks = [];
  // Compute edge eastings in the center zone to avoid cross-zone mismatch near 6° boundaries
  const leftE_cz  = 500000 + k0 * N_ref * Math.cos(refLatR) * (leftLL.lng  - cm) * (Math.PI / 180);
  const rightE_cz = 500000 + k0 * N_ref * Math.cos(refLatR) * (rightLL.lng - cm) * (Math.PI / 180);
  const startE = Math.ceil(leftE_cz / xInt) * xInt;
  for (let e = startE; e <= rightE_cz + xInt * 0.1; e += xInt) {
    const dE = e - 500000;
    const lng = cm + (dE / (k0 * N_ref * Math.cos(refLatR))) * (180 / Math.PI);
    const pt = map.latLngToContainerPoint([centerLL.lat, lng]);
    const px = Math.round(pt.x * (mapW / size.x)) + mapLeft;
    if (px < mapLeft - 1 || px > mapRight + 1) continue;
    const lbl = _fmtUTMEasting(e);
    xTicks.push(
      <g key={e}>
        <line x1={px} y1={mapTop} x2={px} y2={mapTop - tickLen} stroke="#000" strokeWidth="1" />
        <line x1={px} y1={mapBottom} x2={px} y2={mapBottom + tickLen} stroke="#000" strokeWidth="1" />
        <text x={px} y={mapTop - tickLen - 2} textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000">{lbl}</text>
        <text x={px} y={mapBottom + tickLen + 2} textAnchor="middle" dominantBaseline="hanging" fontFamily={monoFont} fontSize={fontSize} fill="#000">{lbl}</text>
      </g>
    );
  }

  // Y ticks: horizontal lines at constant UTM northing (labels rotated 90° to fit margin)
  const yTicks = [];
  const startN = Math.floor(topUTM.northing / yInt) * yInt;
  for (let n = startN; n >= botUTM.northing - yInt * 0.1; n -= yInt) {
    const lat = centerLL.lat + (n - centerUTM.northing) / 111132;
    const pt = map.latLngToContainerPoint([lat, centerLL.lng]);
    const py = Math.round(pt.y * (mapH / size.y)) + mapTop;
    if (py < mapTop - 1 || py > mapBottom + 1) continue;
    const lbl = _fmtUTMNorthing(n);
    yTicks.push(
      <g key={n}>
        <line x1={mapLeft} y1={py} x2={mapLeft - tickLen} y2={py} stroke="#000" strokeWidth="1" />
        <line x1={mapRight} y1={py} x2={mapRight + tickLen} y2={py} stroke="#000" strokeWidth="1" />
        <text textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000" transform={`translate(${mapLeft - tickLen - 2},${py}) rotate(-90)`}>{lbl}</text>
        <text textAnchor="middle" dominantBaseline="auto" fontFamily={monoFont} fontSize={fontSize} fill="#000" transform={`translate(${mapRight + tickLen + 2},${py}) rotate(90)`}>{lbl}</text>
      </g>
    );
  }

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: stageW, height: stageH, pointerEvents: 'none', zIndex: 391 }}>
      {xTicks}
      {yTicks}
    </svg>
  );
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapViewportRef = useRef(null);
  const leafletMapRef = useRef(null);
  const skipAutoFitRef = useRef(false);
  const mapSizeRef = useRef({ width: 1600, height: 1000 });
  const logoInputRef = useRef(null);
  const insetInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const { user } = useAuth();
  const [storageWarningDismissed, setStorageWarningDismissed] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [cloudTemplates, setCloudTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingTemplateName, setSavingTemplateName] = useState(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState(null);
  const [renamingTemplateName, setRenamingTemplateName] = useState('');

  const [screen, setScreen] = useState(() =>
    window.location.pathname === '/admin' ? 'admin' : 'landing'
  );
  const initialWorkspace = useMemo(() => initialWorkspaceState(), []);
  const [project, setProject] = useState(initialWorkspace.project);
  const [projectId, setProjectId] = useState(initialWorkspace.projectId);
  const [projectName, setProjectName] = useState(initialWorkspace.projectName);
  const [recentProjects, setRecentProjects] = useState(() => listProjects());
  const [showRecentProjects, setShowRecentProjects] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [pendingExportFormat, setPendingExportFormat] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectedCalloutId, setSelectedCalloutId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  const [selectedEllipseId, setSelectedEllipseId] = useState(null);
  const [selectedPolygonId, setSelectedPolygonId] = useState(null);
  const [pendingPolygonPoints, setPendingPolygonPoints] = useState([]);
  const [pendingDistanceP1, setPendingDistanceP1] = useState(null);
  const [selectedDistanceLineId, setSelectedDistanceLineId] = useState(null);
  const [annotationTool, setAnnotationTool] = useState(null);
  const [uploadStatus, setUploadStatus] = useState({ type: 'info', message: 'Open the editor, then upload your first file from the left panel.' });
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(null); // { id, hoverZone, ghostX, ghostY, ghostW, ghostH }
  const [resizeGuides, setResizeGuides] = useState([]);
  const [exportError, setExportError] = useState('');
  const [mapSize, setMapSize] = useState({ width: 1600, height: 1000 });
  const [saveFlash, setSaveFlash] = useState(false);
  const saveFlashTimerRef = useRef(null);
  const [activeRatio, setActiveRatio] = useState(null);
  const activeRatioRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ width: 1600, height: 1000 });
  const [featureEditorTick, setFeatureEditorTick] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const bootstrappedRef = useRef(false);
  const lastSavedSnapshotRef = useRef(JSON.stringify(project));
  // Local state for title/subtitle so every keystroke doesn't write to project (stops flicker)
  const [localTitle, setLocalTitle] = useState(project.layout.title || '');
  const [localSubtitle, setLocalSubtitle] = useState(project.layout.subtitle || '');
  const [localLegendTitle, setLocalLegendTitle] = useState(project.layout.legendTitle ?? 'Legend');
  const [localFooterText, setLocalFooterText] = useState(project.layout.footerText || '');
  const [localMapDate, setLocalMapDate] = useState(project.layout.mapDate || '');
  const [localProjectNumber, setLocalProjectNumber] = useState(project.layout.projectNumber || '');
  const [localMapScaleNote, setLocalMapScaleNote] = useState(project.layout.mapScaleNote || '');
  const titleDebounceRef = useRef(null);
  const subtitleDebounceRef = useRef(null);
  const legendTitleDebounceRef = useRef(null);
  const footerTextDebounceRef = useRef(null);
  const mapDateDebounceRef = useRef(null);
  const projectNumberDebounceRef = useRef(null);
  const mapScaleNoteDebounceRef = useRef(null);
  const layerStyleDebounceRef = useRef(null);
  // Tracks which metadata fields have unsaved user input (debounce pending)
  const metaDirtyRef = useRef({ legendTitle: false, footerText: false, mapDate: false, projectNumber: false, mapScaleNote: false });
  const annotationToolRef = useRef(null);
  const [editingTitleField, setEditingTitleField] = useState(null);
  const [csvMappingData, setCsvMappingData] = useState(null); // { headers, rows, filename } for ColumnMapperModal
  const layersSectionRef = useRef(null);
  const markersSectionRef = useRef(null);
  const calloutsSectionRef = useRef(null);
  const drillholeSectionRef = useRef(null);

  const template = useMemo(() => getTemplate(project.layout?.templateId || 'technical_results_v2'), [project.layout?.templateId]);
  const selectedLayer = useMemo(() => project.layers.find((layer) => layer.id === selectedLayerId) || null, [project.layers, selectedLayerId]);
  const [collapsedSections, setCollapsedSections] = useState({ drillhole: true, elements: true, refoverlays: true, export: true });
  const toggleSection = (key) => setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const selectedCallout = useMemo(() => project.callouts.find((callout) => callout.id === selectedCalloutId) || null, [project.callouts, selectedCalloutId]);
  const selectedMarker = useMemo(() => project.markers?.find((marker) => marker.id === selectedMarkerId) || null, [project.markers, selectedMarkerId]);
  const selectedEllipse = useMemo(() => project.ellipses?.find((ellipse) => ellipse.id === selectedEllipseId) || null, [project.ellipses, selectedEllipseId]);
  const selectedPolygon = useMemo(() => project.polygons?.find((poly) => poly.id === selectedPolygonId) || null, [project.polygons, selectedPolygonId]);
  const legendItems = useMemo(() => buildLegendItems(template, project.layers, project.layout), [template, project.layers, project.layout]);
  const legendGroups = useMemo(() => renderLegendGroups(legendItems, project.layout), [legendItems, project.layout]);
  const resolvedZones = useMemo(() => {
    if (project.layout?.templateId === 'ni_43101_technical') {
      return resolveNI43101Zones(template, project.layout, mapSize, legendItems);
    }
    if (project.layout?.templateId === 'side_panel') {
      return resolveSidePanelZones(template, project.layout, mapSize, legendItems);
    }
    return resolveTemplateZones(template, project.layout, mapSize, legendItems);
  }, [template, project.layout, mapSize, legendItems]);
  // Keep a ref so the framing effect can read the current zones without them being a reactive trigger
  const resolvedZonesRef = useRef(resolvedZones);
  useEffect(() => { resolvedZonesRef.current = resolvedZones; }, [resolvedZones]);
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

  useEffect(() => {
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      return;
    }
    const serialized = JSON.stringify(project);
    setIsDirty(serialized !== lastSavedSnapshotRef.current);
    const timer = window.setTimeout(() => {
      saveDraft({ payload: project, projectId, projectName });
      setSaveFlash(true);
      clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = setTimeout(() => setSaveFlash(false), 2000);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project, projectId, projectName]);

  useEffect(() => {
    if (user) {
      listCloudProjects().then(setRecentProjects).catch(() => setRecentProjects(listProjects()));
      listTemplates().then(setCloudTemplates).catch(() => {});
    } else {
      setRecentProjects(listProjects());
    }
  }, [user, projectId, isDirty]);

  // Track unique visitor sessions (once per browser session, fire-and-forget)
  useEffect(() => {
    if (!supabase || sessionStorage.getItem('em_visited')) return;
    sessionStorage.setItem('em_visited', '1');
    const params = new URLSearchParams(window.location.search);
    const ref = document.referrer || null;
    const refDomain = ref ? (() => { try { return new URL(ref).hostname; } catch { return ref; } })() : null;
    supabase.from('page_views').insert({
      user_id: user?.id ?? null,
      path: window.location.pathname,
      referrer: refDomain,
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    }).then(() => {});
  }, [user]);

  // When user logs in, apply their default template to the current (unsaved) project
  useEffect(() => {
    if (!user) return;
    getDefaultTemplate().then((tmpl) => {
      if (tmpl?.config) {
        setProject((prev) => ({ ...prev, layout: applyTemplateConfig(tmpl.config, prev.layout) }));
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const handler = () => setUploadStatus({
      type: 'error',
      message: 'Storage full — project may not be saved. Export your work to avoid losing it.',
    });
    window.addEventListener('storage-quota-exceeded', handler);
    return () => window.removeEventListener('storage-quota-exceeded', handler);
  }, []);

  // Show storage warning banner for anonymous users when local storage is getting full
  const showStorageWarning = !user && !storageWarningDismissed && estimateStorageUsedBytes() > 3_500_000;

  // Sync local fields when project changes from an external action (open, duplicate, new).
  // Cancel pending debounce timers first to prevent cross-project writes.
  useEffect(() => {
    clearTimeout(legendTitleDebounceRef.current);
    clearTimeout(footerTextDebounceRef.current);
    clearTimeout(mapDateDebounceRef.current);
    clearTimeout(projectNumberDebounceRef.current);
    clearTimeout(mapScaleNoteDebounceRef.current);
    metaDirtyRef.current = { legendTitle: false, footerText: false, mapDate: false, projectNumber: false, mapScaleNote: false };
    setLocalTitle(project.layout.title || '');
    setLocalSubtitle(project.layout.subtitle || '');
    setLocalLegendTitle(project.layout.legendTitle ?? 'Legend');
    setLocalFooterText(project.layout.footerText || '');
    setLocalMapDate(project.layout.mapDate || '');
    setLocalProjectNumber(project.layout.projectNumber || '');
    setLocalMapScaleNote(project.layout.mapScaleNote || '');
  }, [projectId]);

  // Resync individual metadata fields when layout changes externally (e.g. template applied),
  // but not while the user is actively editing that field.
  useEffect(() => { if (!metaDirtyRef.current.legendTitle) setLocalLegendTitle(project.layout.legendTitle ?? 'Legend'); }, [project.layout.legendTitle]);
  useEffect(() => { if (!metaDirtyRef.current.footerText) setLocalFooterText(project.layout.footerText || ''); }, [project.layout.footerText]);
  useEffect(() => { if (!metaDirtyRef.current.mapDate) setLocalMapDate(project.layout.mapDate || ''); }, [project.layout.mapDate]);
  useEffect(() => { if (!metaDirtyRef.current.projectNumber) setLocalProjectNumber(project.layout.projectNumber || ''); }, [project.layout.projectNumber]);
  useEffect(() => { if (!metaDirtyRef.current.mapScaleNote) setLocalMapScaleNote(project.layout.mapScaleNote || ''); }, [project.layout.mapScaleNote]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return undefined;
    const update = () => {
      const s = { width: container.clientWidth, height: container.clientHeight };
      setMapSize(s);
      mapSizeRef.current = s;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [screen]);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) return undefined;
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [screen]);

  // Sync URL bar with screen state
  useEffect(() => {
    if (screen === 'admin') {
      if (window.location.pathname !== '/admin') window.history.replaceState({}, '', '/admin');
    } else if (window.location.pathname === '/admin') {
      window.history.replaceState({}, '', '/');
    }
  }, [screen]);

  const constrainedStageSize = useMemo(() => {
    if (!activeRatio) return null;
    const config = EXPORT_RATIOS[activeRatio];
    const PAD = 32;
    const availW = Math.max(100, viewportSize.width - PAD * 2);
    const availH = Math.max(100, viewportSize.height - PAD * 2);
    if (availW / availH > config.ratio) {
      return { width: Math.round(availH * config.ratio), height: availH };
    }
    return { width: availW, height: Math.round(availW / config.ratio) };
  }, [activeRatio, viewportSize]);

  // Stable key for the auto-fit effect — changes only for fit-relevant layer events
  // (add/remove, visibility toggle, role change, GeoJSON data arrives).
  // Style-only changes (color, opacity) do NOT change this key, preventing unwanted re-fits.
  const layerFitKey = useMemo(
    () => project.layers.map(l => `${l.id}:${l.visible ? 1 : 0}:${l.role || ''}:${l.geojson ? 1 : 0}`).join('|'),
    [project.layers]
  );

  const mapStageStyle = useMemo(() => ({
    ...(constrainedStageSize || {}),
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
  }), [themeTokens, constrainedStageSize, project.layout.fonts]);

  const handleRatioChange = useCallback((newRatio) => {
    const map = leafletMapRef.current;
    const prevRatio = activeRatioRef.current;

    if (map && prevRatio !== null) {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setProject((p) => ({
        ...p,
        ratioMapStates: { ...(p.ratioMapStates || {}), [prevRatio]: { center: { lat: center.lat, lng: center.lng }, zoom } },
      }));
    }

    activeRatioRef.current = newRatio;
    setActiveRatio(newRatio);
  }, []);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return undefined;
    const timer = setTimeout(() => {
      map.invalidateSize({ animate: false });
      if (activeRatio) {
        const saved = project.ratioMapStates?.[activeRatio];
        if (saved?.center) {
          map.setView([saved.center.lat, saved.center.lng], saved.zoom, { animate: false });
        }
      }
    }, 60);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constrainedStageSize]);

  useEffect(() => {
    if (screen !== 'editor') {
      setMapReady(false);
      leafletMapRef.current = null;
    }
  }, [screen]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || project.layers.length === 0) return;
    // Use the ref so cosmetic layout changes (title, logo size, opacity…) don't
    // trigger a map reframe. Only the explicit deps below cause refitting.
    if (skipAutoFitRef.current) {
      skipAutoFitRef.current = false;
      const saved = project.mapView;
      const screenMatch = saved?.screenW
        ? Math.abs(saved.screenW - mapSizeRef.current.width) / saved.screenW < 0.15
        : false;
      if (saved?.center && screenMatch) {
        map.setView([saved.center.lat, saved.center.lng], saved.zoom, { animate: false });
      } else {
        // No saved view, or different screen size — fit to focus layers for this screen
        fitProjectToTemplate(
          project,
          map,
          { ...template, zones: resolvedZonesRef.current },
          project.layout.compositionPreset || template.modePresets?.[project.layout.mode]?.framing || 'balanced',
          { focusRoles: true }
        );
      }
      return;
    }
    fitProjectToTemplate(
      project,
      map,
      { ...template, zones: resolvedZonesRef.current },
      project.layout.compositionPreset || template.modePresets?.[project.layout.mode]?.framing || 'balanced'
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, project.layout.frameVersion, project.layout.primaryLayerId, project.layout.compositionPreset, layerFitKey]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return undefined;
    const rerender = () => setFeatureEditorTick((value) => value + 1);
    map.on('moveend zoomend resize', rerender);
    return () => map.off('moveend zoomend resize', rerender);
  }, [mapReady]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return undefined;
    let saveTimer;
    const handleMoveEnd = () => {
      if (activeRatioRef.current) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        setProject((p) => ({ ...p, mapView: { center: { lat: center.lat, lng: center.lng }, zoom, screenW: mapSizeRef.current.width, screenH: mapSizeRef.current.height } }));
      }, 600);
    };
    map.on('moveend', handleMoveEnd);
    return () => { map.off('moveend', handleMoveEnd); clearTimeout(saveTimer); };
  }, [mapReady]);

  // Keyboard deletion of selected overlay elements
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
      if (selectedMarkerId) {
        setProject((prev) => ({ ...prev, markers: (prev.markers || []).filter((m) => m.id !== selectedMarkerId) }));
        setSelectedMarkerId(null);
      } else if (selectedCalloutId) {
        setProject((prev) => ({ ...prev, callouts: prev.callouts.filter((c) => c.id !== selectedCalloutId) }));
        setSelectedCalloutId(null);
      } else if (selectedEllipseId) {
        setProject((prev) => ({ ...prev, ellipses: (prev.ellipses || []).filter((el) => el.id !== selectedEllipseId) }));
        setSelectedEllipseId(null);
      } else if (selectedPolygonId) {
        setProject((prev) => ({ ...prev, polygons: (prev.polygons || []).filter((poly) => poly.id !== selectedPolygonId) }));
        setSelectedPolygonId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedMarkerId, selectedCalloutId, selectedEllipseId, selectedPolygonId]);

  useEffect(() => {
    if (selectedLayerId && layersSectionRef.current)
      layersSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedLayerId]);

  useEffect(() => {
    if (selectedMarkerId && markersSectionRef.current)
      markersSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedMarkerId]);

  useEffect(() => {
    if (selectedEllipseId && markersSectionRef.current)
      markersSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedEllipseId]);

  useEffect(() => {
    if (selectedCalloutId && calloutsSectionRef.current)
      calloutsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedCalloutId]);


  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
        fonts: patch.fonts ? { ...(prev.layout.fonts || {}), ...patch.fonts } : prev.layout.fonts,
        referenceOverlays: patch.referenceOverlays ? { ...(prev.layout.referenceOverlays || {}), ...patch.referenceOverlays } : prev.layout.referenceOverlays,
        exportSettings: patch.exportSettings ? { ...(prev.layout?.exportSettings || {}), ...patch.exportSettings } : prev.layout?.exportSettings,
      },
    }));
  };

  const SP_SIDEBAR_ELEMENTS = ['inset', 'legend', 'logo', 'title'];

  const makeDragHandler = (id, ghostW, ghostH) => (e) => {
    if (e.target.closest('.panel-resize-handle') || e.target.closest('.panel-delete-btn')) return;
    e.preventDefault();
    const map = leafletMapRef.current;
    if (map) map.dragging.disable();
    const isSidePanel = project.layout.templateId === 'side_panel';
    const isInSidebar = isSidePanel && SP_SIDEBAR_ELEMENTS.includes(id);
    const isMapInSidePanel = isSidePanel && !SP_SIDEBAR_ELEMENTS.includes(id);
    const layoutSnapshot = project.layout;
    let currentHoverZone = null;
    let currentInsertIdx = 0;
    let currentMapSlot = null;
    let finalClientX = e.clientX, finalClientY = e.clientY;
    const effectiveGhostW = isInSidebar
      ? Math.max(ghostW, (resolvedZonesRef.current?.sidebar?.width ?? 0) - 32)
      : ghostW;

    const getMapSlots = () => {
      const sbLeft = resolvedZonesRef.current?.sidebar?.left ?? Math.round(mapSize.width * 0.72);
      return Object.entries(mapSlotPositions(sbLeft, mapSize.height)).map(([key, pos]) => ({ id: key, ...pos }));
    };

    setDragging({ id, hoverZone: null, ghostX: e.clientX, ghostY: e.clientY, ghostW: effectiveGhostW, ghostH });

    const onMove = (me) => {
      finalClientX = me.clientX;
      finalClientY = me.clientY;

      if (isInSidebar) {
        // Reorder: find which gap the cursor is in
        const container = mapContainerRef.current;
        const rect = container?.getBoundingClientRect();
        if (!rect) return;
        const cursorY = me.clientY - rect.top;
        const order = layoutSnapshot.sidePanelOrder || ['inset', 'legend', 'logo'];
        const otherIds = order.filter(eid => eid !== id);
        let insertIdx = 0;
        for (let i = 0; i < otherIds.length; i++) {
          const z = resolvedZonesRef.current?.[otherIds[i]];
          if (z?.height > 0 && cursorY > z.top + z.height / 2) insertIdx = i + 1;
        }
        currentInsertIdx = insertIdx;
        setDragging((d) => d ? { ...d, ghostX: me.clientX, ghostY: me.clientY, hoverInsertIdx: insertIdx } : null);
        return;
      }

      if (isMapInSidePanel) {
        const container = mapContainerRef.current;
        const rect = container?.getBoundingClientRect();
        if (!rect) return;
        const cursorX = me.clientX - rect.left;
        const cursorY = me.clientY - rect.top;
        const zW = ghostW || 80, zH = ghostH || 48;
        const slots = getMapSlots();
        let bestKey = null, bestDist = Infinity;
        slots.forEach((s) => {
          const d = Math.hypot(cursorX - (s.left + zW / 2), cursorY - (s.top + zH / 2));
          if (d < bestDist) { bestDist = d; bestKey = s.id; }
        });
        currentMapSlot = bestKey;
        const sp = slots.find(s => s.id === bestKey);
        const snappedClientX = sp ? rect.left + sp.left + zW / 2 : me.clientX;
        const snappedClientY = sp ? rect.top + sp.top + zH / 2 : me.clientY;
        setDragging((d) => d ? { ...d, ghostX: snappedClientX, ghostY: snappedClientY, hoverMapSlot: bestKey } : null);
        return;
      }

      // Standard template: detect drop zone hover via data-slot elements
      const el = document.elementFromPoint(me.clientX, me.clientY);
      const zoneEl = el?.closest('[data-slot]');
      const hz = zoneEl ? { corner: zoneEl.dataset.corner, slot: zoneEl.dataset.slot } : null;
      currentHoverZone = hz;
      setDragging((d) => d ? { ...d, ghostX: me.clientX, ghostY: me.clientY, hoverZone: hz } : null);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (map) map.dragging.enable();

      if (isInSidebar) {
        // Reorder sidebar elements
        const order = [...(layoutSnapshot.sidePanelOrder || ['inset', 'legend', 'logo'])];
        const from = order.indexOf(id);
        if (from !== -1) {
          order.splice(from, 1);
          const insertAt = currentInsertIdx > from ? currentInsertIdx - 1 : currentInsertIdx;
          order.splice(Math.max(0, Math.min(order.length, insertAt)), 0, id);
        } else {
          // id not in order (e.g. title) — just drop into slot, no reorder needed
        }
        updateLayout({ sidePanelOrder: order });
      } else if (isMapInSidePanel) {
        const container = mapContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const zW = ghostW || 80, zH = ghostH || 48;
          const slots = getMapSlots();
          let sp = slots.find(s => s.id === currentMapSlot);
          if (!sp) {
            const cursorX = finalClientX - rect.left, cursorY = finalClientY - rect.top;
            let bestDist = Infinity;
            slots.forEach(s => { const d = Math.hypot(cursorX - s.left, cursorY - s.top); if (d < bestDist) { bestDist = d; sp = s; } });
          }
          if (sp) {
            const clampedLeft = Math.max(8, Math.min(mapSize.width - zW - 8, sp.left));
            const clampedTop = Math.max(8, Math.min(mapSize.height - zH - 8, sp.top));
            setProject((p) => ({
              ...p,
              layout: {
                ...p.layout,
                sidePanelPositions: { ...(p.layout.sidePanelPositions || {}), [id]: { top: clampedTop, left: clampedLeft } },
              },
            }));
          }
        }
      } else if (currentHoverZone) {
        const { corner, slot } = currentHoverZone;
        const cl = getCornerLayout(layoutSnapshot);
        const newCl = slot === 'first' ? moveToCornerFirst(cl, id, corner)
          : slot === 'beside' ? moveToCornerBeside(cl, id, corner)
          : moveToCorner(cl, id, corner);
        updateLayout({ cornerLayout: newCl, [CORNER_KEY[id]]: corner });
      }
      setDragging(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startResize = (e, { direction, elemId, startW, startH, minW = 40, maxW = 800, minH = 30, maxH = 600, applyW, applyH }) => {
    e.preventDefault();
    e.stopPropagation();
    const map = leafletMapRef.current;
    if (map) map.dragging.disable();
    const sx = e.clientX, sy = e.clientY;
    const initZone = resolvedZonesRef.current?.[elemId] || {};
    const zLeft = initZone.left != null ? initZone.left
      : initZone.right != null ? mapSize.width - initZone.right - startW : 0;
    const zTop = initZone.top != null ? initZone.top
      : initZone.bottom != null ? mapSize.height - initZone.bottom - startH : 0;
    const onMove = (me) => {
      const dx = me.clientX - sx, dy = me.clientY - sy;
      let newW = null, newH = null;
      if (direction.includes('r')) newW = Math.max(minW, Math.min(maxW, Math.round(startW + dx)));
      if (direction.includes('l')) newW = Math.max(minW, Math.min(maxW, Math.round(startW - dx)));
      if (direction.includes('b')) newH = Math.max(minH, Math.min(maxH, Math.round(startH + dy)));
      if (direction.includes('t')) newH = Math.max(minH, Math.min(maxH, Math.round(startH - dy)));
      const guides = [];
      const allZ = resolvedZonesRef.current ?? {};
      const SNAP = 7;
      for (const [zid, z] of Object.entries(allZ)) {
        if (zid === elemId || !(z?.width > 0)) continue;
        const zl = z.left != null ? z.left
          : z.right != null ? mapSize.width - z.right - z.width : null;
        const zt = z.top != null ? z.top
          : z.bottom != null ? mapSize.height - z.bottom - z.height : null;
        if (newW !== null && zl != null) {
          const re = zLeft + newW;
          for (const tx of [zl, zl + z.width]) {
            if (Math.abs(re - tx) <= SNAP) { newW = Math.max(minW, Math.round(tx - zLeft)); guides.push({ type: 'v', pos: tx }); break; }
          }
          if (!guides.find(g => g.type === 'v') && Math.abs(newW - z.width) <= SNAP) { newW = z.width; guides.push({ type: 'v', pos: zLeft + z.width }); }
        }
        if (newH !== null && zt != null) {
          const be = zTop + newH;
          for (const ty of [zt, zt + z.height]) {
            if (Math.abs(be - ty) <= SNAP) { newH = Math.max(minH, Math.round(ty - zTop)); guides.push({ type: 'h', pos: ty }); break; }
          }
          if (!guides.find(g => g.type === 'h') && Math.abs(newH - z.height) <= SNAP) { newH = z.height; guides.push({ type: 'h', pos: zTop + z.height }); }
        }
      }
      setResizeGuides(guides);
      if (newW !== null && applyW) applyW(newW);
      if (newH !== null && applyH) applyH(newH);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (map) map.dragging.enable();
      setResizeGuides([]);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const makeResizeHandles = (anchorCorner, { elemId, startW, startH, minW = 40, maxW = 800, minH = 30, maxH = 600, applyW, applyH }) => {
    const wDir = anchorCorner[1] === 'l' ? 'r' : 'l';
    const hDir = anchorCorner[0] === 't' ? 'b' : 't';
    const cDir = hDir + wDir;
    const cursorC = (cDir === 'br' || cDir === 'tl') ? 'nwse-resize' : 'nesw-resize';
    const wSide = wDir === 'r' ? 'right' : 'left';
    const hSide = hDir === 'b' ? 'bottom' : 'top';
    const go = (dir) => (e) => startResize(e, { direction: dir, elemId, startW, startH, minW, maxW, minH, maxH, applyW, applyH });
    return (
      <>
        {applyW && applyH && <div className="prh prh-corner" style={{ cursor: cursorC, [hSide]: -6, [wSide]: -6 }} onMouseDown={go(cDir)} />}
        {applyW && <div className="prh prh-edge" style={{ cursor: 'ew-resize', top: '50%', [wSide]: -6, transform: 'translateY(-50%)' }} onMouseDown={go(wDir)} />}
        {applyH && <div className="prh prh-edge" style={{ cursor: 'ns-resize', left: '50%', [hSide]: -6, transform: 'translateX(-50%)' }} onMouseDown={go(hDir)} />}
      </>
    );
  };

  const updateLayer = (layerId, patch) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => (layer.id === layerId ? { ...mergeDeep(layer, patch), userStyled: true } : layer)),
    }));
  };

  const moveLayer = (layerId, direction) => {
    setProject((prev) => {
      const idx = prev.layers.findIndex((layer) => layer.id === layerId);
      if (idx < 0) return prev;
      const next = [...prev.layers];
      const swap = direction === 'up' ? idx + 1 : idx - 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...prev, layers: next };
    });
  };

  const onMapReady = useCallback((map) => {
    leafletMapRef.current = map;
    setMapReady(true);
  }, []);

  const addGeoJSONAsLayer = async (geojson, fileName) => {
    const id = crypto.randomUUID();
    const baseName = fileName.replace(/\.(zip|geojson|json|kml|kmz|csv)$/i, '') || 'Layer';
    const kind = detectLayerKind(geojson);
    const role = inferRoleFromLayer({ name: baseName, type: kind });
    const displayName = cleanLayerName(baseName, role);
    // Count how many claims layers already exist so the new one gets a contrast color
    const existingClaimsCount = project.layers.filter((l) => l.role === 'claims').length;

    const nextLayer = applyRoleToLayer(
      {
        id,
        name: baseName,
        sourceName: fileName,
        displayName,
        type: kind,
        visible: true,
        role,
        geojson,
        userStyled: false,
        legend: {
          enabled: true,
          label: displayName,
        },
      },
      role,
      existingClaimsCount
    );

    setProject((prev) => {
      const allLayers = [...prev.layers, nextLayer];
      const next = {
        ...prev,
        layers: allLayers,
        layout: {
          ...prev.layout,
          primaryLayerId: prev.layout.primaryLayerId || id,
          frameVersion: (prev.layout.frameVersion || 0) + 1,
        },
      };
      return applyModeToProject(next, template, prev.layout.mode);
    });

    // Detect region from the new layer's bounds only (not the union of all layers,
    // which would misplace the centroid when layers span multiple regions).
    const newLayerBounds = geojsonBounds(nextLayer.geojson);
    detectRegion(newLayerBounds).then(region => {
      if (region) {
        setProject(prev => ({
          ...prev,
          layout: { ...prev.layout, autoInsetRegion: region },
        }));
      }
    }).catch(() => {});

    setSelectedLayerId(id);
    setUploadStatus({ type: 'success', message: `Imported ${fileName}. ${kind === 'points' ? 'Point layer detected.' : 'Layer added successfully.'}` });
  };

  const addGeoJSONLayer = async (file) => {
    const geojson = await loadGeoJSON(file);
    await addGeoJSONAsLayer(geojson, file.name);
  };

  const handleUploadFile = async (file) => {
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv')) {
        const result = await loadCSV(file);
        if (result.needsMapping) {
          setCsvMappingData({ headers: result.headers, rows: result.rows, filename: file.name });
        } else {
          await addGeoJSONAsLayer(result, file.name);
          if (screen !== 'editor') setScreen('editor');
        }
      } else {
        await addGeoJSONLayer(file);
        if (screen !== 'editor') setScreen('editor');
      }
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Import failed: ${err.message}` });
    }
  };

  const handleUploadFiles = async (files) => {
    try {
      const shpName = files.find((f) => f.name.toLowerCase().endsWith('.shp'))?.name || 'shapefile';
      const geojson = await loadShapefileSet(files);
      await addGeoJSONAsLayer(geojson, shpName);
      if (screen !== 'editor') setScreen('editor');
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Import failed: ${err.message}` });
    }
  };

  const SAMPLE_STYLE_PRESETS = {
    drill_plan:     { basemap: 'satellite', mode: 'drill_plan' },
    claims:         { basemap: 'light',     mode: 'regional_claims' },
    target:         { basemap: 'light',     mode: 'target_anomaly' },
    regional:       { basemap: 'terrain',   mode: 'project_overview' },
    infrastructure: { basemap: 'streets',   mode: 'access_location' },
    dark:           { basemap: 'dark',      mode: 'drill_plan' },
  };

  const loadSampleData = async (styleId) => {
    const makeFile = (json, name) => new File([JSON.stringify(json)], name, { type: 'application/json' });
    setProject(createInitialProjectState());
    try {
      await addGeoJSONLayer(makeFile(sampleClaims, 'Sample Claims.geojson'));
      await addGeoJSONLayer(makeFile(sampleDrillholes, 'Sample Drillholes.geojson'));
      const styleOverride = styleId ? (SAMPLE_STYLE_PRESETS[styleId] || {}) : {};
      updateLayout({
        logo: SAMPLE_LOGO_URL,
        accentColor: SAMPLE_ACCENT,
        title: 'Buckhorn Creek Property',
        subtitle: 'Cariboo Region, British Columbia',
        footerText: 'Buckhorn Creek Mining Corp. | Cariboo Region, BC | For internal use only',
        footerEnabled: true,
        exportSettings: { filename: 'buckhorn-creek-property', pixelRatio: 2 },
        ...styleOverride,
      });
      applyBrandPaletteToLayers(SAMPLE_ACCENT);
      setScreen('editor');
      setUploadStatus({ type: 'success', message: 'Sample data loaded. Explore the editor and export to try it out.' });
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Sample data error: ${err.message}` });
    }
  };

  const hexToHsl = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    let h = 0; let s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  };

  const hslToHex = (h, s, l) => {
    const hn = ((h % 360) + 360) % 360;
    const sn = s / 100; const ln = l / 100;
    const k = (n) => (n + hn / 30) % 12;
    const a = sn * Math.min(ln, 1 - ln);
    const f = (n) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };

  const extractDominantColor = (imageData) => {
    const buckets = {};
    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i]; const g = imageData[i + 1]; const b = imageData[i + 2]; const a = imageData[i + 3];
      if (a < 128) continue;
      const brightness = (r + g + b) / 3;
      if (brightness > 220 || brightness < 30) continue;
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const [rk, gk, bk] = top[0].split(',').map(Number);
    return '#' + [rk << 5, gk << 5, bk << 5].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
  };

  const applyBrandPaletteToLayers = (color) => {
    const [h, s] = hexToHsl(color);
    const sat = Math.max(s, 62);
    const claimsStroke = hslToHex(h, sat, 48);
    const claimsFill   = hslToHex(h, Math.max(s, 42), 76);
    const targetsStroke = hslToHex((h + 150) % 360, Math.max(s, 65), 48);
    const targetsFill   = hslToHex((h + 150) % 360, Math.max(s, 48), 76);
    const drillColor    = hslToHex(h, Math.max(s, 65), 24);
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => {
        if (layer.role === 'claims') {
          return { ...layer, style: { ...layer.style, stroke: claimsStroke, fill: claimsFill } };
        }
        if (layer.role === 'target_areas' || layer.role === 'anomalies') {
          return { ...layer, style: { ...layer.style, stroke: targetsStroke, fill: targetsFill } };
        }
        if (POINT_ROLES.has(layer.role)) {
          return { ...layer, style: { ...layer.style, markerColor: drillColor, markerFill: '#ffffff' } };
        }
        return layer;
      }),
    }));
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setUploadStatus({ type: 'error', message: 'Logo image must be under 3 MB.' });
      e.target.value = '';
      return;
    }
    try {
      let dataUrl = await readFileAsDataURL(file);
      if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
        dataUrl = sanitizeSvgDataUrl(dataUrl);
      }
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 64; canvas.height = 64;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 64, 64);
          const { data } = ctx.getImageData(0, 0, 64, 64);
          const color = extractDominantColor(data);
          if (color) {
            const [h, s] = hexToHsl(color);
            const titleBg = hslToHex(h, Math.max(s, 68), 18);
            updateLayout({ logo: dataUrl, accentColor: color, titleBgColor: titleBg, titleFgColor: '#ffffff' });
            applyBrandPaletteToLayers(color);
          } else {
            updateLayout({ logo: dataUrl });
          }
        } catch {
          updateLayout({ logo: dataUrl });
        }
      };
      img.onerror = () => updateLayout({ logo: dataUrl });
      img.src = dataUrl;
      setUploadStatus({ type: 'success', message: `Loaded logo: ${file.name}. Brand colours applied.` });
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Logo import failed: ${err.message}` });
    } finally {
      e.target.value = '';
    }
  };

  const handleInsetImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setUploadStatus({ type: 'error', message: 'Inset image must be under 3 MB.' });
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await readFileAsDataURL(file);
      const aspectRatio = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
      updateLayout({ insetImage: dataUrl, insetMode: 'custom_image', insetEnabled: true, insetAspectRatio: aspectRatio });
      setUploadStatus({ type: 'success', message: `Loaded inset image: ${file.name}` });
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Inset import failed: ${err.message}` });
    } finally {
      e.target.value = '';
    }
  };

  const toggleLayerVisible = (layerId) => {
    const layer = project.layers.find((item) => item.id === layerId);
    if (!layer) return;
    updateLayer(layerId, { visible: layer.visible === false });
  };

  const removeLayer = (layerId) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.filter((layer) => layer.id !== layerId),
      layout: {
        ...prev.layout,
        primaryLayerId: prev.layout.primaryLayerId === layerId ? null : prev.layout.primaryLayerId,
      },
    }));
    setSelectedLayerId((prev) => (prev === layerId ? null : prev));
  };

  const featureKey = (feature) => {
    if (!feature) return null;
    return feature.id != null ? String(feature.id)
      : feature.properties?.hole_id || feature.properties?.holeid
      || feature.properties?.id || feature.properties?.name
      || JSON.stringify(feature.geometry?.coordinates);
  };

  const setFeatureOverride = (layerId, key, overrides) => {
    if (!key) return;
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        return {
          ...layer,
          featureOverrides: {
            ...(layer.featureOverrides || {}),
            [key]: { ...(layer.featureOverrides?.[key] || {}), ...overrides },
          },
        };
      }),
    }));
  };

  const changeLayerRole = (layerId, role) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        const displayName = cleanLayerName(layer.displayName || layer.name, role);
        return { ...applyRoleToLayer({ ...layer, displayName, legend: { ...(layer.legend || {}), label: displayName } }, role), userStyled: true };
      }),
    }));
  };

  const applyMode = (mode) => {
    setProject((prev) => applyModeToProject(prev, template, mode));
  };


  const setDisplayLabel = (itemId, value) => {
    if (itemId.includes('::')) {
      const sep = itemId.lastIndexOf('::');
      const layerId = itemId.slice(0, sep);
      const shape = itemId.slice(sep + 2);
      setProject((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) => layer.id !== layerId ? layer : {
          ...layer,
          legend: { ...(layer.legend || {}), shapeLabels: { ...(layer.legend?.shapeLabels || {}), [shape]: value } },
        }),
      }));
      return;
    }
    updateLayer(itemId, { displayName: value, legend: { label: value } });
  };

  const setFramingLayer = (layerId) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        primaryLayerId: prev.layout.primaryLayerId === layerId ? null : layerId,
        frameVersion: (prev.layout.frameVersion || 0) + 1,
      },
    }));
  };

  const autoFrameAll = () => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        primaryLayerId: null,
        frameVersion: (prev.layout.frameVersion || 0) + 1,
      },
    }));
  };

  const improveMap = () => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        legendMode: prev.layers.length > 4 ? 'full' : 'auto',
        titleWidth: prev.layout.title?.length > 30 ? 'wide' : 'standard',
        referenceOpacity: 0.72,
        insetEnabled: true,
        insetSize: 'medium',
        safeMargins: { top: 22, right: 22, bottom: 22, left: 22 },
        compositionPreset: 'balanced',
        logoScale: Math.max(0.85, Math.min(1.15, Number(prev.layout.logoScale || 1))),
        insetScale: Math.max(0.9, Math.min(1.1, Number(prev.layout.insetScale || 1))),
        zoomPercent: 100,
        frameVersion: (prev.layout.frameVersion || 0) + 1,
      },
      callouts: prev.callouts.map((callout, idx) => ({
        ...callout,
        priority: idx < 2 ? 1 : 2,
        offset: callout.offset || { x: 20, y: -18 },
      })),
    }));
    setUploadStatus({ type: 'success', message: 'Applied polished default template spacing and alignment.' });
  };

  const addCalloutAtAnchor = ({ text, subtext = '', type = 'leader', anchor, featureId, layerId, style = {}, boxWidth = 188, badgeValue, badgeColor }) => {
    const calloutId = crypto.randomUUID();
    setProject((prev) => {
      const accent = prev.layout?.accentColor || null;
      return {
        ...prev,
        callouts: [
          ...prev.callouts,
          {
            id: calloutId,
            text,
            subtext,
            type,
            priority: 2,
            anchor,
            offset: { x: 20, y: -18 },
            featureId: featureId || null,
            layerId: layerId || null,
            boxWidth,
            ...(badgeValue !== undefined ? { badgeValue } : {}),
            ...(badgeColor !== undefined ? { badgeColor } : {}),
            style: {
              background: '#ffffff',
              border: accent || '#102640',
              textColor: '#0f172a',
              subtextColor: '#475569',
              fontSize: 12,
              paddingX: 10,
              paddingY: 8,
              ...style,
            },
          },
        ],
      };
    });
    setSelectedCalloutId(calloutId);
  };

  const addCalloutFromSelectedLayer = () => {
    if (!selectedLayer?.geojson) return;
    const center = geojsonCenter(selectedLayer.geojson);
    if (!center) return;
    addCalloutAtAnchor({
      text: selectedLayer.displayName || selectedLayer.legend?.label || selectedLayer.name,
      type: POINT_ROLES.has(selectedLayer.role) ? 'leader' : 'boxed',
      anchor: { lat: center.lat, lng: center.lng },
      layerId: selectedLayer.id,
    });
    setSelectedCalloutId(null);
  };

  const updateCallout = (calloutId, patch) => {
    setProject((prev) => ({
      ...prev,
      callouts: prev.callouts.map((callout) => (callout.id === calloutId ? { ...callout, ...patch } : callout)),
    }));
  };

  const nudgeCallout = (calloutId, dx, dy) => {
    setProject((prev) => ({
      ...prev,
      callouts: prev.callouts.map((callout) =>
        callout.id === calloutId
          ? { ...callout, offset: { x: (callout.offset?.x || 0) + dx, y: (callout.offset?.y || 0) + dy }, isManualPosition: true }
          : callout
      ),
    }));
  };

  const removeCallout = (calloutId) => {
    setProject((prev) => ({ ...prev, callouts: prev.callouts.filter((callout) => callout.id !== calloutId) }));
    if (selectedCalloutId === calloutId) setSelectedCalloutId(null);
  };

  const handleFeatureClick = ({ layerId, feature, latlng, isLayerSelect }) => {
    const layer = project.layers.find((item) => item.id === layerId) || null;
    if (!layer) return;
    setAnnotationTool(null);
    annotationToolRef.current = null;
    setSelectedMarkerId(null);
    setSelectedEllipseId(null);
    if (isLayerSelect) {
      setSelectedLayerId(layerId);
      setSelectedFeature(null);
      return;
    }
    setSelectedFeature({
      layerId,
      layerName: layer.displayName || layer.name,
      role: layer.role,
      feature,
      latlng: { lat: latlng.lat, lng: latlng.lng },
      featureId: feature?.id || feature?.properties?.id || `${layerId}:${latlng.lat.toFixed(6)}:${latlng.lng.toFixed(6)}`,
      suggestedLabel: getFeatureLabel(feature, layer),
      suggestedSubtext: feature?.properties?.result || feature?.properties?.interval || feature?.properties?.notes || '',
      boxWidth: 188,
      calloutType: 'leader',
      style: {
        background: '#ffffff',
        border: '#102640',
        textColor: '#0f172a',
        subtextColor: '#475569',
        fontSize: 12,
        paddingX: 10,
        paddingY: 8,
      },
    });
  };

  const addCalloutFromSelectedFeature = () => {
    if (!selectedFeature?.latlng) return;
    addCalloutAtAnchor({
      text: selectedFeature.suggestedLabel,
      subtext: selectedFeature.suggestedSubtext || '',
      type: selectedFeature.calloutType || 'leader',
      anchor: selectedFeature.latlng,
      featureId: selectedFeature.featureId,
      layerId: selectedFeature.layerId,
      boxWidth: selectedFeature.boxWidth || 188,
      style: selectedFeature.style || {},
      badgeValue: selectedFeature.badgeValue,
      badgeColor: selectedFeature.badgeColor,
    });
    setSelectedCalloutId(null);
    setSelectedFeature(null);
  };

  const addMarkerAt = (latlng) => {
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      markers: [
        ...(prev.markers || []),
        {
          id,
          lat: latlng.lat,
          lng: latlng.lng,
          ...(prev.layout?.markerDefaults || { type: 'circle', size: 18, label: '' }),
          color: prev.layout?.accentColor || '#dc2626',
        },
      ],
    }));
    setSelectedMarkerId(id);
    setSelectedEllipseId(null);
    setSelectedCalloutId(null);
  };

  const addEllipseAt = (latlng) => {
    const id = crypto.randomUUID();
    setProject((prev) => {
      const accent = prev.layout?.accentColor || null;
      const defaults = prev.layout?.zoneDefaults || { width: 90, height: 56, rotation: -18, color: '#dc2626', dashed: true, label: '' };
      return {
        ...prev,
        ellipses: [
          ...(prev.ellipses || []),
          {
            id,
            lat: latlng.lat,
            lng: latlng.lng,
            ...defaults,
            color: accent || defaults.color || '#dc2626',
          },
        ],
      };
    });
    setSelectedEllipseId(id);
    setSelectedMarkerId(null);
    setSelectedCalloutId(null);
  };

  const addRingAt = (latlng) => {
    const id = crypto.randomUUID();
    let radiusKm = 10;
    if (leafletMapRef.current) {
      const bounds = leafletMapRef.current.getBounds();
      const spanKm = (bounds.getNorth() - bounds.getSouth()) * 111.32;
      radiusKm = Math.max(1, Math.round(spanKm * 0.22));
    }
    setProject((prev) => ({
      ...prev,
      ellipses: [
        ...(prev.ellipses || []),
        { id, lat: latlng.lat, lng: latlng.lng, isRing: true, radiusKm, color: prev.layout?.accentColor || '#dc2626', dashed: true, label: '' },
      ],
    }));
    setSelectedEllipseId(id);
    setSelectedMarkerId(null);
    setSelectedCalloutId(null);
  };

  const addMapLabelAt = (latlng) => {
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      markers: [
        ...(prev.markers || []),
        { id, lat: latlng.lat, lng: latlng.lng, type: 'maplabel', label: 'REGION NAME', size: 28, color: '#1e293b', opacity: 0.35, rotation: 0, bold: true, tracking: 0.12 },
      ],
    }));
    setSelectedMarkerId(id);
    setSelectedEllipseId(null);
    setSelectedCalloutId(null);
  };

  const addDistanceLine = (p1, p2) => {
    const id = crypto.randomUUID();
    setProject(prev => ({
      ...prev,
      distanceLines: [...(prev.distanceLines || []), { id, p1, p2, color: '#e11d48', units: 'km' }],
    }));
    setSelectedDistanceLineId(id);
  };
  const removeDistanceLine = (id) => {
    setProject(prev => ({ ...prev, distanceLines: (prev.distanceLines || []).filter(d => d.id !== id) }));
    if (selectedDistanceLineId === id) setSelectedDistanceLineId(null);
  };
  const updateDistanceLine = (id, patch) => {
    setProject(prev => ({ ...prev, distanceLines: (prev.distanceLines || []).map(d => d.id === id ? { ...d, ...patch } : d) }));
  };

  const handleMapClick = (latlng) => {
    if (annotationTool === 'marker') {
      addMarkerAt(latlng);
      setAnnotationTool(null);
      annotationToolRef.current = null;
    } else if (annotationTool === 'ellipse') {
      addEllipseAt(latlng);
      setAnnotationTool(null);
      annotationToolRef.current = null;
    } else if (annotationTool === 'ring') {
      addRingAt(latlng);
      setAnnotationTool(null);
      annotationToolRef.current = null;
    } else if (annotationTool === 'maplabel') {
      addMapLabelAt(latlng);
      setAnnotationTool(null);
      annotationToolRef.current = null;
    } else if (annotationTool === 'polygon') {
      // Check if clicking near first point to close polygon
      if (pendingPolygonPoints.length >= 3 && leafletMapRef.current) {
        const firstPt = leafletMapRef.current.latLngToContainerPoint([pendingPolygonPoints[0].lat, pendingPolygonPoints[0].lng]);
        const thisPt = leafletMapRef.current.latLngToContainerPoint([latlng.lat, latlng.lng]);
        const dist = Math.hypot(thisPt.x - firstPt.x, thisPt.y - firstPt.y);
        if (dist < 18) {
          finishPolygon();
          return;
        }
      }
      setPendingPolygonPoints((prev) => [...prev, { lat: latlng.lat, lng: latlng.lng }]);
    } else if (annotationTool === 'distanceLine') {
      if (!pendingDistanceP1) {
        setPendingDistanceP1({ lat: latlng.lat, lng: latlng.lng });
      } else {
        addDistanceLine(pendingDistanceP1, { lat: latlng.lat, lng: latlng.lng });
        setPendingDistanceP1(null);
        setAnnotationTool(null);
        annotationToolRef.current = null;
      }
    }
  };

  const zoomDelta = Math.max(-8, Math.min(8, Number(project.layout.zoomDelta ?? 0)));
  const featureEditorPoint = useMemo(() => {
    if (!leafletMapRef.current || !selectedFeature?.latlng) return null;
    const pt = leafletMapRef.current.latLngToContainerPoint([selectedFeature.latlng.lat, selectedFeature.latlng.lng]);
    const maxLeft = Math.max(12, mapSize.width - 292);
    const maxTop = Math.max(12, mapSize.height - 340);
    return {
      left: Math.min(maxLeft, Math.max(12, pt.x + 14)),
      top: Math.min(maxTop, Math.max(70, pt.y - 24)),
    };
  }, [selectedFeature, mapSize, featureEditorTick]);

  const updateMarker = (markerId, patch) => {
    setProject((prev) => ({
      ...prev,
      markers: (prev.markers || []).map((marker) => (marker.id === markerId ? { ...marker, ...patch } : marker)),
    }));
  };

  const updateEllipse = (ellipseId, patch) => {
    setProject((prev) => ({
      ...prev,
      ellipses: (prev.ellipses || []).map((ellipse) => (ellipse.id === ellipseId ? { ...ellipse, ...patch } : ellipse)),
    }));
  };

  const removeMarker = (markerId) => {
    setProject((prev) => ({ ...prev, markers: (prev.markers || []).filter((marker) => marker.id !== markerId) }));
    if (selectedMarkerId === markerId) setSelectedMarkerId(null);
  };

  const removeEllipse = (ellipseId) => {
    setProject((prev) => ({ ...prev, ellipses: (prev.ellipses || []).filter((ellipse) => ellipse.id !== ellipseId) }));
    if (selectedEllipseId === ellipseId) setSelectedEllipseId(null);
  };

  const updatePolygon = (polyId, patch) => {
    setProject((prev) => ({
      ...prev,
      polygons: (prev.polygons || []).map((poly) => (poly.id === polyId ? { ...poly, ...patch } : poly)),
    }));
  };

  const removePolygon = (polyId) => {
    setProject((prev) => ({ ...prev, polygons: (prev.polygons || []).filter((poly) => poly.id !== polyId) }));
    if (selectedPolygonId === polyId) setSelectedPolygonId(null);
  };

  const finishPolygon = () => {
    if (pendingPolygonPoints.length < 3) return;
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      polygons: [
        ...(prev.polygons || []),
        {
          id,
          points: pendingPolygonPoints,
          color: prev.layout?.accentColor || '#000000',
          strokeWidth: 2,
          dashed: true,
          label: '',
          labelFontSize: 13,
          labelBold: true,
          labelColor: null,
          labelOffsetX: 0,
          labelOffsetY: 0,
          smoothed: false,
          outsideShade: false,
          outsideShadeColor: '#000000',
          outsideShadeOpacity: 0.35,
        },
      ],
    }));
    setPendingPolygonPoints([]);
    setAnnotationTool(null);
    annotationToolRef.current = null;
    setSelectedPolygonId(id);
    setSelectedEllipseId(null);
    setSelectedMarkerId(null);
    setSelectedCalloutId(null);
  };

  const handleExport = async (format, extraOptions = {}) => {
    if (exporting) return;
    setExportError('');
    if (!leafletMapRef.current || !mapContainerRef.current) {
      setExportError('Map not ready — please wait a moment then try again.');
      return;
    }
    setExporting(true);
    try {
      const [{ buildScene }, { exportPNG }, { exportSVG }, { getExportWarnings }] = await Promise.all([
        import('./export/buildScene'),
        import('./export/exportPNG'),
        import('./export/exportSVG'),
        import('./export/renderScene'),
      ]);
      const scene = buildScene(mapContainerRef.current, { ...project, layout: { ...project.layout, legendItems } }, leafletMapRef.current);
      const opts = { ...(project.layout?.exportSettings || {}), ...extraOptions };
      if (format === 'png') {
        await exportPNG(scene, opts);
      } else if (format === 'svg' || format === 'svg_ai') {
        await exportSVG(scene, { ...opts, illustratorMode: format === 'svg_ai' });
      } else if (format === 'pdf') {
        const { exportPDF } = await import('./export/exportPDF');
        await exportPDF(scene, opts);
      }
      const warnings = getExportWarnings();
      if (warnings.length > 0) {
        setUploadStatus({ type: 'info', message: `Export complete — note: ${warnings.join('; ')}.` });
      }
      // Track export event (fire-and-forget — doesn't block export)
      if (supabase) {
        supabase.from('export_events').insert({
          user_id: user?.id ?? null,
          format,
          project_name: project.layout?.title || projectName || 'Untitled',
          noWatermark: Boolean(extraOptions.noWatermark),
        }).then(() => {});
      }
    } catch (err) {
      setExportError(`Export failed: ${err.message}`);
      setUploadStatus({ type: 'error', message: `Export failed: ${err.message}` });
    } finally {
      setExporting(false);
    }
  };

  const handleExportClick = (format) => {
    // PDF always shows the modal so the user can choose the page size
    if (format !== 'pdf' && getLastLeadEmail()) {
      handleExport(format, { noWatermark: true });
    } else {
      setPendingExportFormat(format);
      setShowExportModal(true);
    }
  };

  const handleExportModalConfirm = async (email, extraOpts = {}) => {
    setShowExportModal(false);
    saveLead({ email, projectTitle: project.layout?.title || '' });
    await handleExport(pendingExportFormat, { noWatermark: true, ...extraOpts });
  };

  const handleExportModalWithWatermark = () => {
    setShowExportModal(false);
    handleExport(pendingExportFormat, { noWatermark: false });
  };


  const saveCurrentProject = async (nextName = null) => {
    const nameToSave = (nextName || projectName || project.layout?.title || 'Untitled map').trim();
    const idToSave = projectId || crypto.randomUUID();
    if (user) {
      try {
        const cloudId = await saveCloudProject({ id: idToSave, name: nameToSave, payload: project });
        setProjectId(cloudId);
        setProjectName(nameToSave);
        lastSavedSnapshotRef.current = JSON.stringify(project);
        setIsDirty(false);
        saveDraft({ payload: project, projectId: cloudId, projectName: nameToSave });
        listCloudProjects().then(setRecentProjects).catch(() => {});
        setUploadStatus({ type: 'success', message: `Saved to cloud: ${nameToSave}` });
      } catch (err) {
        setUploadStatus({ type: 'error', message: `Cloud save failed: ${err.message}` });
      }
    } else {
      const saved = saveProjectRecord({ id: idToSave, name: nameToSave, payload: project });
      setProjectId(saved.id);
      setProjectName(saved.name);
      setRecentProjects(listProjects());
      lastSavedSnapshotRef.current = JSON.stringify(project);
      setIsDirty(false);
      saveDraft({ payload: project, projectId: saved.id, projectName: saved.name });
      setUploadStatus({ type: 'success', message: `Saved project: ${saved.name}` });
    }
  };

  const nextFreeName = (base, existing) => {
    if (!existing.includes(base)) return base;
    let n = 2;
    while (existing.includes(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  };

  const saveAsProject = async () => {
    const existingNames = recentProjects.map(p => p.name);
    const defaultName = nextFreeName(projectName || project.layout?.title || 'Untitled map', existingNames);
    const nextName = window.prompt('Save project as', defaultName);
    if (!nextName) return;
    const nameToSave = nextName.trim();
    if (user) {
      try {
        const cloudId = await saveCloudProject({ id: null, name: nameToSave, payload: project });
        setProjectId(cloudId);
        setProjectName(nameToSave);
        lastSavedSnapshotRef.current = JSON.stringify(project);
        setIsDirty(false);
        saveDraft({ payload: project, projectId: cloudId, projectName: nameToSave });
        listCloudProjects().then(setRecentProjects).catch(() => {});
        setUploadStatus({ type: 'success', message: `Saved to cloud as: ${nameToSave}` });
      } catch (err) {
        setUploadStatus({ type: 'error', message: `Cloud save failed: ${err.message}` });
      }
    } else {
      const saved = saveProjectRecord({ id: crypto.randomUUID(), name: nameToSave, payload: project });
      setProjectId(saved.id);
      setProjectName(saved.name);
      setRecentProjects(listProjects());
      lastSavedSnapshotRef.current = JSON.stringify(project);
      setIsDirty(false);
      saveDraft({ payload: project, projectId: saved.id, projectName: saved.name });
      setUploadStatus({ type: 'success', message: `Saved as new project: ${saved.name}` });
    }
  };

  const doSaveTemplate = async () => {
    const name = (savingTemplateName || '').trim();
    if (!name || savingTemplate) return;
    setSavingTemplate(true);
    try {
      const config = Object.fromEntries(
        TEMPLATE_SAVEABLE_KEYS
          .filter((k) => project.layout[k] !== undefined)
          .map((k) => [k, project.layout[k]])
      );
      if (project.layout.fonts) config.fonts = project.layout.fonts;
      await saveTemplate({ name, config });
      listTemplates().then(setCloudTemplates).catch(() => {});
      setSavingTemplateName(null);
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Could not save template: ${err.message}` });
    } finally {
      setSavingTemplate(false);
    }
  };

  const openProjectFromRecent = async (entry) => {
    let payload = entry.payload;
    if (!payload && user) {
      try {
        const full = await loadCloudProject(entry.id);
        payload = full.payload;
      } catch (err) {
        setUploadStatus({ type: 'error', message: `Failed to open project: ${err.message}` });
        return;
      }
    }
    if (!payload) return;
    skipAutoFitRef.current = true;
    setProject(payload);
    setProjectId(entry.id);
    setProjectName(entry.name);
    setSelectedLayerId(null);
    setSelectedCalloutId(null);
    setSelectedFeature(null);
    setSelectedMarkerId(null);
    setSelectedEllipseId(null);
    setAnnotationTool(null);
    setShowRecentProjects(false);
    touchLastOpenedProject(entry.id);
    saveDraft({ payload, projectId: entry.id, projectName: entry.name });
    lastSavedSnapshotRef.current = JSON.stringify(payload);
    setIsDirty(false);
    setUploadStatus({ type: 'success', message: `Opened project: ${entry.name}` });
  };

  const duplicateCurrentProject = async () => {
    const name = `${projectName || project.layout?.title || 'Untitled map'} Copy`;
    if (user) {
      try {
        const cloudId = await saveCloudProject({ id: null, name, payload: project });
        setProjectId(cloudId);
        setProjectName(name);
        lastSavedSnapshotRef.current = JSON.stringify(project);
        setIsDirty(false);
        saveDraft({ payload: project, projectId: cloudId, projectName: name });
        listCloudProjects().then(setRecentProjects).catch(() => {});
        setUploadStatus({ type: 'success', message: `Duplicated to cloud as: ${name}` });
      } catch (err) {
        setUploadStatus({ type: 'error', message: `Cloud duplicate failed: ${err.message}` });
      }
    } else {
      const saved = duplicateProjectRecord({ sourcePayload: project, name });
      setProjectId(saved.id);
      setProjectName(saved.name);
      setRecentProjects(listProjects());
      lastSavedSnapshotRef.current = JSON.stringify(project);
      setIsDirty(false);
      saveDraft({ payload: project, projectId: saved.id, projectName: saved.name });
      setUploadStatus({ type: 'success', message: `Duplicated project as: ${saved.name}` });
    }
  };


  const startNewProject = () => {
    const blank = createInitialProjectState();
    setProject(blank);
    setProjectId(null);
    setProjectName('Untitled map');
    setSelectedLayerId(null);
    setSelectedCalloutId(null);
    setSelectedFeature(null);
    setSelectedMarkerId(null);
    setSelectedEllipseId(null);
    setAnnotationTool(null);
    setShowRecentProjects(false);
    clearActiveProjectContext();
    saveDraft({ payload: blank, projectId: null, projectName: 'Untitled map' });
    lastSavedSnapshotRef.current = JSON.stringify(blank);
    setIsDirty(false);
    setUploadStatus({ type: 'success', message: 'Started a new blank project workspace.' });
  };

  const referenceOverlays = project.layout.referenceOverlays || {};

  if (screen === 'admin') {
    return <AdminPage onExit={() => setScreen('landing')} />;
  }

  if (screen === 'landing') {
    return (
      <>
        <LandingPage
          onOpenEditor={() => setScreen('editor')}
          onLoadSample={loadSampleData}
          onLoadSampleStyle={(styleId) => loadSampleData(styleId)}
          recentProjects={recentProjects}
          onOpenProject={(entry) => { openProjectFromRecent(entry); setScreen('editor'); }}
          onShowHelp={() => setShowHelpModal(true)}
        />
        {showHelpModal && <React.Suspense fallback={null}><HowToUseModal onClose={() => setShowHelpModal(false)} /></React.Suspense>}
      </>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar footer={<UserMenu onOpenTemplates={() => setShowTemplateManager(true)} />}>
        <div className="sidebar-header-row">
          <button className="sidebar-wordmark" type="button" onClick={() => setScreen('landing')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#2563eb" />
            </svg>
            Exploration Maps
          </button>
          <button className="sidebar-home-link" type="button" onClick={() => setScreen('landing')}>← Home</button>
        </div>

        {project.layers.length === 0 ? (
          <div className="onboarding-card">
            <div className="onboarding-title">Get started</div>
            <ol className="onboarding-steps">
              <li>Upload claims / property boundary (GeoJSON or .zip shapefile)</li>
              <li>Upload your logo — colours will be auto-applied to the map</li>
              <li>Upload an inset image</li>
              <li>Upload drillholes or other layers (optional)</li>
            </ol>
            <button className="sample-data-link" type="button" onClick={loadSampleData}>
              Or load sample mining data →
            </button>
          </div>
        ) : null}

        <UploadPanel onUploadFile={handleUploadFile} onUploadFiles={handleUploadFiles} inputRef={uploadInputRef} status={uploadStatus} layers={project.layers} />

        <div className={`logo-upload-card${project.layout.logo ? ' has-logo' : ''}`}>
          {project.layout.logo ? (
            <>
              <img className="logo-thumb" src={project.layout.logo} alt="Logo" />
              <div className="logo-card-info">
                <span className="logo-card-status">Brand colors applied</span>
                <div className="logo-card-actions">
                  <button className="btn compact" type="button" onClick={() => logoInputRef.current?.click()}>Replace</button>
                  <button className="secondary-btn compact" type="button" onClick={() => updateLayout({ logo: null, accentColor: null, titleBgColor: null, titleFgColor: null })}>Remove</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <button className="logo-upload-btn" type="button" onClick={() => logoInputRef.current?.click()}>
                <span className="logo-upload-icon">↑</span> Upload Logo
              </button>
              <span className="logo-card-hint">Auto-applies your brand colors</span>
            </>
          )}
        </div>
        <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} hidden />

        <section className="control-section">
          <h2>Content</h2>
          <div className="control-grid">
            <div className="control-row">
              <label>Template</label>
              <select
                value={project.layout.templateId || 'technical_results_v2'}
                onChange={(e) => {
                  const tid = e.target.value;
                  const themeMap = {
                    'technical_results_v2': 'investor_clean',
                    'ni_43101_technical': 'ni_43101',
                    'side_panel': 'technical_sharp',
                  };
                  const extra = tid === 'side_panel' ? {
                    sidePanelPositions: {},
                    insetEnabled: true,
                    insetHeightPx: null,
                    legendHeightPx: null,
                    titleHeightPx: 108,
                  } : {};
                  updateLayout({ templateId: tid, themeId: themeMap[tid] || 'investor_clean', stripTitle: '', stripSubtitle: '', ...extra });
                }}
              >
                <option value="technical_results_v2">Standard</option>
                <option value="ni_43101_technical">NI 43-101</option>
                <option value="side_panel">Technical</option>
              </select>
            </div>
            {project.layout.templateId === 'side_panel' && Object.keys(project.layout.sidePanelPositions || {}).length > 0 && (
              <div style={{ padding: '4px 0 6px' }}>
                <button className="secondary-btn" style={{ width: '100%', fontSize: 12 }} onClick={() => updateLayout({ sidePanelPositions: {} })}>
                  Reset Panel Layout
                </button>
              </div>
            )}
            <hr style={{ margin: '4px 0 8px', border: 'none', borderTop: '1px solid #e8eef6' }} />
            <div className="control-row"><label>Title</label><input value={localTitle} onChange={(e) => {
              const val = e.target.value;
              setLocalTitle(val);
              clearTimeout(titleDebounceRef.current);
              titleDebounceRef.current = setTimeout(() => updateLayout({ title: val }), 300);
            }} /></div>
            <div className="control-row"><label>Subtitle</label><input value={localSubtitle} onChange={(e) => {
              const val = e.target.value;
              setLocalSubtitle(val);
              clearTimeout(subtitleDebounceRef.current);
              subtitleDebounceRef.current = setTimeout(() => updateLayout({ subtitle: val }), 300);
            }} /></div>
            <div className="control-row" style={{ alignItems: 'center' }}>
              <label>Title Size</label>
              <input type="range" min="0.6" max="1.5" step="0.05" value={project.layout.titleFontScale ?? 1} onChange={(e) => updateLayout({ titleFontScale: parseFloat(e.target.value) })} style={{ flex: 1 }} />
              <span style={{ fontSize: 11, marginLeft: 6, minWidth: 32 }}>{Math.round((project.layout.titleFontScale ?? 1) * 100)}%</span>
            </div>
            <div className="control-row-stack">
              <label>Basemap</label>
              <div className="basemap-picker">
                {BASEMAP_OPTIONS.map(({ key, label, bg, water }) => (
                  <button
                    key={key}
                    type="button"
                    className={`basemap-thumb${(project.layout.basemap || 'light') === key ? ' active' : ''}`}
                    onClick={() => updateLayout({ basemap: key })}
                    title={label}
                  >
                    <div className="basemap-thumb-swatch" style={{ background: bg }}>
                      <div className="basemap-thumb-water" style={{ background: water }} />
                    </div>
                    <span className="basemap-thumb-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="element-visibility-row">
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showTitle !== false} onChange={(e) => updateLayout({ showTitle: e.target.checked })} /><span>Title</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showNorthArrow !== false} onChange={(e) => updateLayout({ showNorthArrow: e.target.checked })} /><span>North Arrow</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showScaleBar !== false} onChange={(e) => updateLayout({ showScaleBar: e.target.checked })} /><span>Scale Bar</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showLegend !== false} onChange={(e) => updateLayout({ showLegend: e.target.checked })} /><span>Legend</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.footerEnabled !== false} onChange={(e) => updateLayout({ footerEnabled: e.target.checked })} /><span>Footer</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.insetEnabled !== false} onChange={(e) => updateLayout({ insetEnabled: e.target.checked })} /><span>Inset Map</span></label>
            </div>
          </div>
        </section>

        <section className="control-section cs-collapsible" ref={layersSectionRef}>
          <h2>Layers</h2>
          <LayerList layers={project.layers} selectedLayerId={selectedLayerId} onSelect={setSelectedLayerId} onToggleVisible={toggleLayerVisible} onRemove={removeLayer} />
          {selectedLayer ? (
            <div className="control-grid" style={{ marginTop: 10 }}>
              <div className="control-row">
                <label>Display Label</label>
                <input value={selectedLayer.displayName || selectedLayer.legend?.label || ''} onChange={(e) => setDisplayLabel(selectedLayer.id, e.target.value)} />
              </div>
              <div className="control-row">
                <label>Layer Role</label>
                <select value={selectedLayer.role} onChange={(e) => changeLayerRole(selectedLayer.id, e.target.value)}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="button-row three">
                <button className="secondary-btn" type="button" onClick={() => moveLayer(selectedLayer.id, 'down')}>Move Down</button>
                <button className={`secondary-btn ${project.layout.primaryLayerId === selectedLayer.id ? 'active-toggle' : ''}`} type="button" onClick={() => setFramingLayer(selectedLayer.id)}>
                  {project.layout.primaryLayerId === selectedLayer.id ? 'Framing Layer' : 'Use for Framing'}
                </button>
                <button className="secondary-btn" type="button" onClick={() => moveLayer(selectedLayer.id, 'up')}>Move Up</button>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>{isPointStyledLayer(selectedLayer) ? 'Point Border' : 'Outline Color'}</label>
                  <input type="color" value={selectedLayer.style?.stroke || selectedLayer.style?.markerColor || '#2563eb'} onChange={(e) => { const id = selectedLayer.id, val = e.target.value; clearTimeout(layerStyleDebounceRef.current); layerStyleDebounceRef.current = setTimeout(() => updateLayer(id, { style: { stroke: val, markerColor: val } }), 50); }} />
                </div>
                <div>
                  <label>{isPointStyledLayer(selectedLayer) ? 'Point Fill' : 'Fill Color'}</label>
                  <input type="color" value={selectedLayer.style?.fill || selectedLayer.style?.markerFill || '#93c5fd'} onChange={(e) => { const id = selectedLayer.id, val = e.target.value; clearTimeout(layerStyleDebounceRef.current); layerStyleDebounceRef.current = setTimeout(() => updateLayer(id, { style: { fill: val, markerFill: val } }), 50); }} />
                </div>
              </div>
              {isPointStyledLayer(selectedLayer) ? (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Point Size</label>
                      <input type="range" min="6" max="24" step="1" value={selectedLayer.style?.markerSize ?? 12} onChange={(e) => updateLayer(selectedLayer.id, { style: { markerSize: Number(e.target.value) } })} />
                    </div>
                    <div className="range-value">{selectedLayer.style?.markerSize ?? 12}px</div>
                  </div>
                  <div className="control-row">
                    <label>Marker Shape</label>
                    <div className="marker-shape-picker-visual">
                      {[
                        ['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Tri ▲'], ['triangle_down', 'Tri ▼'],
                        ['diamond', 'Diamond'], ['cross', 'Cross'], ['star', 'Star'], ['hexagon', 'Hexagon'],
                        ['pin', 'Pin'], ['drillhole', 'DH Pin'],
                      ].map(([val, label]) => {
                        const color = selectedLayer.style?.markerColor || '#2563eb';
                        const isActive = (selectedLayer.style?.markerShape || 'circle') === val;
                        return (
                          <button key={val} type="button" className={`shape-visual-btn${isActive ? ' active' : ''}`}
                            onClick={() => updateLayer(selectedLayer.id, { style: { markerShape: val } })} title={label}>
                            <img src={markerSvgUrl(val, isActive ? '#ffffff' : color, 18)} alt={label} width="18" height="18" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="control-row">
                    <label>Custom Icon</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {selectedLayer.style?.customMarkerDataUri && (
                        <img src={selectedLayer.style.customMarkerDataUri} alt="custom icon" style={{ width: 24, height: 24, objectFit: 'contain', border: '1px solid #d4deea', borderRadius: 4 }} />
                      )}
                      <button type="button" className="secondary-btn" style={{ flex: 1 }}
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file'; input.accept = 'image/png,image/svg+xml,image/jpeg,image/gif';
                          input.onchange = (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => updateLayer(selectedLayer.id, { style: { customMarkerDataUri: ev.target.result } });
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}>
                        {selectedLayer.style?.customMarkerDataUri ? 'Change Icon' : 'Upload Icon'}
                      </button>
                      {selectedLayer.style?.customMarkerDataUri && (
                        <button type="button" className="secondary-btn" style={{ flexShrink: 0 }}
                          onClick={() => updateLayer(selectedLayer.id, { style: { customMarkerDataUri: null } })}>✕</button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Fill Opacity</label>
                      <input type="range" min="0" max="1" step="0.05" value={selectedLayer.style?.fillOpacity ?? 0.22} onChange={(e) => { const id = selectedLayer.id, val = Number(e.target.value); clearTimeout(layerStyleDebounceRef.current); layerStyleDebounceRef.current = setTimeout(() => updateLayer(id, { style: { fillOpacity: val } }), 50); }} />
                    </div>
                    <div className="range-value">{Math.round((selectedLayer.style?.fillOpacity ?? 0.22) * 100)}%</div>
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Layer Opacity</label>
                      <input type="range" min="0" max="1" step="0.05" value={selectedLayer.style?.layerOpacity ?? 1} onChange={(e) => { const id = selectedLayer.id, val = Number(e.target.value); clearTimeout(layerStyleDebounceRef.current); layerStyleDebounceRef.current = setTimeout(() => updateLayer(id, { style: { layerOpacity: val } }), 50); }} />
                    </div>
                    <div className="range-value">{Math.round((selectedLayer.style?.layerOpacity ?? 1) * 100)}%</div>
                  </div>
                  <div className="control-row">
                    <label>Fill Pattern</label>
                    <div className="fill-pattern-picker">
                      {[['none', 'Solid'], ['hatch', 'Hatch'], ['cross', 'Cross'], ['dots', 'Dots']].map(([val, title]) => (
                        <button
                          key={val}
                          type="button"
                          title={title}
                          className={`pattern-btn${(selectedLayer.style?.fillPattern || 'none') === val ? ' active' : ''}`}
                          onClick={() => updateLayer(selectedLayer.id, { style: { fillPattern: val === 'none' ? undefined : val } })}
                        >
                          {val === 'none' && <svg width="24" height="18"><rect x="1" y="1" width="22" height="16" rx="2" fill="rgba(100,116,139,0.3)" /></svg>}
                          {val === 'hatch' && <svg width="24" height="18"><rect x="1" y="1" width="22" height="16" rx="2" fill="none" stroke="#94a3b8" />{[0,6,12,18,24].map((o) => <line key={o} x1={o} y1={18} x2={o + 18} y2={0} stroke="#64748b" strokeWidth="1.2" />)}</svg>}
                          {val === 'cross' && <svg width="24" height="18"><rect x="1" y="1" width="22" height="16" rx="2" fill="none" stroke="#94a3b8" />{[3,9,15,21].map((x) => <line key={`v${x}`} x1={x} y1={2} x2={x} y2={16} stroke="#64748b" strokeWidth="1.2" />)}{[4,10,16].map((y) => <line key={`h${y}`} x1={2} y1={y} x2={22} y2={y} stroke="#64748b" strokeWidth="1.2" />)}</svg>}
                          {val === 'dots' && <svg width="24" height="18"><rect x="1" y="1" width="22" height="16" rx="2" fill="none" stroke="#94a3b8" />{[5,11,17].map((x) => [4,10,16].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.8" fill="#64748b" />))}</svg>}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : <p className="small-note">Select a layer to edit its display label, role, order, and colors.</p>}
        </section>

        <section className="control-section cs-collapsible" ref={drillholeSectionRef}>
          <h2 className="section-toggle-btn" onClick={() => toggleSection('drillhole')}>Drillhole Labels <span className={`section-chevron${collapsedSections.drillhole ? '' : ' open'}`}>›</span></h2>
          {!collapsedSections.drillhole && selectedFeature ? (
            <div className="control-grid">
              <div className="feature-chip">Selected: {selectedFeature.layerName}</div>
              <div className="small-note">Click a drillhole on the map, then refine the callout here. The selected hole is editable before you add the callout.</div>
              <div className="control-row">
                <label>Title</label>
                <input value={selectedFeature.suggestedLabel} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, suggestedLabel: e.target.value }))} />
              </div>
              <div className="control-row">
                <label>Subtext</label>
                <input value={selectedFeature.suggestedSubtext || ''} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, suggestedSubtext: e.target.value }))} />
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Callout Type</label>
                  <select value={selectedFeature.calloutType || 'leader'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, calloutType: e.target.value }))}>
                    {Object.entries(CALLOUT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
              {selectedFeature.calloutType === 'badge' && (
                <div className="control-row inline-2">
                  <div>
                    <label>Chip Text</label>
                    <input value={selectedFeature.badgeValue || ''} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, badgeValue: e.target.value }))} placeholder=">14 Moz" />
                  </div>
                  <div>
                    <label>Chip Color</label>
                    <input type="color" value={selectedFeature.badgeColor || '#d97706'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, badgeColor: e.target.value }))} />
                  </div>
                </div>
              )}
              <div className="control-row inline-2">
                <div>
                  <label>Background</label>
                  <input type="color" value={selectedFeature.style?.background || '#ffffff'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), background: e.target.value } }))} />
                </div>
                <div>
                  <label>Border</label>
                  <input type="color" value={selectedFeature.style?.border || '#102640'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), border: e.target.value } }))} />
                </div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Text</label>
                  <input type="color" value={selectedFeature.style?.textColor || '#0f172a'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), textColor: e.target.value } }))} />
                </div>
                <div>
                  <label>Subtext</label>
                  <input type="color" value={selectedFeature.style?.subtextColor || '#475569'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), subtextColor: e.target.value } }))} />
                </div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Font Size</label>
                  <input type="range" min="11" max="16" step="1" value={selectedFeature.style?.fontSize || 12} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), fontSize: Number(e.target.value) } }))} />
                </div>
                <div className="range-value">{selectedFeature.style?.fontSize || 12}px</div>
              </div>
              <button className="btn primary" type="button" onClick={addCalloutFromSelectedFeature}>Add / Update Callout</button>
            </div>
          ) : (!collapsedSections.drillhole &&
            <div className="small-note">Click a drillhole point on the map to open its callout editor.</div>
          )}
        </section>

        <section className="control-section cs-collapsible" ref={calloutsSectionRef}>
          <h2>Callouts</h2>
          <div className="button-row" style={{ marginBottom: 10 }}>
            <button className="btn primary" type="button" onClick={addCalloutFromSelectedLayer} disabled={!selectedLayer}>Add From Selected Layer</button>
            <button className="btn" type="button" onClick={autoFrameAll}>Auto Frame All</button>
          </div>
          <div className="callout-list">
            {project.callouts.map((callout, index) => {
              const isOpen = selectedCalloutId === callout.id;
              return (
                <div key={callout.id} className={`callout-card ${isOpen ? 'active' : ''}`}>
                  <div className="callout-card-header" style={{ cursor: 'pointer', marginBottom: isOpen ? 8 : 0 }} onClick={() => setSelectedCalloutId(isOpen ? null : callout.id)}>
                    <span>{callout.text ? callout.text.slice(0, 28) : `Callout ${index + 1}`}</span>
                    <div className="callout-card-actions">
                      <button className="secondary-btn" type="button" onClick={(e) => { e.stopPropagation(); removeCallout(callout.id); }}>Remove</button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="control-grid">
                      <div className="control-row"><label>Text</label><input autoFocus value={callout.text} onChange={(e) => updateCallout(callout.id, { text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedCalloutId(null); }} /></div>
                      <div className="control-row"><label>Subtext</label><input value={callout.subtext || ''} placeholder="Details / result…" onChange={(e) => updateCallout(callout.id, { subtext: e.target.value })} /></div>
                      <div className="control-row inline-2">
                        <div>
                          <label>Type</label>
                          <select value={callout.type} onChange={(e) => updateCallout(callout.id, { type: e.target.value })}>
                            {Object.entries(CALLOUT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label>Priority</label>
                          <select value={callout.priority} onChange={(e) => updateCallout(callout.id, { priority: Number(e.target.value) })}>
                            <option value={1}>High</option>
                            <option value={2}>Medium</option>
                            <option value={3}>Low</option>
                          </select>
                        </div>
                      </div>
                      {callout.type === 'badge' && (
                        <div className="control-row inline-2">
                          <div>
                            <label>Chip Text</label>
                            <input value={callout.badgeValue || ''} onChange={(e) => updateCallout(callout.id, { badgeValue: e.target.value })} placeholder=">14 Moz" />
                          </div>
                          <div>
                            <label>Chip Color</label>
                            <input type="color" value={callout.badgeColor || '#d97706'} onChange={(e) => updateCallout(callout.id, { badgeColor: e.target.value })} />
                          </div>
                        </div>
                      )}
                      {callout.type !== 'plain' && (
                        <>
                          <div className="control-row inline-2">
                            <div>
                              <label>Background</label>
                              <input type="color" value={callout.style?.background || '#ffffff'} onChange={(e) => updateCallout(callout.id, { style: { ...(callout.style || {}), background: e.target.value } })} />
                            </div>
                            <div>
                              <label>Border / Line</label>
                              <input type="color" value={callout.style?.border || '#102640'} onChange={(e) => updateCallout(callout.id, { style: { ...(callout.style || {}), border: e.target.value } })} />
                            </div>
                          </div>
                          <div className="control-row inline-2">
                            <div>
                              <label>Text Color</label>
                              <input type="color" value={callout.style?.textColor || '#0f172a'} onChange={(e) => updateCallout(callout.id, { style: { ...(callout.style || {}), textColor: e.target.value } })} />
                            </div>
                            <div>
                              <label>Subtext Color</label>
                              <input type="color" value={callout.style?.subtextColor || '#475569'} onChange={(e) => updateCallout(callout.id, { style: { ...(callout.style || {}), subtextColor: e.target.value } })} />
                            </div>
                          </div>
                          <div className="control-row inline-2">
                            <div>
                              <label>Font Size</label>
                              <input type="range" min="9" max="18" step="1" value={callout.style?.fontSize || 12} onChange={(e) => updateCallout(callout.id, { style: { ...(callout.style || {}), fontSize: Number(e.target.value) } })} />
                            </div>
                            <div className="range-value">{callout.style?.fontSize || 12}px</div>
                          </div>
                        </>
                      )}
                      <div className="control-label">Nudge</div>
                      <div className="nudge-grid">
                        <span />
                        <button className="secondary-btn" type="button" onClick={() => nudgeCallout(callout.id, 0, -8)}>↑</button>
                        <span />
                        <button className="secondary-btn" type="button" onClick={() => nudgeCallout(callout.id, -8, 0)}>←</button>
                        <button className="secondary-btn" type="button" onClick={() => nudgeCallout(callout.id, 0, 8)}>↓</button>
                        <button className="secondary-btn" type="button" onClick={() => nudgeCallout(callout.id, 8, 0)}>→</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="control-section cs-collapsible" ref={markersSectionRef}>
          <h2>Annotations</h2>
          <div className="button-row">
            <button className={`secondary-btn ${annotationTool === 'marker' ? 'active-toggle' : ''}`} type="button" onClick={() => { const next = annotationTool === 'marker' ? null : 'marker'; setAnnotationTool(next); annotationToolRef.current = next; setSelectedFeature(null); }}>Place Marker</button>
            <button className={`secondary-btn ${annotationTool === 'ellipse' ? 'active-toggle' : ''}`} type="button" onClick={() => { const next = annotationTool === 'ellipse' ? null : 'ellipse'; setAnnotationTool(next); annotationToolRef.current = next; setSelectedFeature(null); }}>Draw Dashed Area</button>
            <button className={`secondary-btn ${annotationTool === 'ring' ? 'active-toggle' : ''}`} type="button" onClick={() => { const next = annotationTool === 'ring' ? null : 'ring'; setAnnotationTool(next); annotationToolRef.current = next; setSelectedFeature(null); }}>Draw Distance Ring</button>
            <button className={`secondary-btn ${annotationTool === 'maplabel' ? 'active-toggle' : ''}`} type="button" onClick={() => { const next = annotationTool === 'maplabel' ? null : 'maplabel'; setAnnotationTool(next); annotationToolRef.current = next; setSelectedFeature(null); }}>Place Map Label</button>
            <button className={`secondary-btn ${annotationTool === 'polygon' ? 'active-toggle' : ''}`} type="button" onClick={() => { const next = annotationTool === 'polygon' ? null : 'polygon'; setAnnotationTool(next); annotationToolRef.current = next; setPendingPolygonPoints([]); setSelectedFeature(null); }}>Draw Boundary</button>
            <button className={`secondary-btn ${annotationTool === 'distanceLine' ? 'active-toggle' : ''}`} type="button"
              onClick={() => { const next = annotationTool === 'distanceLine' ? null : 'distanceLine'; setAnnotationTool(next); annotationToolRef.current = next; setPendingDistanceP1(null); setSelectedFeature(null); }}>
              Measure Distance
            </button>
          </div>
          {annotationTool === 'polygon' && (
            <div className="polygon-drawing-status">
              <span>{pendingPolygonPoints.length < 3 ? `Click map to add points (${pendingPolygonPoints.length} so far, need 3+)` : `${pendingPolygonPoints.length} points — click first point or Close to finish`}</span>
              <div className="button-row" style={{ marginTop: 6 }}>
                <button className="btn primary" type="button" disabled={pendingPolygonPoints.length < 3} onClick={finishPolygon}>Close & Save</button>
                <button className="btn" type="button" onClick={() => { setPendingPolygonPoints([]); setAnnotationTool(null); annotationToolRef.current = null; }}>Cancel</button>
              </div>
            </div>
          )}
          <div className="small-note" style={{ marginTop: 8 }}>{annotationTool === 'polygon' ? '' : annotationTool ? 'Click anywhere on the map to place the selected annotation.' : 'Add highlight markers or dashed ellipses anywhere on the map.'}</div>

          {selectedMarker?.type === 'maplabel' ? (
            <div className="control-grid" style={{ marginTop: 10 }}>
              <div className="selected-note">Map Label</div>
              <div className="control-row"><label>Text</label><input value={selectedMarker.label || ''} onChange={(e) => updateMarker(selectedMarker.id, { label: e.target.value })} placeholder="BRITISH COLUMBIA" /></div>
              <div className="control-row inline-2">
                <div>
                  <label>Size</label>
                  <input type="range" min="14" max="72" step="1" value={selectedMarker.size || 28} onChange={(e) => updateMarker(selectedMarker.id, { size: Number(e.target.value) })} />
                </div>
                <div className="range-value">{selectedMarker.size || 28}pt</div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Opacity</label>
                  <input type="range" min="0.05" max="1" step="0.05" value={selectedMarker.opacity ?? 0.35} onChange={(e) => updateMarker(selectedMarker.id, { opacity: Number(e.target.value) })} />
                </div>
                <div className="range-value">{Math.round((selectedMarker.opacity ?? 0.35) * 100)}%</div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Rotation</label>
                  <input type="number" min="-180" max="180" step="1" value={selectedMarker.rotation || 0} onChange={(e) => updateMarker(selectedMarker.id, { rotation: Number(e.target.value) })} />
                </div>
                <div>
                  <label>Color</label>
                  <input type="color" value={selectedMarker.color || '#1e293b'} onChange={(e) => updateMarker(selectedMarker.id, { color: e.target.value })} />
                </div>
              </div>
              <button className="secondary-btn" type="button" onClick={() => { setProject((prev) => ({ ...prev, markers: prev.markers.filter((m) => m.id !== selectedMarker.id) })); setSelectedFeature(null); }}>Remove Label</button>
            </div>
          ) : selectedMarker ? (
            <div className="control-grid" style={{ marginTop: 10 }}>
              <div className="selected-note">Selected marker</div>
              <div className="control-row"><label>Label</label><input value={selectedMarker.label || ''} onChange={(e) => updateMarker(selectedMarker.id, { label: e.target.value })} /></div>
              <div className="control-row inline-2">
                <div>
                  <label>Marker Type</label>
                  <select value={selectedMarker.type} onChange={(e) => updateMarker(selectedMarker.id, { type: e.target.value })}>
                    {Object.entries(MARKER_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label>Color</label>
                  <input type="color" value={selectedMarker.color} onChange={(e) => updateMarker(selectedMarker.id, { color: e.target.value })} />
                </div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Size</label>
                  <input type="range" min="12" max="36" step="1" value={selectedMarker.size} onChange={(e) => updateMarker(selectedMarker.id, { size: Number(e.target.value) })} />
                </div>
                <div className="range-value">{selectedMarker.size}px</div>
              </div>
              <button className="secondary-btn" type="button" onClick={() => removeMarker(selectedMarker.id)}>Remove Marker</button>
            </div>
          ) : null}

          {selectedEllipse ? (
            <div className="control-grid" style={{ marginTop: 10 }}>
              <div className="selected-note">{selectedEllipse.isRing ? 'Selected distance ring' : 'Selected highlight area'}</div>
              <div className="control-row"><label>Label</label><input value={selectedEllipse.label || ''} onChange={(e) => updateEllipse(selectedEllipse.id, { label: e.target.value })} placeholder={selectedEllipse.isRing ? (selectedEllipse.units === 'mi' ? `${(selectedEllipse.radiusKm * 0.621371).toFixed(1)} mi` : `${selectedEllipse.radiusKm} km`) : ''} /></div>
              {selectedEllipse.isRing ? (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Radius ({selectedEllipse.units === 'mi' ? 'mi' : 'km'})</label>
                      <input type="number" min="0.1" max="5000" step={selectedEllipse.units === 'mi' ? '0.1' : '1'}
                        value={selectedEllipse.units === 'mi' ? Math.round((selectedEllipse.radiusKm ?? 50) * 0.621371 * 10) / 10 : (selectedEllipse.radiusKm ?? 50)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          updateEllipse(selectedEllipse.id, { radiusKm: selectedEllipse.units === 'mi' ? v / 0.621371 : v });
                        }} />
                    </div>
                    <div>
                      <label>Ring Color</label>
                      <input type="color" value={selectedEllipse.color || '#dc2626'} onChange={(e) => updateEllipse(selectedEllipse.id, { color: e.target.value })} />
                    </div>
                  </div>
                  <div className="control-row">
                    <label>Units</label>
                    <div className="unit-toggle-row">
                      <button type="button" className={`unit-toggle-btn${!selectedEllipse.units || selectedEllipse.units === 'km' ? ' active' : ''}`} onClick={() => updateEllipse(selectedEllipse.id, { units: 'km' })}>km</button>
                      <button type="button" className={`unit-toggle-btn${selectedEllipse.units === 'mi' ? ' active' : ''}`} onClick={() => updateEllipse(selectedEllipse.id, { units: 'mi' })}>mi</button>
                    </div>
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Label Size</label>
                      <input type="range" min="9" max="22" step="1" value={selectedEllipse.labelFontSize || 11} onChange={(e) => updateEllipse(selectedEllipse.id, { labelFontSize: Number(e.target.value) })} />
                    </div>
                    <div className="range-value">{selectedEllipse.labelFontSize || 11}px</div>
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Label Color</label>
                      <input type="color" value={selectedEllipse.labelColor || selectedEllipse.color || '#dc2626'} onChange={(e) => updateEllipse(selectedEllipse.id, { labelColor: e.target.value })} />
                    </div>
                    <label className="toggle-row" style={{ marginTop: 0 }}>
                      <input type="checkbox" checked={selectedEllipse.labelBold !== false} onChange={(e) => updateEllipse(selectedEllipse.id, { labelBold: e.target.checked })} />
                      <span>Bold</span>
                    </label>
                  </div>
                  <label className="toggle-row">
                    <input type="checkbox" checked={!!selectedEllipse.labelArc} onChange={(e) => updateEllipse(selectedEllipse.id, { labelArc: e.target.checked })} />
                    <span>Curved arc label</span>
                  </label>
                  {selectedEllipse.labelArc && (
                    <div className="control-row inline-2">
                      <div>
                        <label>Angle (0° = top)</label>
                        <input type="range" min="0" max="359" step="1" value={selectedEllipse.labelAngle ?? 0} onChange={(e) => updateEllipse(selectedEllipse.id, { labelAngle: Number(e.target.value) })} />
                      </div>
                      <div className="range-value">{selectedEllipse.labelAngle ?? 0}°</div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Width</label>
                      <input type="number" min="24" max="320" step="1" value={selectedEllipse.width} onChange={(e) => updateEllipse(selectedEllipse.id, { width: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label>Height</label>
                      <input type="number" min="24" max="320" step="1" value={selectedEllipse.height} onChange={(e) => updateEllipse(selectedEllipse.id, { height: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Rotation</label>
                      <input type="number" min="-180" max="180" step="1" value={selectedEllipse.rotation} onChange={(e) => updateEllipse(selectedEllipse.id, { rotation: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label>Color</label>
                      <input type="color" value={selectedEllipse.color} onChange={(e) => updateEllipse(selectedEllipse.id, { color: e.target.value })} />
                    </div>
                  </div>
                </>
              )}
              <label className="toggle-row"><input type="checkbox" checked={selectedEllipse.dashed !== false} onChange={(e) => updateEllipse(selectedEllipse.id, { dashed: e.target.checked })} /> <span>Dashed outline</span></label>
              <label className="toggle-row">
                <input type="checkbox" checked={!!selectedEllipse.outsideShade} onChange={(e) => updateEllipse(selectedEllipse.id, { outsideShade: e.target.checked })} />
                <span>Outside shade</span>
              </label>
              {selectedEllipse.outsideShade && (
                <>
                  <div className="shade-presets">
                    {[{ label: 'Dark', c: '#000000', o: 0.35 }, { label: 'Light', c: '#ffffff', o: 0.30 }, { label: 'Warm', c: '#7c3b1a', o: 0.25 }].map(({ label, c, o }) => (
                      <button key={label} className="shade-preset-btn" type="button" onClick={() => updateEllipse(selectedEllipse.id, { outsideShadeColor: c, outsideShadeOpacity: o })}>{label}</button>
                    ))}
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Shade Color</label>
                      <input type="color" value={selectedEllipse.outsideShadeColor || '#000000'} onChange={(e) => updateEllipse(selectedEllipse.id, { outsideShadeColor: e.target.value })} />
                    </div>
                    <div>
                      <label>Opacity</label>
                      <input type="range" min="0.05" max="0.75" step="0.05" value={selectedEllipse.outsideShadeOpacity ?? 0.35} onChange={(e) => updateEllipse(selectedEllipse.id, { outsideShadeOpacity: Number(e.target.value) })} />
                    </div>
                  </div>
                </>
              )}
              <button className="secondary-btn" type="button" onClick={() => removeEllipse(selectedEllipse.id)}>{selectedEllipse.isRing ? 'Remove Ring' : 'Remove Highlight Area'}</button>
            </div>
          ) : null}

          {selectedPolygon ? (
            <div className="control-grid" style={{ marginTop: 10 }}>
              <div className="selected-note">Selected boundary</div>
              <div className="control-row"><label>Label</label><input value={selectedPolygon.label || ''} onChange={(e) => updatePolygon(selectedPolygon.id, { label: e.target.value })} placeholder="e.g. Target Zone" /></div>
              <label className="toggle-row">
                <input type="checkbox" checked={!!selectedPolygon.arcLabel} onChange={(e) => updatePolygon(selectedPolygon.id, { arcLabel: e.target.checked })} />
                <span>Arc label along boundary</span>
              </label>
              {selectedPolygon.arcLabel && (
                <div className="control-row inline-2">
                  <div>
                    <label>Position (0° = start)</label>
                    <input type="range" min="0" max="359" step="1" value={selectedPolygon.labelAngle ?? 0} onChange={(e) => updatePolygon(selectedPolygon.id, { labelAngle: Number(e.target.value) })} />
                  </div>
                  <div className="range-value">{selectedPolygon.labelAngle ?? 0}°</div>
                </div>
              )}
              <div className="control-row inline-2">
                <div>
                  <label>Color</label>
                  <input type="color" value={selectedPolygon.color || '#000000'} onChange={(e) => updatePolygon(selectedPolygon.id, { color: e.target.value })} />
                </div>
                <div>
                  <label>Stroke Width</label>
                  <input type="range" min="1" max="8" step="0.5" value={selectedPolygon.strokeWidth ?? 2} onChange={(e) => updatePolygon(selectedPolygon.id, { strokeWidth: Number(e.target.value) })} />
                </div>
              </div>
              <div className="control-row inline-2">
                <div>
                  <label>Label Size</label>
                  <input type="range" min="9" max="28" step="1" value={selectedPolygon.labelFontSize || 12} onChange={(e) => updatePolygon(selectedPolygon.id, { labelFontSize: Number(e.target.value) })} />
                </div>
                <div className="range-value">{selectedPolygon.labelFontSize || 12}px</div>
              </div>
              <label className="toggle-row">
                <input type="checkbox" checked={selectedPolygon.dashed !== false} onChange={(e) => updatePolygon(selectedPolygon.id, { dashed: e.target.checked })} />
                <span>Dashed outline</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={!!selectedPolygon.smoothed} onChange={(e) => updatePolygon(selectedPolygon.id, { smoothed: e.target.checked })} />
                <span>Smooth boundary</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={!!selectedPolygon.outsideShade} onChange={(e) => updatePolygon(selectedPolygon.id, { outsideShade: e.target.checked })} />
                <span>Outside shade</span>
              </label>
              {selectedPolygon.outsideShade && (
                <>
                  <div className="shade-presets">
                    {[{ label: 'Dark', c: '#000000', o: 0.35 }, { label: 'Light', c: '#ffffff', o: 0.30 }, { label: 'Warm', c: '#7c3b1a', o: 0.25 }].map(({ label, c, o }) => (
                      <button key={label} className="shade-preset-btn" type="button" onClick={() => updatePolygon(selectedPolygon.id, { outsideShadeColor: c, outsideShadeOpacity: o })}>{label}</button>
                    ))}
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Shade Color</label>
                      <input type="color" value={selectedPolygon.outsideShadeColor || '#000000'} onChange={(e) => updatePolygon(selectedPolygon.id, { outsideShadeColor: e.target.value })} />
                    </div>
                    <div>
                      <label>Opacity</label>
                      <input type="range" min="0.05" max="0.75" step="0.05" value={selectedPolygon.outsideShadeOpacity ?? 0.35} onChange={(e) => updatePolygon(selectedPolygon.id, { outsideShadeOpacity: Number(e.target.value) })} />
                    </div>
                  </div>
                </>
              )}
              <button className="secondary-btn" type="button" onClick={() => removePolygon(selectedPolygon.id)}>Remove Boundary</button>
            </div>
          ) : null}

          {selectedDistanceLineId && (() => {
            const dl = (project.distanceLines || []).find(d => d.id === selectedDistanceLineId);
            if (!dl) return null;
            return (
              <div className="control-section">
                <div className="control-section-title">Distance Line</div>
                <div className="control-row">
                  <label>Color</label>
                  <input type="color" value={dl.color || '#e11d48'}
                    onChange={(e) => updateDistanceLine(dl.id, { color: e.target.value })} />
                </div>
                <div className="control-row">
                  <label>Units</label>
                  <div className="unit-toggle-row">
                    {['km', 'mi'].map(u => (
                      <button key={u} className={`unit-toggle-btn${(dl.units || 'km') === u ? ' active' : ''}`}
                        onClick={() => updateDistanceLine(dl.id, { units: u })}>{u}</button>
                    ))}
                  </div>
                </div>
                <div className="control-row">
                  <button className="secondary-btn" style={{ color: '#ef4444' }}
                    onClick={() => removeDistanceLine(dl.id)}>Delete Distance Line</button>
                </div>
              </div>
            );
          })()}
        </section>

        <section className="control-section cs-collapsible">
          <h2>Design</h2>
          <div className="control-grid">
            <div className="control-row">
              <label>Mode</label>
              <select value={project.layout.mode} onChange={(e) => applyMode(e.target.value)}>
                {Object.entries(TEMPLATE_MODES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="control-row">
              <label>Design Theme</label>
              <select value={project.layout.themeId || 'investor_clean'} onChange={(e) => updateLayout({ themeId: e.target.value })}>
                {Object.entries(TEMPLATE_THEMES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="color-overrides-grid">
              <div className="color-override-cell">
                <label>Title bg</label>
                <div className="color-swatch-wrap">
                  <input type="color" className="swatch-input" value={project.layout.titleBgColor || themeTokens.titleFill?.replace(/rgba?\([^)]+\)/i, '') || '#0c1a35'} onChange={(e) => updateLayout({ titleBgColor: e.target.value })} title="Title block background" />
                  {project.layout.titleBgColor && <button className="swatch-reset" type="button" onClick={() => updateLayout({ titleBgColor: null })} title="Reset">✕</button>}
                </div>
              </div>
              <div className="color-override-cell">
                <label>Title text</label>
                <div className="color-swatch-wrap">
                  <input type="color" className="swatch-input" value={project.layout.titleFgColor || themeTokens.titleText || '#ffffff'} onChange={(e) => updateLayout({ titleFgColor: e.target.value })} title="Title text color" />
                  {project.layout.titleFgColor && <button className="swatch-reset" type="button" onClick={() => updateLayout({ titleFgColor: null })} title="Reset">✕</button>}
                </div>
              </div>
              <div className="color-override-cell">
                <label>Panel bg</label>
                <div className="color-swatch-wrap">
                  <input type="color" className="swatch-input" value={project.layout.panelBgColor || '#ffffff'} onChange={(e) => updateLayout({ panelBgColor: e.target.value })} title="Overlay panel background" />
                  {project.layout.panelBgColor && <button className="swatch-reset" type="button" onClick={() => updateLayout({ panelBgColor: null })} title="Reset">✕</button>}
                </div>
              </div>
              <div className="color-override-cell">
                <label>Panel text</label>
                <div className="color-swatch-wrap">
                  <input type="color" className="swatch-input" value={project.layout.panelFgColor || themeTokens.bodyText || '#1e293b'} onChange={(e) => updateLayout({ panelFgColor: e.target.value })} title="Panel text color" />
                  {project.layout.panelFgColor && <button className="swatch-reset" type="button" onClick={() => updateLayout({ panelFgColor: null })} title="Reset">✕</button>}
                </div>
              </div>
              <div className="color-override-cell">
                <label>Accent</label>
                <div className="color-swatch-wrap">
                  <input type="color" className="swatch-input" value={project.layout.accentColor || themeTokens.titleAccent || '#2563eb'} onChange={(e) => updateLayout({ accentColor: e.target.value })} title="Accent color (stripe, callout borders)" />
                  {project.layout.accentColor && <button className="swatch-reset" type="button" onClick={() => updateLayout({ accentColor: null })} title="Reset">✕</button>}
                </div>
              </div>
              {(project.layout.titleBgColor || project.layout.titleFgColor || project.layout.panelBgColor || project.layout.panelFgColor || project.layout.accentColor) && (
                <div className="color-override-cell">
                  <label>&nbsp;</label>
                  <button className="swatch-reset-all" type="button" onClick={() => updateLayout({ titleBgColor: null, titleFgColor: null, panelBgColor: null, panelFgColor: null, accentColor: null })}>Reset all</button>
                </div>
              )}
            </div>
            <div className="button-row">
              <button className="btn" type="button" onClick={autoFrameAll}>Refit Map</button>
              <button className="btn primary" type="button" onClick={improveMap}>Improve Map</button>
            </div>

            {/* Fonts */}
            <details className="sub-details">
              <summary>Fonts</summary>
              <div className="sub-details-body">
                <div className="control-row inline-2">
                  <div><label>Title</label><select value={selectValue(FONT_OPTIONS, project.layout.fonts?.title)} onChange={(e) => updateLayout({ fonts: { title: e.target.value } })}>{Object.entries(FONT_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                  <div><label>Legend</label><select value={selectValue(FONT_OPTIONS, project.layout.fonts?.legend)} onChange={(e) => updateLayout({ fonts: { legend: e.target.value } })}>{Object.entries(FONT_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                </div>
                <div className="control-row inline-2">
                  <div><label>Labels</label><select value={selectValue(FONT_OPTIONS, project.layout.fonts?.label)} onChange={(e) => updateLayout({ fonts: { label: e.target.value } })}>{Object.entries(FONT_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                  <div><label>Callouts</label><select value={selectValue(FONT_OPTIONS, project.layout.fonts?.callout)} onChange={(e) => updateLayout({ fonts: { callout: e.target.value } })}>{Object.entries(FONT_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                </div>
              </div>
            </details>

            {/* NI 43-101 Title Strip fields */}
            {project.layout.templateId === 'ni_43101_technical' && (
              <details className="sub-details" open>
                <summary>NI 43-101 Title Strip</summary>
                <div className="sub-details-body">
                  <div className="control-row">
                    <label>Figure Title</label>
                    <input type="text" value={project.layout.stripTitle || ''} placeholder="(leave blank to hide)" onChange={(e) => updateLayout({ stripTitle: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Subtitle / Property</label>
                    <input type="text" value={project.layout.stripSubtitle || ''} placeholder="(optional)" onChange={(e) => updateLayout({ stripSubtitle: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Strip Position</label>
                    <select value={project.layout.titleStripPosition || 'bottom'} onChange={(e) => updateLayout({ titleStripPosition: e.target.value })}>
                      <option value="bottom">Bottom</option>
                      <option value="top">Top</option>
                    </select>
                  </div>
                  <div className="control-row">
                    <label>Scale Override</label>
                    <input type="text" value={project.layout.manualScaleDenom || ''} placeholder="e.g. 25000 (auto if blank)" onChange={(e) => updateLayout({ manualScaleDenom: e.target.value })} />
                  </div>
                  <div className="control-row" style={{ alignItems: 'center' }}>
                    <label>Text Size</label>
                    <input type="range" min="0.7" max="1.4" step="0.05" value={project.layout.stripFontScale || 1} onChange={(e) => updateLayout({ stripFontScale: parseFloat(e.target.value) })} style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, marginLeft: 6, minWidth: 32 }}>{Math.round((project.layout.stripFontScale || 1) * 100)}%</span>
                  </div>
                  <div className="control-row">
                    <label>Qualified Person</label>
                    <input type="text" value={project.layout.qpName || ''} placeholder="Name, P.Geo." onChange={(e) => updateLayout({ qpName: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>QP Credentials</label>
                    <input type="text" value={project.layout.qpCredentials || ''} placeholder="P.Geo., M.Sc." onChange={(e) => updateLayout({ qpCredentials: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Company</label>
                    <input type="text" value={project.layout.companyName || ''} placeholder="Company Name" onChange={(e) => updateLayout({ companyName: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Figure No.</label>
                    <input type="text" value={project.layout.figureNumber || ''} placeholder="Fig. 3-2" onChange={(e) => updateLayout({ figureNumber: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Revision</label>
                    <input type="text" value={project.layout.figureRevision || ''} placeholder="Rev. A" onChange={(e) => updateLayout({ figureRevision: e.target.value })} />
                  </div>
                  <div className="control-row">
                    <label>Projection</label>
                    <input
                      type="text"
                      value={project.layout.projectionName || ''}
                      placeholder="e.g. NAD83 / UTM Zone 10N"
                      onChange={(e) => updateLayout({ projectionName: e.target.value })}
                    />
                  </div>
                </div>
              </details>
            )}

            {/* Panel box visibility */}
            <details className="sub-details">
              <summary>Panel Boxes</summary>
              <div className="sub-details-body">
                <div className="small-note" style={{ marginBottom: 8 }}>Hide the background box from any panel — text stays visible.</div>
                <label className="toggle-row"><input type="checkbox" checked={!project.layout.titleTransparent} onChange={(e) => updateLayout({ titleTransparent: !e.target.checked })} /><span>Title box</span></label>
                <label className="toggle-row"><input type="checkbox" checked={!project.layout.legendTransparent} onChange={(e) => updateLayout({ legendTransparent: !e.target.checked })} /><span>Legend box</span></label>
                <label className="toggle-row"><input type="checkbox" checked={!project.layout.logoTransparent} onChange={(e) => updateLayout({ logoTransparent: !e.target.checked })} /><span>Logo box</span></label>
              </div>
            </details>

            {/* Text & Metadata */}
            <details className="sub-details">
              <summary>Text & Metadata</summary>
              <div className="sub-details-body">
                <div className="control-row"><label>Legend Title</label><input value={localLegendTitle} onChange={(e) => { const val = e.target.value; setLocalLegendTitle(val); metaDirtyRef.current.legendTitle = true; clearTimeout(legendTitleDebounceRef.current); legendTitleDebounceRef.current = setTimeout(() => { updateLayout({ legendTitle: val }); metaDirtyRef.current.legendTitle = false; }, 300); }} placeholder="Legend" /></div>
                <div className="control-row" style={{ alignItems: 'center' }}>
                  <label>Text Size</label>
                  <input type="range" min="0.6" max="1.5" step="0.05" value={project.layout.legendFontScale ?? 1} onChange={(e) => updateLayout({ legendFontScale: parseFloat(e.target.value) })} style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, marginLeft: 6, minWidth: 32 }}>{Math.round((project.layout.legendFontScale ?? 1) * 100)}%</span>
                </div>
                <div className="control-row"><label>Footer / Disclaimer</label><input value={localFooterText} onChange={(e) => { const val = e.target.value; setLocalFooterText(val); metaDirtyRef.current.footerText = true; clearTimeout(footerTextDebounceRef.current); footerTextDebounceRef.current = setTimeout(() => { updateLayout({ footerText: val }); metaDirtyRef.current.footerText = false; }, 300); }} placeholder="e.g. For internal use only" /></div>
                <div className="control-row inline-2">
                  <div><label>Map Date</label><input value={localMapDate} onChange={(e) => { const val = e.target.value; setLocalMapDate(val); metaDirtyRef.current.mapDate = true; clearTimeout(mapDateDebounceRef.current); mapDateDebounceRef.current = setTimeout(() => { updateLayout({ mapDate: val }); metaDirtyRef.current.mapDate = false; }, 300); }} placeholder="e.g. April 2025" /></div>
                  <div><label>Project #</label><input value={localProjectNumber} onChange={(e) => { const val = e.target.value; setLocalProjectNumber(val); metaDirtyRef.current.projectNumber = true; clearTimeout(projectNumberDebounceRef.current); projectNumberDebounceRef.current = setTimeout(() => { updateLayout({ projectNumber: val }); metaDirtyRef.current.projectNumber = false; }, 300); }} placeholder="e.g. P-2024-01" /></div>
                </div>
                <div className="control-row"><label>Scale Note</label><input value={localMapScaleNote} onChange={(e) => { const val = e.target.value; setLocalMapScaleNote(val); metaDirtyRef.current.mapScaleNote = true; clearTimeout(mapScaleNoteDebounceRef.current); mapScaleNoteDebounceRef.current = setTimeout(() => { updateLayout({ mapScaleNote: val }); metaDirtyRef.current.mapScaleNote = false; }, 300); }} placeholder="e.g. 1:50,000" /></div>
              </div>
            </details>

            {/* Region Highlights */}
            <details className="sub-details">
              <summary>Region Highlights {(project.layout.regionHighlights || []).length > 0 && <span className="sub-badge">{project.layout.regionHighlights.length}</span>}</summary>
              <div className="sub-details-body">
                {(project.layout.regionHighlights || []).map((h, i) => {
                  const regionName = regionsNA.find((r) => r.id === h.regionId)?.name || h.regionId;
                  return (
                    <div key={h.regionId} className="region-highlight-row">
                      <span className="region-highlight-name">{regionName}</span>
                      <input type="color" value={h.color || '#ef4444'} title="Color" onChange={(e) => updateLayout({ regionHighlights: project.layout.regionHighlights.map((x, j) => j === i ? { ...x, color: e.target.value } : x) })} />
                      <input type="range" min="0.1" max="1" step="0.05" value={h.opacity ?? 0.45} title="Opacity" onChange={(e) => updateLayout({ regionHighlights: project.layout.regionHighlights.map((x, j) => j === i ? { ...x, opacity: Number(e.target.value) } : x) })} />
                      <span className="range-label">{Math.round((h.opacity ?? 0.45) * 100)}%</span>
                      <button className="icon-btn remove-btn" type="button" title="Remove" onClick={() => updateLayout({ regionHighlights: project.layout.regionHighlights.filter((_, j) => j !== i) })}>×</button>
                    </div>
                  );
                })}
                <div className="region-highlight-add-row">
                  <select value="" onChange={(e) => { const id = e.target.value; if (!id || (project.layout.regionHighlights || []).some((h) => h.regionId === id)) return; updateLayout({ regionHighlights: [...(project.layout.regionHighlights || []), { regionId: id, color: '#ef4444', opacity: 0.45 }] }); }}>
                    <option value="">+ Add Region…</option>
                    {regionsNA.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.abbrev})</option>)}
                  </select>
                </div>
              </div>
            </details>

            {/* Saved Templates */}
            <div className="template-manager-block">
              <div className="template-manager-header">
                <span className="template-manager-label">Saved Templates</span>
                {user && (
                  <button className="btn compact" type="button" onClick={() => setShowTemplateManager(true)}>
                    {cloudTemplates.length > 0 ? `Manage (${cloudTemplates.length})` : '+ Save Template'}
                  </button>
                )}
              </div>
              {!user ? (
                <p className="template-manager-hint">Sign in to save and apply company templates.</p>
              ) : cloudTemplates.length === 0 ? (
                <p className="template-manager-hint">No templates yet — save your brand look to reuse across projects.</p>
              ) : (
                <ul className="template-manager-list">
                  {cloudTemplates.map((tmpl) => (
                    <li key={tmpl.id} className="template-manager-row">
                      {tmpl.is_default && <span className="template-default-star active" title="Default">★</span>}
                      <span className="template-name">{tmpl.name}</span>
                      <button
                        className="btn compact"
                        type="button"
                        onClick={() => {
                          const newLayout = applyTemplateConfig(tmpl.config || {}, project.layout);
                          updateLayout(Object.fromEntries(Object.entries(newLayout).filter(([k]) => newLayout[k] !== project.layout[k])));
                          setUploadStatus({ type: 'success', message: `"${tmpl.name}" applied — upload your layers to get started.` });
                        }}
                      >Apply</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="control-section cs-collapsible">
          <h2 className="section-toggle-btn" onClick={() => toggleSection('elements')}>Inset <span className={`section-chevron${collapsedSections.elements ? '' : ' open'}`}>›</span></h2>
          {!collapsedSections.elements && <div className="control-grid">
            <div className="button-row three">
              <button className="btn" type="button" onClick={() => insetInputRef.current?.click()}>Upload Inset</button>
            </div>
            {project.layout.insetImage ? (
              <div className="inset-status-card">
                <div className="inset-preview"><img src={project.layout.insetImage} alt="Inset preview" /></div>
                <button className="secondary-btn" type="button" onClick={() => updateLayout({ insetImage: null, insetEnabled: true })}>Remove Inset Image</button>
              </div>
            ) : null}
            {project.layout.autoInsetRegion && !project.layout.insetImage && project.layout.insetEnabled !== false && (
              <div className="inset-detected-badge">Detected: {project.layout.autoInsetRegion.name}</div>
            )}
            <div className="control-row inline-2">
              <div><label>Inset Title</label><input value={project.layout.insetTitle ?? 'Project Locator'} onChange={(e) => updateLayout({ insetTitle: e.target.value })} placeholder="Project Locator" /></div>
              <div><label>Inset Label</label><input value={project.layout.insetLabel ?? ''} onChange={(e) => updateLayout({ insetLabel: e.target.value })} placeholder={project.layout.autoInsetRegion?.name || 'Province / State'} /></div>
            </div>
            {project.layout.autoInsetRegion && !project.layout.insetImage && (
              <div className="control-row inline-2" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ marginBottom: 0 }}>Region</label>
                  <input type="color" value={project.layout.insetRegionFill || '#dce8f5'} onChange={(e) => updateLayout({ insetRegionFill: e.target.value })} title="Region fill" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ marginBottom: 0 }}>Background</label>
                  <input type="color" value={project.layout.insetBgFill || '#f0f4f8'} onChange={(e) => updateLayout({ insetBgFill: e.target.value })} title="Background" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ marginBottom: 0 }}>Marker</label>
                  <input type="color" value={project.layout.insetMarkerColor || '#2563eb'} onChange={(e) => updateLayout({ insetMarkerColor: e.target.value })} title="Marker color" />
                </div>
              </div>
            )}
            <input ref={insetInputRef} type="file" accept="image/*" onChange={handleInsetImageChange} hidden />
          </div>}
        </section>

        <section className="control-section cs-collapsible">
          <h2 className="section-toggle-btn" onClick={() => toggleSection('refoverlays')}>Reference Overlays <span className={`section-chevron${collapsedSections.refoverlays ? '' : ' open'}`}>›</span></h2>
          {!collapsedSections.refoverlays && <div className="toggle-grid">
            <div className="control-row inline-2">
              <div>
                <label>Overlay Opacity</label>
                <input type="range" min="0.2" max="1" step="0.05" value={project.layout.referenceOpacity ?? 0.65} onChange={(e) => updateLayout({ referenceOpacity: Number(e.target.value) })} />
              </div>
              <div className="range-value">{Math.round((project.layout.referenceOpacity ?? 0.65) * 100)}%</div>
            </div>
            <label className="toggle-row"><input type="checkbox" checked={!!referenceOverlays.context} onChange={(e) => updateLayout({ referenceOverlays: { context: e.target.checked } })} /> <span>Roads + Settlements</span></label>
            <label className="toggle-row"><input type="checkbox" checked={!!referenceOverlays.labels} onChange={(e) => updateLayout({ referenceOverlays: { labels: e.target.checked } })} /> <span>Reference Labels</span></label>
            <label className="toggle-row"><input type="checkbox" checked={!!referenceOverlays.rail} onChange={(e) => updateLayout({ referenceOverlays: { rail: e.target.checked } })} /> <span>Railways</span></label>
          </div>}
        </section>

        <section className="control-section cs-collapsible">
          <h2 className="section-toggle-btn" onClick={() => toggleSection('export')}>Export <span className={`section-chevron${collapsedSections.export ? '' : ' open'}`}>›</span></h2>
          {!collapsedSections.export && <div className="control-grid">
            <RatioSwitcher activeRatio={activeRatio} onRatioChange={handleRatioChange} />
            <div className="control-row inline-2">
              <div>
                <label>Filename</label>
                <input value={project.layout.exportSettings.filename} onChange={(e) => updateLayout({ exportSettings: { filename: e.target.value } })} />
              </div>
              <div>
                <label>Scale</label>
                <select value={project.layout.exportSettings.pixelRatio} onChange={(e) => updateLayout({ exportSettings: { pixelRatio: Number(e.target.value) } })}>
                  <option value={1}>1× — Screen</option>
                  <option value={2}>2× — Print</option>
                  <option value={3}>3× — Large format</option>
                </select>
              </div>
            </div>
            <div className="button-row">
              <button className={`btn primary${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('png'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title={!mapReady ? 'Map is initializing, please wait…' : ''}>{exporting ? 'Exporting…' : !mapReady ? 'Initializing…' : 'Export PNG'}</button>
              <button className={`btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('svg'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title={!mapReady ? 'Map is initializing, please wait…' : ''}>{exporting ? 'Exporting…' : !mapReady ? 'Initializing…' : 'Export SVG'}</button>
              <button className={`btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('svg_ai'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title="SVG bundled with separate basemap PNG — opens correctly in Adobe Illustrator">{exporting ? 'Exporting…' : !mapReady ? 'Initializing…' : 'SVG (Illustrator)'}</button>
              <button className={`btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('pdf'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title={!mapReady ? 'Map is initializing, please wait…' : ''}>{exporting ? 'Exporting…' : !mapReady ? 'Initializing…' : 'Export PDF'}</button>
            </div>
            {exportError && <div className="export-error-msg">{exportError}</div>}
          </div>}
        </section>
      </Sidebar>

      <div className="editor-main">
        {showStorageWarning && (
          <div className="storage-warning-banner">
            Local storage is getting full.{' '}
            <strong>Sign in</strong> to save projects to the cloud.
            <button className="storage-warning-dismiss" onClick={() => setStorageWarningDismissed(true)}>✕</button>
          </div>
        )}
        <div className="map-topbar editor-toolbar">
          <div className="map-topbar-left">
            <div className="map-topbar-title">{project.layout.title || 'Project Map'}</div>
            <div className={`autosave-badge ${isDirty ? 'dirty' : saveFlash ? 'flash' : 'clean'}`}>
              {isDirty ? 'Unsaved' : saveFlash ? '✓ Saved' : user ? 'Cloud ✓' : 'Saved ✓'}
            </div>
          </div>
          <div className="map-topbar-right">
            <div className="topbar-btn-group">
              <button className="topbar-btn" type="button" onClick={() => saveCurrentProject()}>Save</button>
              <button className="topbar-btn" type="button" onClick={saveAsProject}>Save As</button>
              <button className="topbar-btn" type="button" onClick={() => setShowRecentProjects(true)}>Open</button>
              <button className="topbar-btn" type="button" onClick={startNewProject}>New</button>
              <button className="topbar-btn" type="button" onClick={duplicateCurrentProject}>Dup</button>
            </div>
            <div className="topbar-divider" />
            <div className="topbar-btn-group">
              <button className="topbar-btn" type="button" aria-label="Zoom out" onClick={() => leafletMapRef.current?.zoomOut(0.5)}>−</button>
              <button className="topbar-btn" type="button" aria-label="Zoom in" onClick={() => leafletMapRef.current?.zoomIn(0.5)}>+</button>
            </div>
            <div className="topbar-divider" />
            <button className="help-icon-btn" type="button" title="How to use Exploration Maps" onClick={() => setShowHelpModal(true)}>?</button>
            <div className="topbar-btn-group">
              <button className={`topbar-btn primary${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('png'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title={!mapReady ? 'Map is initializing…' : ''}>{exporting ? 'Exporting…' : 'PNG'}</button>
              <button className={`topbar-btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('svg'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting}>SVG</button>
              <button className={`topbar-btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('svg_ai'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title="SVG for Illustrator (ZIP with separate basemap)">AI</button>
              <button className={`topbar-btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('pdf'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting}>PDF</button>
            </div>
            {exportError && <div className="export-error-msg">{exportError}</div>}
          </div>
        </div>
        <div ref={mapViewportRef} className={`map-viewport${activeRatio ? ' map-viewport--ratio-active' : ''}`}>
          {activeRatio && (
            <div className="ratio-frame-badge">
              {EXPORT_RATIOS[activeRatio].label} — {EXPORT_RATIOS[activeRatio].description}
            </div>
          )}
          <div
            ref={mapContainerRef}
            className={`map-stage${activeRatio ? ' map-stage--ratio-constrained' : ''}`}
            data-theme={project.layout.themeId || 'modern_rounded'}
            data-title-accent-style={themeTokens.titleAccentStyle || 'top'}
            data-annotation-tool={annotationTool || ''}
            style={mapStageStyle}
          >
        <React.Suspense fallback={null}>
          <MapCanvas onReady={onMapReady} project={project} template={template} onFeatureClick={handleFeatureClick} onMapClick={handleMapClick} annotationToolRef={annotationToolRef} />
        </React.Suspense>
        {mapReady && (
          <>
            <AnnotationOverlay
              map={leafletMapRef.current}
              markers={project.markers || []}
              ellipses={project.ellipses || []}
              polygons={project.polygons || []}
              pendingPolygon={pendingPolygonPoints}
              selectedMarkerId={selectedMarkerId}
              selectedEllipseId={selectedEllipseId}
              selectedPolygonId={selectedPolygonId}
              onSelectMarker={(id) => { setSelectedMarkerId(id); setSelectedEllipseId(null); setSelectedPolygonId(null); setSelectedFeature(null); }}
              onSelectEllipse={(id) => { setSelectedEllipseId(id); setSelectedMarkerId(null); setSelectedPolygonId(null); setSelectedFeature(null); }}
              onSelectPolygon={(id) => { setSelectedPolygonId(id); setSelectedEllipseId(null); setSelectedMarkerId(null); setSelectedFeature(null); }}
              onMoveMarker={updateMarker}
              onMoveEllipse={updateEllipse}
              onMoveLabelOffset={(id, offset) => updateMarker(id, { labelOffsetX: offset.x, labelOffsetY: offset.y })}
              onMoveEllipseLabelOffset={(id, offset) => updateEllipse(id, { labelOffsetX: offset.x, labelOffsetY: offset.y })}
              onMoveEllipseLabelAngle={(id, angle) => updateEllipse(id, { labelAngle: angle })}
              onMovePolygonLabel={(id, data) => {
                if ('angle' in data) {
                  updatePolygon(id, { labelAngle: data.angle });
                } else {
                  updatePolygon(id, { labelOffsetX: data.x, labelOffsetY: data.y });
                }
              }}
              labelFont={project.layout.fonts?.label}
              pendingDistanceP1={pendingDistanceP1}
              distanceLines={project.distanceLines || []}
              selectedDistanceLineId={selectedDistanceLineId}
              onSelectDistanceLine={setSelectedDistanceLineId}
              onRemoveDistanceLine={removeDistanceLine}
            />
            <CalloutsOverlay
              map={leafletMapRef.current}
              callouts={project.callouts}
              selectedCalloutId={selectedCalloutId}
              onSelect={(id) => { setSelectedCalloutId(id); setSelectedMarkerId(null); setSelectedEllipseId(null); setSelectedFeature(null); }}
              onMove={(id, offset) => updateCallout(id, { offset: { x: offset.x, y: offset.y }, isManualPosition: true })}
              onUpdate={updateCallout}
              fontFamily={project.layout.fonts?.callout}
            />
          </>
        )}

        <ShadeOverlay
          map={leafletMapRef.current}
          ellipses={project.ellipses || []}
          polygons={project.polygons || []}
        />

        {project.layout.templateId === 'ni_43101_technical' && (() => {
          const STRIP_H = 72, TICK_M = 28;
          const stripPos = project.layout.titleStripPosition || 'bottom';
          const stageH = mapSize?.height || 600;
          const stageW = mapSize?.width || 1000;
          const stripY = stripPos === 'bottom' ? stageH - STRIP_H : 0;
          const mapTop = TICK_M + (stripPos === 'top' ? STRIP_H : 0);
          const mapBottom = stageH - TICK_M - (stripPos === 'bottom' ? STRIP_H : 0);
          const mapLeft = TICK_M;
          const mapRight = stageW - TICK_M;
          const monoFont = "'Courier New', Courier, monospace";
          const fs = Math.max(0.7, Math.min(1.4, Number(project.layout.stripFontScale || 1)));
          const scaleDisplay = project.layout.manualScaleDenom
            ? '1:' + Number(String(project.layout.manualScaleDenom).replace(/[^0-9]/g, '')).toLocaleString()
            : 'Auto';
          return (
            <>
              {/* Tick margin overlays */}
              <div style={{ position: 'absolute', top: mapTop, left: 0, width: mapLeft, height: mapBottom - mapTop, background: '#fff', borderRight: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: mapTop, left: mapRight, width: stageW - mapRight, height: mapBottom - mapTop, background: '#fff', borderLeft: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: 0, left: 0, width: stageW, height: mapTop, background: '#fff', borderBottom: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: mapBottom, left: 0, width: stageW, height: stageH - mapBottom - STRIP_H, background: '#fff', borderTop: '1.5px solid #000', zIndex: 390, pointerEvents: 'none' }} />
              {/* Live tick marks */}
              <NIMapOverlay map={leafletMapRef.current} mapSize={mapSize} layout={project.layout} />
              {/* Title strip */}
              <div style={{ position: 'absolute', left: 0, top: stripY, width: stageW, height: STRIP_H, background: '#fff', border: '1.5px solid #000', boxSizing: 'border-box', zIndex: 410, display: 'flex', fontFamily: monoFont }}>
                {/* Cell 0: Title */}
                <div style={{ flex: '0 0 45%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 8 * fs, fontWeight: 700, color: '#000', marginBottom: 2 }}>TITLE</div>
                  {project.layout.stripTitle && <div style={{ fontSize: 14 * fs, fontWeight: 700, fontFamily: 'Arial, sans-serif', color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.layout.stripTitle}</div>}
                  {project.layout.stripSubtitle && <div style={{ fontSize: 9 * fs, fontFamily: 'Arial, sans-serif', color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.layout.stripSubtitle}</div>}
                </div>
                {/* Cell 1: Scale / Projection */}
                <div style={{ flex: '0 0 20%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 7 * fs, fontWeight: 700, color: '#000', marginBottom: 1 }}>SCALE</div>
                  <div style={{ fontSize: 10 * fs, color: '#000', marginBottom: 4 }}>{scaleDisplay}</div>
                  <div style={{ fontSize: 7 * fs, fontWeight: 700, color: '#000', marginBottom: 1 }}>PROJECTION</div>
                  <div style={{ fontSize: 8 * fs, color: '#000' }}>{project.layout.projectionName || (() => {
                    try {
                      const c = leafletMapRef.current?.getCenter();
                      if (!c) return 'WGS84';
                      const z = Math.floor((c.lng + 180) / 6) + 1;
                      return `WGS84 / UTM Zone ${z}${c.lat >= 0 ? 'N' : 'S'}`;
                    } catch { return 'WGS84'; }
                  })()}</div>
                </div>
                {/* Cell 2: QP */}
                <div style={{ flex: '0 0 20%', borderRight: '1px solid #000', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 7 * fs, fontWeight: 700, color: '#000', marginBottom: 1 }}>QUALIFIED PERSON</div>
                  <div style={{ fontSize: 10 * fs, color: '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.layout.qpName || '—'}</div>
                  {project.layout.qpCredentials && <div style={{ fontSize: 8 * fs, color: '#000' }}>{project.layout.qpCredentials}</div>}
                  {project.layout.companyName && <div style={{ fontSize: 7 * fs, color: '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.layout.companyName}</div>}
                </div>
                {/* Cell 3: Figure */}
                <div style={{ flex: '0 0 15%', padding: '6px 8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 7 * fs, fontWeight: 700, color: '#000', marginBottom: 1 }}>FIGURE</div>
                  <div style={{ fontSize: 12 * fs, fontWeight: 700, color: '#000' }}>{project.layout.figureNumber || '—'}</div>
                  {project.layout.figureRevision && <div style={{ fontSize: 8 * fs, color: '#000' }}>{project.layout.figureRevision}</div>}
                  {project.layout.mapDate && <div style={{ fontSize: 7 * fs, color: '#444' }}>{project.layout.mapDate}</div>}
                </div>
              </div>
            </>
          );
        })()}

        {project.layout.templateId === 'side_panel' && resolvedZones.sidebar?.width > 0 && (
          <div style={{
            position: 'absolute',
            top: resolvedZones.sidebar.top,
            left: resolvedZones.sidebar.left,
            width: resolvedZones.sidebar.width,
            height: resolvedZones.sidebar.height,
            background: 'var(--panel-fill, #ffffff)',
            borderLeft: '1.5px solid var(--panel-border, #d4deea)',
            zIndex: 4,
            pointerEvents: 'none',
          }} />
        )}

        {project.layout.templateId !== 'ni_43101_technical' && project.layout.showTitle !== false && <div className="template-zone" style={{ ...zoneStyle(resolvedZones.title), opacity: dragging?.id === 'title' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('title', project.layout.titleWidthPx ?? 520, project.layout.titleHeightPx ?? 92)}>
          <button className="panel-delete-btn" title="Hide title" onClick={() => updateLayout({ showTitle: false })}>×</button>
          <div className={`template-card title-card${project.layout.titleTransparent ? ' panel--transparent' : ''}`}>
            {editingTitleField === 'title' ? (
              <input
                className="title-inline-input"
                autoFocus
                defaultValue={project.layout.title || ''}
                onBlur={(e) => { updateLayout({ title: e.target.value }); setLocalTitle(e.target.value); setEditingTitleField(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }}
              />
            ) : (
              <h2 style={{ cursor: 'text', fontSize: Math.round(22 * (project.layout.titleFontScale ?? 1)) + 'px' }} title="Click to edit" onClick={() => setEditingTitleField('title')}>{project.layout.title}</h2>
            )}
            {editingTitleField === 'subtitle' ? (
              <input
                className="title-inline-input subtitle-inline-input"
                autoFocus
                defaultValue={project.layout.subtitle || ''}
                onBlur={(e) => { updateLayout({ subtitle: e.target.value }); setLocalSubtitle(e.target.value); setEditingTitleField(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }}
              />
            ) : (
              <p style={{ cursor: 'text', fontSize: Math.round(12 * (project.layout.titleFontScale ?? 1)) + 'px' }} title="Click to edit" onClick={() => setEditingTitleField('subtitle')}>{project.layout.subtitle}</p>
            )}
          </div>
          {makeResizeHandles(project.layout.titleCorner || 'tl', {
            elemId: 'title', startW: project.layout.titleWidthPx ?? 520, startH: project.layout.titleHeightPx ?? 92,
            minW: 300, maxW: 800, minH: 60, maxH: 180,
            applyW: (w) => updateLayout({ titleWidthPx: w }), applyH: (h) => updateLayout({ titleHeightPx: h }),
          })}
        </div>}

        {legendItems.length && project.layout.showLegend !== false ? (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.legend), opacity: dragging?.id === 'legend' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('legend', project.layout.legendWidthPx ?? 300, project.layout.legendHeightPx ?? resolvedZones.legend?.height ?? 168)}>
            <button className="panel-delete-btn" title="Hide legend" onClick={() => updateLayout({ showLegend: false })}>×</button>
            <div className={`template-card legend-card${project.layout.legendTransparent ? ' panel--transparent' : ''}`}>
              <div className="legend-header"><h3 style={{ fontSize: Math.round(15 * (project.layout.legendFontScale ?? 1)) + 'px' }}>Legend</h3></div>
              <div className="legend-list" style={{ fontSize: Math.round(13 * (project.layout.legendFontScale ?? 1)) + 'px' }}>
                {legendGroups.map((group) => (
                  <div key={group.heading || 'all'} className="legend-group">
                    {group.heading ? <div className="legend-group-title">{group.heading}</div> : null}
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className="legend-item legend-item-clickable"
                        onClick={() => { const lid = item.id.includes('::') ? item.id.slice(0, item.id.lastIndexOf('::')) : item.id; setSelectedLayerId(lid); }}
                      >
                        {item.type === 'points' ? (
                          <LegendPointSwatch style={item.style} />
                        ) : item.type === 'line' ? (
                          <svg className="legend-line-svg" width="22" height="12" aria-hidden="true" style={{ flexShrink: 0 }}>
                            <line x1="0" y1="6" x2="22" y2="6"
                              stroke={item.style.stroke || '#333'}
                              strokeWidth={Math.min(item.style.strokeWidth ?? 2, 3)}
                              strokeDasharray={item.style.dashArray || ''}
                            />
                          </svg>
                        ) : (
                          <span className="legend-swatch" style={{ borderColor: item.style.stroke || '#3b82f6', background: item.style.fill || '#93c5fd', opacity: item.style.fillOpacity ?? 1 }} />
                        )}
                        <LegendLabelEditable label={item.label} onSave={(val) => setDisplayLabel(item.id, val)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {makeResizeHandles(project.layout.legendCorner || 'bl', {
              elemId: 'legend', startW: project.layout.legendWidthPx ?? 300, startH: project.layout.legendHeightPx ?? resolvedZones.legend?.height ?? 168,
              minW: 180, maxW: 480, minH: 60, maxH: 500,
              applyW: (w) => updateLayout({ legendWidthPx: w }), applyH: (h) => updateLayout({ legendHeightPx: h }),
            })}
          </div>
        ) : null}

        {project.layout.showNorthArrow !== false && resolvedZones.northArrow?.width > 0 && (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.northArrow), opacity: dragging?.id === 'northArrow' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('northArrow', resolvedZones.northArrow?.width ?? 80, project.layout.northArrowHeightPx ?? 100)}>
            <button className="panel-delete-btn" title="Hide compass rose" onClick={() => updateLayout({ showNorthArrow: false })}>×</button>
            <NorthArrow scale={project.layout.northArrowHeightPx ?? 100} />
            {makeResizeHandles(project.layout.northArrowCorner || 'br', {
              elemId: 'northArrow', startW: resolvedZones.northArrow?.width ?? 80, startH: project.layout.northArrowHeightPx ?? 100,
              minW: 40, maxW: 200, minH: 50, maxH: 200,
              applyW: null, applyH: (h) => updateLayout({ northArrowHeightPx: h }),
            })}
          </div>
        )}
        {project.layout.insetEnabled !== false && resolvedZones.inset?.width ? (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.inset), opacity: dragging?.id === 'inset' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('inset', project.layout.insetWidthPx ?? 244, project.layout.insetHeightPx ?? 190)}>
            <button className="panel-delete-btn" title="Hide inset map" onClick={() => updateLayout({ insetEnabled: false })}>×</button>
            <LocatorInset layers={project.layers} insetMode={project.layout.insetMode} insetImage={project.layout.insetImage} autoInsetRegion={project.layout.autoInsetRegion} insetTitle={project.layout.insetTitle} insetLabel={project.layout.insetLabel} mode={project.layout.mode} zone={{ width: '100%', height: '100%' }} regionFill={project.layout.insetRegionFill} regionStroke={project.layout.insetRegionStroke} bgFill={project.layout.insetBgFill} markerColor={project.layout.insetMarkerColor} />
            {makeResizeHandles(project.layout.insetCorner || 'tr', {
              elemId: 'inset', startW: project.layout.insetWidthPx ?? 244, startH: project.layout.insetHeightPx ?? 190,
              minW: 100, maxW: 600, minH: 80, maxH: 500,
              applyW: (w) => updateLayout({ insetWidthPx: w }), applyH: (h) => updateLayout({ insetHeightPx: h }),
            })}
          </div>
        ) : null}
        {project.layout.showScaleBar !== false && (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.scaleBar), width: project.layout.scaleBarWidthPx || resolvedZones.scaleBar?.width, opacity: dragging?.id === 'scaleBar' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('scaleBar', project.layout.scaleBarWidthPx || resolvedZones.scaleBar?.width || 160, project.layout.scaleBarHeightPx ?? 48)}>
            <ScaleBar map={leafletMapRef.current} height={project.layout.scaleBarHeightPx ?? 48} />
            <button className="panel-delete-btn" title="Hide scale bar" onClick={() => updateLayout({ showScaleBar: false })}>×</button>
            {makeResizeHandles(project.layout.scaleBarCorner || 'bl', {
              elemId: 'scaleBar', startW: project.layout.scaleBarWidthPx || resolvedZones.scaleBar?.width || 160, startH: project.layout.scaleBarHeightPx ?? 48,
              minW: 80, maxW: 400, minH: 30, maxH: 100,
              applyW: (w) => updateLayout({ scaleBarWidthPx: w }), applyH: (h) => updateLayout({ scaleBarHeightPx: h }),
            })}
          </div>
        )}
        {project.layout.templateId !== 'ni_43101_technical' && project.layout.footerText && project.layout.footerEnabled !== false ? (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.footer), height: project.layout.footerHeightPx || resolvedZones.footer?.height }}>
            <div className="template-card footer-card">{project.layout.footerText}</div>
            <button className="panel-delete-btn" title="Hide disclaimer" onClick={() => updateLayout({ footerEnabled: false })}>×</button>
            <div className="panel-resize-handle panel-resize-handle--bottom" title="Drag to resize disclaimer height" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startY = e.clientY; const startH = project.layout.footerHeightPx || resolvedZones.footer?.height || 36; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, footerHeightPx: Math.max(24, Math.min(120, Math.round(startH + me.clientY - startY))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
          </div>
        ) : null}
        {project.layout.logo ? (
          <div className="template-zone" style={{ ...zoneStyle(resolvedZones.logo), opacity: dragging?.id === 'logo' ? 0.3 : 1, cursor: 'grab' }} onMouseDown={makeDragHandler('logo', project.layout.logoWidthPx ?? 168, project.layout.logoHeightPx ?? 74)}>
            <div className={`template-card logo-card${project.layout.logoTransparent ? ' panel--transparent' : ''}`}><img src={project.layout.logo} alt="Logo" /></div>
            <button className="panel-delete-btn" title="Remove logo" onClick={() => updateLayout({ logo: null })}>×</button>
            {makeResizeHandles(project.layout.logoCorner || 'tl', {
              elemId: 'logo', startW: project.layout.logoWidthPx ?? 168, startH: project.layout.logoHeightPx ?? 74,
              minW: 40, maxW: 400, minH: 20, maxH: 300,
              applyW: (w) => updateLayout({ logoWidthPx: w }), applyH: (h) => updateLayout({ logoHeightPx: h }),
            })}
          </div>
        ) : null}
        {selectedFeature && featureEditorPoint ? (
          <div className="drillhole-inline-editor" style={{ left: featureEditorPoint.left, top: featureEditorPoint.top }}>
            <div className="drillhole-inline-header">
              <div className="drillhole-inline-title">{selectedFeature.layerName}</div>
              <button className="drillhole-inline-close" type="button" onClick={() => setSelectedFeature(null)}>×</button>
            </div>
            <div className="control-row">
              <label>Title</label>
              <input value={selectedFeature.suggestedLabel} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, suggestedLabel: e.target.value }))} placeholder="Title" />
            </div>
            <div className="control-row">
              <label>Subtext</label>
              <input value={selectedFeature.suggestedSubtext || ''} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, suggestedSubtext: e.target.value }))} placeholder="Subtext" />
            </div>
            <div className="drillhole-inline-row2">
              <div className="control-row">
                <label>Type</label>
                <select value={selectedFeature.calloutType || 'leader'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, calloutType: e.target.value }))}>
                  {Object.entries(CALLOUT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            {selectedFeature.calloutType === 'badge' && (
              <div className="drillhole-inline-row2">
                <div className="control-row">
                  <label>Chip Text</label>
                  <input value={selectedFeature.badgeValue || ''} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, badgeValue: e.target.value }))} placeholder=">14 Moz" />
                </div>
                <div className="control-row">
                  <label>Chip Color</label>
                  <input type="color" value={selectedFeature.badgeColor || '#d97706'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, badgeColor: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="drillhole-inline-row2">
              <div className="control-row">
                <label>BG</label>
                <input type="color" value={selectedFeature.style?.background || '#ffffff'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), background: e.target.value } }))} />
              </div>
              <div className="control-row">
                <label>Border</label>
                <input type="color" value={selectedFeature.style?.border || '#102640'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), border: e.target.value } }))} />
              </div>
              <div className="control-row">
                <label>Text</label>
                <input type="color" value={selectedFeature.style?.textColor || '#0f172a'} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, style: { ...(prev.style || {}), textColor: e.target.value } }))} />
              </div>
            </div>
            <div className="control-row" style={{ marginTop: 6 }}>
              <label>Marker Shape</label>
              <div className="marker-shape-picker">
                {(() => {
                  const fKey = featureKey(selectedFeature.feature);
                  const featureLayer = project.layers.find((l) => l.id === selectedFeature.layerId);
                  const currentShape = featureLayer?.featureOverrides?.[fKey]?.markerShape ?? featureLayer?.style?.markerShape ?? 'circle';
                  return [
                    ['circle', 'Circle'],
                    ['triangle_down', 'Tri ▼'],
                    ['triangle', 'Tri ▲'],
                    ['square', 'Square'],
                    ['diamond', 'Diamond'],
                    ['cross', 'Cross'],
                    ['drillhole', 'DH Pin'],
                    ['star', 'Star'],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`shape-btn${currentShape === val ? ' active' : ''}`}
                      onClick={() => setFeatureOverride(selectedFeature.layerId, fKey, { markerShape: val })}
                      title={label}
                    >
                      {label}
                    </button>
                  ));
                })()}
              </div>
            </div>
            <button className="btn primary" style={{ width: '100%', marginTop: 8 }} type="button" onClick={addCalloutFromSelectedFeature}>Add Callout</button>
          </div>
        ) : null}
        {resizeGuides.map((g, i) => (
          <div key={i} className={`resize-guide resize-guide--${g.type}`} style={g.type === 'v' ? { left: g.pos } : { top: g.pos }} />
        ))}
        {/* Standard template: corner drop zone clusters + center crosshair guides */}
        {dragging && project.layout.templateId !== 'side_panel' && (
          <>
            <div className="canvas-drag-guide-v" />
            <div className="canvas-drag-guide-h" />
            {['tl','tr','bl','br'].map((corner) => {
              const isTop = corner[0] === 't';
              const isLeft = corner[1] === 'l';
              const hz = dragging.hoverZone;
              const isHov = (slot) => hz?.corner === corner && hz?.slot === slot;
              return (
                <div key={corner} className={`drop-zone-cluster drop-zone-cluster--${corner}`}>
                  <div className="dzs-row">
                    <div className={`dzs dzs-first${isHov('first') ? ' dzs--hover' : ''}`} data-corner={corner} data-slot="first">
                      {isLeft ? '◤ Corner' : 'Corner ◥'}
                    </div>
                    <div className={`dzs dzs-beside${isHov('beside') ? ' dzs--hover' : ''}`} data-corner={corner} data-slot="beside">⊞ Side by side</div>
                  </div>
                  <div className="dzs-row">
                    <div className={`dzs dzs-last${isHov('last') ? ' dzs--hover' : ''}`} data-corner={corner} data-slot="last">
                      {isTop ? '↓ Stack below' : '↑ Stack above'}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
        {/* Side panel template: sidebar insert dividers + map area slot targets */}
        {dragging && project.layout.templateId === 'side_panel' && (() => {
          const sidebar = resolvedZonesRef.current?.sidebar;
          const sbLeft = sidebar?.left ?? Math.round(mapSize.width * 0.72);
          const sbW = sidebar?.width ?? Math.round(mapSize.width * 0.28);
          const isSbEl = SP_SIDEBAR_ELEMENTS.includes(dragging.id);
          if (isSbEl) {
            const order = (project.layout.sidePanelOrder || ['inset', 'legend', 'logo']).filter(eid => eid !== dragging.id);
            const insertPositions = [];
            // Position before first element
            const sbTop = sidebar?.top ?? 0;
            insertPositions.push(sbTop + 8);
            order.forEach(eid => {
              const z = resolvedZonesRef.current?.[eid];
              if (z?.height > 0 && z?.top > 0) insertPositions.push(z.top + z.height + 5);
            });
            return insertPositions.map((pos, i) => (
              <div key={i} className={`sp-insert-divider${dragging.hoverInsertIdx === i ? ' sp-insert-divider--active' : ''}`}
                style={{ top: pos, left: sbLeft, width: sbW }} />
            ));
          } else {
            const slots = Object.entries(mapSlotPositions(sbLeft, mapSize.height)).map(([key, pos]) => ({ id: key, ...pos }));
            const zW = dragging.ghostW || 80, zH = dragging.ghostH || 48;
            return slots.map(s => (
              <div key={s.id} className={`sp-map-slot${dragging.hoverMapSlot === s.id ? ' sp-map-slot--active' : ''}`}
                style={{ left: s.left, top: s.top, width: zW, height: zH }} />
            ));
          }
        })()}
          </div>
        </div>
      </div>
      {dragging && (
        <div className="drag-ghost" style={{
          left: dragging.ghostX,
          top: dragging.ghostY,
          width: dragging.ghostW,
          height: dragging.ghostH,
        }} />
      )}
      {/* Template Manager Modal */}
      {showTemplateManager && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowTemplateManager(false); }}>
          <div className="modal-panel tmgr-panel">
            <button className="modal-close-btn" onClick={() => setShowTemplateManager(false)}>×</button>
            <div className="tmgr-header">
              <h2 className="tmgr-title">Saved Templates</h2>
              <p className="tmgr-subtitle">Save your brand look once, apply to any project.</p>
            </div>

            {/* Save new template form */}
            <div className="tmgr-save-section">
              {savingTemplateName !== null ? (
                <div className="tmgr-save-row">
                  <input
                    autoFocus
                    className="tmgr-name-input"
                    placeholder="Template name…"
                    value={savingTemplateName}
                    onChange={(e) => setSavingTemplateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doSaveTemplate();
                      if (e.key === 'Escape') setSavingTemplateName(null);
                    }}
                  />
                  <button
                    className="btn compact"
                    type="button"
                    disabled={!savingTemplateName.trim() || savingTemplate}
                    onClick={doSaveTemplate}
                  >{savingTemplate ? 'Saving…' : 'Save'}</button>
                  <button className="btn compact secondary" type="button" onClick={() => setSavingTemplateName(null)}>Cancel</button>
                </div>
              ) : (
                <button className="btn compact" type="button" onClick={() => setSavingTemplateName(projectName || '')}>+ Save Current Settings as Template</button>
              )}
            </div>

            {/* Template list */}
            {cloudTemplates.length === 0 ? (
              <p className="tmgr-empty">No templates saved yet.</p>
            ) : (
              <ul className="tmgr-list">
                {cloudTemplates.map((tmpl) => (
                  <li key={tmpl.id} className="tmgr-row">
                    <button
                      className={`tmgr-star${tmpl.is_default ? ' active' : ''}`}
                      title={tmpl.is_default ? 'Default template' : 'Set as default'}
                      onClick={async () => {
                        if (tmpl.is_default) return;
                        await setDefaultTemplate(tmpl.id);
                        listTemplates().then(setCloudTemplates).catch(() => {});
                      }}
                    >★</button>
                    <div className="tmgr-name-block">
                      {renamingTemplateId === tmpl.id ? (
                        <div className="tmgr-rename-row">
                          <input
                            autoFocus
                            className="tmgr-name-input"
                            value={renamingTemplateName}
                            onChange={(e) => setRenamingTemplateName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                await updateTemplate(tmpl.id, { name: renamingTemplateName.trim() || tmpl.name });
                                listTemplates().then(setCloudTemplates).catch(() => {});
                                setRenamingTemplateId(null);
                              }
                              if (e.key === 'Escape') setRenamingTemplateId(null);
                            }}
                          />
                          <button className="tmgr-icon-btn" title="Confirm" onClick={async () => {
                            await updateTemplate(tmpl.id, { name: renamingTemplateName.trim() || tmpl.name });
                            listTemplates().then(setCloudTemplates).catch(() => {});
                            setRenamingTemplateId(null);
                          }}>✓</button>
                          <button className="tmgr-icon-btn muted" title="Cancel" onClick={() => setRenamingTemplateId(null)}>✗</button>
                        </div>
                      ) : (
                        <span className="tmgr-name">{tmpl.name}</span>
                      )}
                      {tmpl.is_default && <span className="tmgr-badge">Default</span>}
                    </div>
                    <div className="tmgr-actions">
                      <button
                        className="btn compact"
                        type="button"
                        onClick={() => {
                          const newLayout = applyTemplateConfig(tmpl.config || {}, project.layout);
                          updateLayout(Object.fromEntries(Object.entries(newLayout).filter(([k]) => newLayout[k] !== project.layout[k])));
                          setShowTemplateManager(false);
                          setUploadStatus({ type: 'success', message: `"${tmpl.name}" applied — upload your layers to get started.` });
                        }}
                      >Apply</button>
                      <button
                        className="tmgr-icon-btn"
                        title="Rename"
                        onClick={() => { setRenamingTemplateId(tmpl.id); setRenamingTemplateName(tmpl.name); }}
                      >✎</button>
                      <button
                        className="tmgr-icon-btn danger"
                        title="Delete"
                        onClick={async () => {
                          if (!window.confirm(`Delete template "${tmpl.name}"?`)) return;
                          await deleteTemplate(tmpl.id);
                          listTemplates().then(setCloudTemplates).catch(() => {});
                        }}
                      >✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showRecentProjects ? (
        <RecentProjectsModal
          entries={recentProjects}
          currentProjectId={projectId}
          onOpen={(entry) => { openProjectFromRecent(entry); setShowRecentProjects(false); }}
          onRename={(id, newName) => {
            if (user) {
              renameCloudProject(id, newName).then(() => listCloudProjects().then(setRecentProjects)).catch(() => {});
            } else {
              renameProjectRecord(id, newName);
              setRecentProjects(listProjects());
            }
            if (id === projectId) setProjectName(newName);
          }}
          onDelete={(id) => {
            if (user) {
              deleteCloudProject(id).then(() => listCloudProjects().then(setRecentProjects)).catch(() => {});
            } else {
              deleteProjectRecord(id);
              setRecentProjects(listProjects());
            }
            if (id === projectId) { setProjectId(null); clearActiveProjectContext(); }
          }}
          onClose={() => setShowRecentProjects(false)}
        />
      ) : null}
      <React.Suspense fallback={null}>
        {showExportModal ? (
          <ExportHDModal
            format={pendingExportFormat}
            activeRatio={activeRatio}
            onConfirm={handleExportModalConfirm}
            onWithWatermark={handleExportModalWithWatermark}
            onClose={() => setShowExportModal(false)}
          />
        ) : null}
        {showHelpModal && <HowToUseModal onClose={() => setShowHelpModal(false)} />}
        {csvMappingData ? (
          <ColumnMapperModal
          headers={csvMappingData.headers}
          rows={csvMappingData.rows}
          filename={csvMappingData.filename}
          onImport={async (geojson) => {
            setCsvMappingData(null);
            try {
              await addGeoJSONAsLayer(geojson, csvMappingData.filename);
              if (screen !== 'editor') setScreen('editor');
            } catch (err) {
              setUploadStatus({ type: 'error', message: `Import failed: ${err.message}` });
            }
          }}
          onClose={() => setCsvMappingData(null)}
        />
        ) : null}
      </React.Suspense>
    </div>
  );
}
