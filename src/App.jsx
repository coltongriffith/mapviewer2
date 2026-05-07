import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MapCanvas from './components/MapCanvas';
import RatioSwitcher from './components/RatioSwitcher';
import Sidebar from './components/Sidebar';
import LayerList from './components/LayerList';
import LocatorInset from './components/LocatorInset';
import CalloutsOverlay from './components/CalloutsOverlay';
import LandingPage from './components/LandingPage';
import ExportHDModal from './components/ExportHDModal';
import UploadPanel from './components/UploadPanel';
import AnnotationOverlay from './components/AnnotationOverlay';
import ShadeOverlay from './components/ShadeOverlay';
import ColumnMapperModal from './components/ColumnMapperModal';
import HowToUseModal from './components/HowToUseModal';
import { loadGeoJSON, loadCSV } from './utils/importers';
import sampleClaims from './assets/sampleClaims.json';
import sampleDrillholes from './assets/sampleDrillholes.json';
import { buildScene } from './export/buildScene';
import { exportPNG } from './export/exportPNG';
import { exportSVG } from './export/exportSVG';
import { exportPDF } from './export/exportPDF';
import { getExportWarnings } from './export/renderScene';
import {
  CALLOUT_TYPES,
  createInitialProjectState,
  FONT_OPTIONS,
  ROLE_LABELS,
  POINT_ROLES,
  TEMPLATE_MODES,
  TEMPLATE_THEMES,
} from './projectState';
import { EXPORT_RATIOS } from './constants';
import { applyRoleToLayer, inferRoleFromLayer } from './mapPresets';
import { getTemplate } from './templates';
import { buildLegendItems, resolveTemplateZones } from './templates/technicalResultsTemplate';
import { geojsonBounds, geojsonCenter, unionBounds } from './utils/geometry';
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
  applyTemplateConfig,
} from './utils/cloudStorage';
import { useAuth } from './hooks/useAuth';
import UserMenu from './components/UserMenu';

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

const MARKER_TYPES = {
  circle: 'Circle',
  square: 'Square',
  triangle: 'Triangle',
  pickaxe: 'Pickaxe',
  shovel: 'Shovel',
  star: 'Star',
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

function NorthArrow() {
  return (
    <div className="template-card north-arrow-card">
      <div className="north-arrow-label">N</div>
      <div className="north-arrow-icon">▲</div>
      <div className="north-arrow-stem" />
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
        const latlng1 = map.containerPointToLatLng([20, size.y - 40]);
        const latlng2 = map.containerPointToLatLng([150, size.y - 40]);
        const meters = latlng1.distanceTo(latlng2);
        const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
        const nice = steps.reduce((best, n) => (Math.abs(n - meters) < Math.abs(best - meters) ? n : best), steps[0]);
        setState({
          label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`,
          width: Math.max(70, Math.min(180, Math.round((130 * nice) / Math.max(meters, 1)))),
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

export default function App() {
  const mapContainerRef = useRef(null);
  const mapViewportRef = useRef(null);
  const leafletMapRef = useRef(null);
  const logoInputRef = useRef(null);
  const insetInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const { user } = useAuth();
  const [storageWarningDismissed, setStorageWarningDismissed] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [cloudTemplates, setCloudTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [screen, setScreen] = useState('landing');
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
  const [annotationTool, setAnnotationTool] = useState(null);
  const [uploadStatus, setUploadStatus] = useState({ type: 'info', message: 'Open the editor, then upload your first file from the left panel.' });
  const [exporting, setExporting] = useState(false);
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
  const titleDebounceRef = useRef(null);
  const subtitleDebounceRef = useRef(null);
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
  const resolvedZones = useMemo(() => resolveTemplateZones(template, project.layout, mapSize, legendItems), [template, project.layout, mapSize, legendItems]);
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

  // Sync local title/subtitle when project changes from an external action (open, duplicate, new)
  useEffect(() => {
    setLocalTitle(project.layout.title || '');
    setLocalSubtitle(project.layout.subtitle || '');
  }, [projectId]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return undefined;
    const update = () => setMapSize({ width: container.clientWidth, height: container.clientHeight });
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
    fitProjectToTemplate(
      project,
      map,
      { ...template, zones: resolvedZonesRef.current },
      project.layout.compositionPreset || template.modePresets?.[project.layout.mode]?.framing || 'balanced'
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, project.layout.frameVersion, project.layout.primaryLayerId, project.layout.compositionPreset, project.layers]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return undefined;
    const rerender = () => setFeatureEditorTick((value) => value + 1);
    map.on('move zoom zoomend moveend resize', rerender);
    return () => map.off('move zoom zoomend moveend resize', rerender);
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

  const loadSampleData = async () => {
    const makeFile = (json, name) => new File([JSON.stringify(json)], name, { type: 'application/json' });
    setProject(createInitialProjectState());
    try {
      await addGeoJSONLayer(makeFile(sampleClaims, 'Sample Claims.geojson'));
      await addGeoJSONLayer(makeFile(sampleDrillholes, 'Sample Drillholes.geojson'));
      updateLayout({
        logo: SAMPLE_LOGO_URL,
        accentColor: SAMPLE_ACCENT,
        title: 'Buckhorn Creek Property',
        subtitle: 'Cariboo Region, British Columbia',
        footerText: 'Buckhorn Creek Mining Corp. | Cariboo Region, BC | For internal use only',
        footerEnabled: true,
        exportSettings: { filename: 'buckhorn-creek-property', pixelRatio: 2 },
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


  const setDisplayLabel = (layerId, value) => {
    updateLayer(layerId, { displayName: value, legend: { label: value } });
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
      const scene = buildScene(mapContainerRef.current, { ...project, layout: { ...project.layout, legendItems } }, leafletMapRef.current);
      const opts = { ...(project.layout?.exportSettings || {}), ...extraOptions };
      if (format === 'png') {
        await exportPNG(scene, opts);
      } else if (format === 'svg') {
        await exportSVG(scene, opts);
      } else if (format === 'pdf') {
        await exportPDF(scene, opts);
      }
      const warnings = getExportWarnings();
      if (warnings.length > 0) {
        setUploadStatus({ type: 'info', message: `Export complete — note: ${warnings.join('; ')}.` });
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

  if (screen === 'landing') {
    return (
      <>
        <LandingPage
          onOpenEditor={() => setScreen('editor')}
          onLoadSample={loadSampleData}
          recentProjects={recentProjects}
          onOpenProject={(entry) => { openProjectFromRecent(entry); setScreen('editor'); }}
          onShowHelp={() => setShowHelpModal(true)}
        />
        {showHelpModal && <HowToUseModal onClose={() => setShowHelpModal(false)} />}
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

        <UploadPanel onUploadFile={handleUploadFile} inputRef={uploadInputRef} status={uploadStatus} layers={project.layers} />

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
            <div className="control-row">
              <label>Basemap</label>
              <select value={project.layout.basemap} onChange={(e) => updateLayout({ basemap: e.target.value })}>
                <option value="light">Light</option>
                <option value="satellite">Satellite</option>
                <option value="topo">Topo</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="element-visibility-row">
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showNorthArrow !== false} onChange={(e) => updateLayout({ showNorthArrow: e.target.checked })} /><span>North Arrow</span></label>
              <label className="toggle-row"><input type="checkbox" checked={project.layout.showScaleBar !== false} onChange={(e) => updateLayout({ showScaleBar: e.target.checked })} /><span>Scale Bar</span></label>
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
                  <input type="color" value={selectedLayer.style?.stroke || selectedLayer.style?.markerColor || '#2563eb'} onChange={(e) => updateLayer(selectedLayer.id, { style: { stroke: e.target.value, markerColor: e.target.value } })} />
                </div>
                <div>
                  <label>{isPointStyledLayer(selectedLayer) ? 'Point Fill' : 'Fill Color'}</label>
                  <input type="color" value={selectedLayer.style?.fill || selectedLayer.style?.markerFill || '#93c5fd'} onChange={(e) => updateLayer(selectedLayer.id, { style: { fill: e.target.value, markerFill: e.target.value } })} />
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
                    <div className="marker-shape-picker">
                      {[
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
                          className={`shape-btn${(selectedLayer.style?.markerShape || 'circle') === val ? ' active' : ''}`}
                          onClick={() => updateLayer(selectedLayer.id, { style: { markerShape: val } })}
                          title={label}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Fill Opacity</label>
                      <input type="range" min="0" max="1" step="0.05" value={selectedLayer.style?.fillOpacity ?? 0.22} onChange={(e) => updateLayer(selectedLayer.id, { style: { fillOpacity: Number(e.target.value) } })} />
                    </div>
                    <div className="range-value">{Math.round((selectedLayer.style?.fillOpacity ?? 0.22) * 100)}%</div>
                  </div>
                  <div className="control-row inline-2">
                    <div>
                      <label>Layer Opacity</label>
                      <input type="range" min="0" max="1" step="0.05" value={selectedLayer.style?.layerOpacity ?? 1} onChange={(e) => updateLayer(selectedLayer.id, { style: { layerOpacity: Number(e.target.value) } })} />
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
              <div className="control-row"><label>Label</label><input value={selectedEllipse.label || ''} onChange={(e) => updateEllipse(selectedEllipse.id, { label: e.target.value })} placeholder={selectedEllipse.isRing ? `${selectedEllipse.radiusKm} km` : ''} /></div>
              {selectedEllipse.isRing ? (
                <>
                  <div className="control-row inline-2">
                    <div>
                      <label>Radius (km)</label>
                      <input type="number" min="1" max="5000" step="1" value={selectedEllipse.radiusKm ?? 50} onChange={(e) => updateEllipse(selectedEllipse.id, { radiusKm: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label>Ring Color</label>
                      <input type="color" value={selectedEllipse.color || '#dc2626'} onChange={(e) => updateEllipse(selectedEllipse.id, { color: e.target.value })} />
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
                <div className="control-row"><label>Legend Title</label><input value={project.layout.legendTitle ?? 'Legend'} onChange={(e) => updateLayout({ legendTitle: e.target.value })} placeholder="Legend" /></div>
                <div className="control-row"><label>Footer / Disclaimer</label><input value={project.layout.footerText || ''} onChange={(e) => updateLayout({ footerText: e.target.value })} placeholder="e.g. For internal use only" /></div>
                <div className="control-row inline-2">
                  <div><label>Map Date</label><input value={project.layout.mapDate || ''} onChange={(e) => updateLayout({ mapDate: e.target.value })} placeholder="e.g. April 2025" /></div>
                  <div><label>Project #</label><input value={project.layout.projectNumber || ''} onChange={(e) => updateLayout({ projectNumber: e.target.value })} placeholder="e.g. P-2024-01" /></div>
                </div>
                <div className="control-row"><label>Scale Note</label><input value={project.layout.mapScaleNote || ''} onChange={(e) => updateLayout({ mapScaleNote: e.target.value })} placeholder="e.g. 1:50,000" /></div>
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

            {/* Company Templates */}
            <div className="template-manager-block">
              <div className="template-manager-header">
                <span className="template-manager-label">Company Templates</span>
                {user && (
                  <button
                    className="btn compact"
                    type="button"
                    disabled={savingTemplate}
                    onClick={async () => {
                      const name = window.prompt('Template name', projectName || 'My Template');
                      if (!name) return;
                      setSavingTemplate(true);
                      try {
                        const config = {
                          themeId: project.layout.themeId,
                          accentColor: project.layout.accentColor,
                          titleBgColor: project.layout.titleBgColor,
                          titleFgColor: project.layout.titleFgColor,
                          panelBgColor: project.layout.panelBgColor,
                          panelFgColor: project.layout.panelFgColor,
                          logo: project.layout.logo,
                          logoScale: project.layout.logoScale,
                          mode: project.layout.mode,
                          fonts: project.layout.fonts,
                        };
                        await saveTemplate({ name, config });
                        const updated = await listTemplates();
                        setCloudTemplates(updated);
                        setUploadStatus({ type: 'success', message: `Template "${name}" saved.` });
                      } catch (err) {
                        setUploadStatus({ type: 'error', message: `Failed to save template: ${err.message}` });
                      } finally {
                        setSavingTemplate(false);
                      }
                    }}
                  >
                    + Save
                  </button>
                )}
              </div>
              {!user ? (
                <p className="template-manager-hint">Sign in to save and apply company templates.</p>
              ) : cloudTemplates.length === 0 ? (
                <p className="template-manager-hint">No templates yet. Save one above.</p>
              ) : (
                <ul className="template-manager-list">
                  {cloudTemplates.map((tmpl) => (
                    <li key={tmpl.id} className="template-manager-row">
                      <button
                        className={`template-default-star${tmpl.is_default ? ' active' : ''}`}
                        title={tmpl.is_default ? 'Default template' : 'Set as default'}
                        onClick={async () => {
                          try {
                            await setDefaultTemplate(tmpl.id);
                            const updated = await listTemplates();
                            setCloudTemplates(updated);
                          } catch (err) {
                            setUploadStatus({ type: 'error', message: err.message });
                          }
                        }}
                      >★</button>
                      <span className="template-name">{tmpl.name}</span>
                      <button
                        className="btn compact"
                        type="button"
                        onClick={() => {
                          const cfg = tmpl.config || {};
                          const keys = ['themeId','accentColor','titleBgColor','titleFgColor','panelBgColor','panelFgColor','logo','logoScale','mode'];
                          const patch = Object.fromEntries(keys.filter(k => cfg[k] !== undefined).map(k => [k, cfg[k]]));
                          if (cfg.fonts) patch.fonts = { ...project.layout.fonts, ...cfg.fonts };
                          if (Object.keys(patch).length) updateLayout(patch);
                          setUploadStatus({ type: 'success', message: `Applied template "${tmpl.name}".` });
                        }}
                      >Apply</button>
                      <button
                        className="secondary-btn compact"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Delete template "${tmpl.name}"?`)) return;
                          try {
                            await deleteTemplate(tmpl.id);
                            const updated = await listTemplates();
                            setCloudTemplates(updated);
                          } catch (err) {
                            setUploadStatus({ type: 'error', message: err.message });
                          }
                        }}
                      >✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="control-section cs-collapsible">
          <h2 className="section-toggle-btn" onClick={() => toggleSection('elements')}>Elements <span className={`section-chevron${collapsedSections.elements ? '' : ' open'}`}>›</span></h2>
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
            <div className="corner-pickers">
              {[
                { label: 'Title',       key: 'titleCorner',      def: 'tl' },
                { label: 'Logo',        key: 'logoCorner',       def: 'tl' },
                { label: 'Inset',       key: 'insetCorner',      def: 'tr' },
                { label: 'Legend',      key: 'legendCorner',     def: 'bl' },
                { label: 'Scale bar',   key: 'scaleBarCorner',   def: 'bl' },
                { label: 'North arrow', key: 'northArrowCorner', def: 'br' },
              ].map(({ label, key, def }) => (
                <div key={key} className="corner-picker-row">
                  <span className="corner-picker-label">{label}</span>
                  <div className="corner-picker">
                    {['tl', 'tr', 'bl', 'br'].map((c) => (
                      <button key={c} type="button" className={`corner-btn corner-btn-${c}${(project.layout[key] || def) === c ? ' active' : ''}`} title={{ tl: 'Top Left', tr: 'Top Right', bl: 'Bottom Left', br: 'Bottom Right' }[c]} onClick={() => updateLayout({ [key]: c })} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <input ref={insetInputRef} type="file" accept="image/*" onChange={handleInsetImageChange} hidden />
          </div>}
        </section>

        <section className="control-section cs-collapsible">
          <h2 className="section-toggle-btn" onClick={() => toggleSection('refoverlays')}>Reference Overlays <span className={`section-chevron${collapsedSections.refoverlays ? '' : ' open'}`}>›</span></h2>
          {!collapsedSections.refoverlays && <div className="toggle-grid">
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.context} onChange={(e) => updateLayout({ referenceOverlays: { context: e.target.checked } })} /> <span>Roads / Water / Towns</span></label>
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.labels} onChange={(e) => updateLayout({ referenceOverlays: { labels: e.target.checked } })} /> <span>Reference Labels</span></label>
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.rail} onChange={(e) => updateLayout({ referenceOverlays: { rail: e.target.checked } })} /> <span>Railways</span></label>
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
              <button className="topbar-btn" type="button" aria-label="Zoom out" onClick={() => leafletMapRef.current?.zoomOut(1)}>−</button>
              <button className="topbar-btn" type="button" aria-label="Zoom in" onClick={() => leafletMapRef.current?.zoomIn(1)}>+</button>
            </div>
            <div className="topbar-divider" />
            <button className="help-icon-btn" type="button" title="How to use Exploration Maps" onClick={() => setShowHelpModal(true)}>?</button>
            <div className="topbar-btn-group">
              <button className={`topbar-btn primary${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('png'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting} title={!mapReady ? 'Map is initializing…' : ''}>{exporting ? 'Exporting…' : 'PNG'}</button>
              <button className={`topbar-btn${exporting ? ' loading' : !mapReady ? ' initializing' : ''}`} type="button" onClick={() => { try { handleExportClick('svg'); } catch (err) { setExportError(`Export failed: ${err.message}`); } }} disabled={!mapReady || exporting}>SVG</button>
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
            style={{
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
            }}
          >
        <MapCanvas onReady={onMapReady} project={project} template={template} onFeatureClick={handleFeatureClick} onMapClick={handleMapClick} annotationToolRef={annotationToolRef} />
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

        <div className="template-zone" style={zoneStyle(resolvedZones.title)}>
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
              <h2 style={{ cursor: 'text' }} title="Click to edit" onClick={() => setEditingTitleField('title')}>{project.layout.title}</h2>
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
              <p style={{ cursor: 'text' }} title="Click to edit" onClick={() => setEditingTitleField('subtitle')}>{project.layout.subtitle}</p>
            )}
          </div>
          <div
            className="panel-resize-handle panel-resize-handle--bottom"
            title="Drag to resize title height"
            onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              const map = leafletMapRef.current;
              if (map) map.dragging.disable();
              const startY = e.clientY;
              const startH = project.layout.titleHeightPx ?? 92;
              const onMove = (me) => {
                const h = Math.max(60, Math.min(180, Math.round(startH + me.clientY - startY)));
                setProject((p) => ({ ...p, layout: { ...p.layout, titleHeightPx: h } }));
              };
              const onUp = () => {
                if (map) map.dragging.enable();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
          <div
            className="panel-resize-handle panel-resize-handle--right"
            title="Drag to resize title width"
            onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              const map = leafletMapRef.current;
              if (map) map.dragging.disable();
              const startX = e.clientX;
              const startW = project.layout.titleWidthPx ?? 520;
              const onMove = (me) => {
                const w = Math.max(300, Math.min(800, Math.round(startW + me.clientX - startX)));
                setProject((p) => ({ ...p, layout: { ...p.layout, titleWidthPx: w } }));
              };
              const onUp = () => {
                if (map) map.dragging.enable();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
          <div
            className="panel-resize-handle panel-resize-handle--corner"
            title="Drag corner to resize title width and height"
            onMouseDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              const map = leafletMapRef.current;
              if (map) map.dragging.disable();
              const startX = e.clientX; const startY = e.clientY;
              const startW = project.layout.titleWidthPx ?? 520;
              const startH = project.layout.titleHeightPx ?? 92;
              const onMove = (me) => {
                const w = Math.max(300, Math.min(800, Math.round(startW + me.clientX - startX)));
                const h = Math.max(60, Math.min(180, Math.round(startH + me.clientY - startY)));
                setProject((p) => ({ ...p, layout: { ...p.layout, titleWidthPx: w, titleHeightPx: h } }));
              };
              const onUp = () => {
                if (map) map.dragging.enable();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
        </div>

        {legendItems.length ? (
          <div className="template-zone" style={zoneStyle(resolvedZones.legend)}>
            <div className={`template-card legend-card${project.layout.legendTransparent ? ' panel--transparent' : ''}`}>
              <div className="legend-header"><h3>Legend</h3></div>
              <div className="legend-list">
                {legendGroups.map((group) => (
                  <div key={group.heading || 'all'} className="legend-group">
                    {group.heading ? <div className="legend-group-title">{group.heading}</div> : null}
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        className="legend-item legend-item-clickable"
                        onClick={() => { setSelectedLayerId(item.id); }}
                      >
                        {item.type === 'points' ? (
                          <span className="legend-point" style={{ borderColor: item.style.markerColor || '#111', background: item.style.markerFill || '#fff' }} />
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
            <div
              className="panel-resize-handle panel-resize-handle--right"
              title="Drag to resize legend width"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const map = leafletMapRef.current;
                if (map) map.dragging.disable();
                const startX = e.clientX;
                const startW = project.layout.legendWidthPx ?? 300;
                const onMove = (me) => {
                  const w = Math.max(180, Math.min(480, Math.round(startW + me.clientX - startX)));
                  setProject((p) => ({ ...p, layout: { ...p.layout, legendWidthPx: w } }));
                };
                const onUp = () => {
                  if (map) map.dragging.enable();
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div
              className="panel-resize-handle panel-resize-handle--bottom"
              title="Drag to resize legend height"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const map = leafletMapRef.current;
                if (map) map.dragging.disable();
                const startY = e.clientY;
                const startH = project.layout.legendHeightPx ?? resolvedZones.legend?.height ?? 168;
                const onMove = (me) => {
                  const h = Math.max(60, Math.min(500, Math.round(startH + me.clientY - startY)));
                  setProject((p) => ({ ...p, layout: { ...p.layout, legendHeightPx: h } }));
                };
                const onUp = () => {
                  if (map) map.dragging.enable();
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div
              className="panel-resize-handle panel-resize-handle--corner"
              title="Drag corner to resize legend width and height"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const map = leafletMapRef.current;
                if (map) map.dragging.disable();
                const startX = e.clientX; const startY = e.clientY;
                const startW = project.layout.legendWidthPx ?? 300;
                const startH = project.layout.legendHeightPx ?? resolvedZones.legend?.height ?? 168;
                const onMove = (me) => {
                  const w = Math.max(180, Math.min(480, Math.round(startW + me.clientX - startX)));
                  const h = Math.max(60, Math.min(500, Math.round(startH + me.clientY - startY)));
                  setProject((p) => ({ ...p, layout: { ...p.layout, legendWidthPx: w, legendHeightPx: h } }));
                };
                const onUp = () => {
                  if (map) map.dragging.enable();
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
          </div>
        ) : null}

        {project.layout.showNorthArrow !== false && <div className="template-zone" style={zoneStyle(resolvedZones.northArrow)}><NorthArrow /></div>}
        {project.layout.insetEnabled !== false && resolvedZones.inset?.width ? (
          <div className="template-zone" style={zoneStyle(resolvedZones.inset)}>
            <LocatorInset layers={project.layers} insetMode={project.layout.insetMode} insetImage={project.layout.insetImage} autoInsetRegion={project.layout.autoInsetRegion} insetTitle={project.layout.insetTitle} insetLabel={project.layout.insetLabel} mode={project.layout.mode} zone={{ width: '100%', height: '100%' }} />
            <div className="panel-resize-handle panel-resize-handle--right" title="Drag to resize inset width" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startX = e.clientX; const startW = project.layout.insetWidthPx ?? 244; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, insetWidthPx: Math.max(100, Math.min(600, Math.round(startW + me.clientX - startX))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
            <div className="panel-resize-handle panel-resize-handle--bottom" title="Drag to resize inset height" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startY = e.clientY; const startH = project.layout.insetHeightPx ?? 190; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, insetHeightPx: Math.max(80, Math.min(500, Math.round(startH + me.clientY - startY))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
            <div className="panel-resize-handle panel-resize-handle--corner" title="Drag corner to resize inset" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startX = e.clientX; const startY = e.clientY; const startW = project.layout.insetWidthPx ?? 244; const startH = project.layout.insetHeightPx ?? 190; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, insetWidthPx: Math.max(100, Math.min(600, Math.round(startW + me.clientX - startX))), insetHeightPx: Math.max(80, Math.min(500, Math.round(startH + me.clientY - startY))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
          </div>
        ) : null}
        {project.layout.showScaleBar !== false && <div className="template-zone" style={zoneStyle(resolvedZones.scaleBar)}><ScaleBar map={leafletMapRef.current} /></div>}
        {project.layout.footerText && project.layout.footerEnabled !== false ? <div className="template-zone" style={zoneStyle(resolvedZones.footer)}><div className="template-card footer-card">{project.layout.footerText}</div></div> : null}
        {project.layout.logo ? (
          <div className="template-zone" style={zoneStyle(resolvedZones.logo)}>
            <div className={`template-card logo-card${project.layout.logoTransparent ? ' panel--transparent' : ''}`}><img src={project.layout.logo} alt="Logo" /></div>
            <div className="panel-resize-handle panel-resize-handle--right" title="Drag to resize logo width" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startX = e.clientX; const startW = project.layout.logoWidthPx ?? 168; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, logoWidthPx: Math.max(40, Math.min(400, Math.round(startW + me.clientX - startX))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
            <div className="panel-resize-handle panel-resize-handle--bottom" title="Drag to resize logo height" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startY = e.clientY; const startH = project.layout.logoHeightPx ?? 74; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, logoHeightPx: Math.max(20, Math.min(300, Math.round(startH + me.clientY - startY))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
            <div className="panel-resize-handle panel-resize-handle--corner" title="Drag corner to resize logo" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const map = leafletMapRef.current; if (map) map.dragging.disable(); const startX = e.clientX; const startY = e.clientY; const startW = project.layout.logoWidthPx ?? 168; const startH = project.layout.logoHeightPx ?? 74; const onMove = (me) => { setProject((p) => ({ ...p, layout: { ...p.layout, logoWidthPx: Math.max(40, Math.min(400, Math.round(startW + me.clientX - startX))), logoHeightPx: Math.max(20, Math.min(300, Math.round(startH + me.clientY - startY))) } })); }; const onUp = () => { if (map) map.dragging.enable(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); }} />
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
            <button className="btn primary" style={{ width: '100%' }} type="button" onClick={addCalloutFromSelectedFeature}>Add Callout</button>
          </div>
        ) : null}
          </div>
        </div>
      </div>
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
    </div>
  );
}
