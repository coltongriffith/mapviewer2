import React, { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './components/MapCanvas';
import Sidebar from './components/Sidebar';
import LayerList from './components/LayerList';
import LocatorInset from './components/LocatorInset';
import CalloutsOverlay from './components/CalloutsOverlay';
import LandingPage from './components/LandingPage';
import UploadPanel from './components/UploadPanel';
import AnnotationOverlay from './components/AnnotationOverlay';
import { loadGeoJSON } from './utils/importers';
import { buildScene } from './export/buildScene';
import { exportPNG } from './export/exportPNG';
import { exportSVG } from './export/exportSVG';
import {
  CALLOUT_TYPES,
  COMPOSITION_PRESETS,
  createInitialProjectState,
  FONT_OPTIONS,
  INSET_MODES,
  ROLE_LABELS,
  TEMPLATE_MODES,
  TEMPLATE_THEMES,
} from './projectState';
import { applyRoleToLayer, inferRoleFromLayer } from './mapPresets';
import { getTemplate } from './templates';
import { buildLegendItems, resolveTemplateZones } from './templates/technicalResultsTemplate';
import { geojsonCenter } from './utils/geometry';
import { cleanLayerName } from './utils/cleanLayerName';
import { fitProjectToTemplate } from './utils/frameMapForTemplate';
import { getThemeTokens } from './utils/themeTokens';

const MARKER_TYPES = {
  circle: 'Circle',
  square: 'Square',
  triangle: 'Triangle',
  pickaxe: 'Pickaxe',
  shovel: 'Shovel',
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
      visible: layer.userStyled ? layer.visible : (preset.visibleRoles ? (preset.visibleRoles.includes(layer.role) || layer.role === 'drillholes') : layer.visible),
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
  return layer?.type === 'points' || layer?.role === 'drillholes';
}

function selectValue(options, value, fallback = 'Inter') {
  return options[value] ? value : fallback;
}

export default function App() {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const logoInputRef = useRef(null);
  const insetInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const [screen, setScreen] = useState('landing');
  const [project, setProject] = useState(() => {
    const base = createInitialProjectState();
    return {
      ...base,
      layout: {
        ...base.layout,
        title: 'Project Map',
        subtitle: 'Claims, drillholes, and targets',
      },
    };
  });
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectedCalloutId, setSelectedCalloutId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  const [selectedEllipseId, setSelectedEllipseId] = useState(null);
  const [annotationTool, setAnnotationTool] = useState(null);
  const [uploadStatus, setUploadStatus] = useState({ type: 'info', message: 'Open the editor, then upload your first file from the left panel.' });
  const [exporting, setExporting] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 1600, height: 1000 });

  const template = useMemo(() => getTemplate(project.layout?.templateId || 'technical_results_v2'), [project.layout?.templateId]);
  const selectedLayer = useMemo(() => project.layers.find((layer) => layer.id === selectedLayerId) || null, [project.layers, selectedLayerId]);
  const selectedCallout = useMemo(() => project.callouts.find((callout) => callout.id === selectedCalloutId) || null, [project.callouts, selectedCalloutId]);
  const selectedMarker = useMemo(() => project.markers?.find((marker) => marker.id === selectedMarkerId) || null, [project.markers, selectedMarkerId]);
  const selectedEllipse = useMemo(() => project.ellipses?.find((ellipse) => ellipse.id === selectedEllipseId) || null, [project.ellipses, selectedEllipseId]);
  const resolvedZones = useMemo(() => resolveTemplateZones(template, project.layout, mapSize), [template, project.layout, mapSize]);
  const legendItems = useMemo(() => buildLegendItems(template, project.layers, project.layout), [template, project.layers, project.layout]);
  const legendGroups = useMemo(() => renderLegendGroups(legendItems, project.layout), [legendItems, project.layout]);
  const themeTokens = useMemo(() => getThemeTokens(project.layout?.themeId || 'modern_rounded'), [project.layout?.themeId]);

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
    const map = leafletMapRef.current;
    if (!map || project.layers.length === 0) return;
    fitProjectToTemplate(
      project,
      map,
      { ...template, zones: resolvedZones },
      project.layout.compositionPreset || template.modePresets?.[project.layout.mode]?.framing || 'balanced'
    );
    const zoomPct = Number(project.layout.zoomPercent || 100);
    const delta = Math.log2(Math.max(1, zoomPct) / 100);
    map.setZoom(map.getZoom() + delta, { animate: false });
  }, [template, resolvedZones, project.layout.frameVersion, project.layout.primaryLayerId, project.layout.compositionPreset, project.layout.zoomPercent, project.layers]);

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
        legendItems,
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

  const onMapReady = (map) => {
    leafletMapRef.current = map;
  };

  const addGeoJSONLayer = async (file) => {
    const geojson = await loadGeoJSON(file);
    const id = crypto.randomUUID();
    const baseName = file.name.replace(/\.(zip|geojson|json)$/i, '') || 'Layer';
    const kind = detectLayerKind(geojson);
    const role = inferRoleFromLayer({ name: baseName, type: kind });
    const displayName = cleanLayerName(baseName, role);

    const nextLayer = applyRoleToLayer(
      {
        id,
        name: baseName,
        sourceName: file.name,
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
      role
    );

    setProject((prev) => {
      const next = {
        ...prev,
        layers: [...prev.layers, nextLayer],
        layout: {
          ...prev.layout,
          primaryLayerId: prev.layout.primaryLayerId || id,
          frameVersion: (prev.layout.frameVersion || 0) + 1,
        },
      };
      return applyModeToProject(next, template, prev.layout.mode);
    });
    setSelectedLayerId(id);
    setUploadStatus({ type: 'success', message: `Imported ${file.name}. ${kind === 'points' ? 'Point layer detected and kept visible for editing.' : 'Layer added successfully.'}` });
  };

  const handleUploadFile = async (file) => {
    try {
      await addGeoJSONLayer(file);
      if (screen !== 'editor') setScreen('editor');
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Import failed: ${err.message}` });
    }
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      updateLayout({ logo: dataUrl });
      setUploadStatus({ type: 'success', message: `Loaded logo: ${file.name}` });
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Logo import failed: ${err.message}` });
    } finally {
      e.target.value = '';
    }
  };

  const handleInsetImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      updateLayout({ insetImage: dataUrl, insetMode: 'custom_image', insetEnabled: true });
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
        titleWidth: prev.layout.title?.length > 26 ? 'wide' : 'standard',
        referenceOpacity: 0.72,
        insetEnabled: true,
        zoomPercent: 100,
        frameVersion: (prev.layout.frameVersion || 0) + 1,
      },
      callouts: prev.callouts.map((callout, idx) => ({
        ...callout,
        priority: idx < 2 ? 1 : 2,
        offset: callout.offset || { x: 20, y: -18 },
      })),
    }));
    setUploadStatus({ type: 'success', message: 'Applied cleaner spacing and layout defaults.' });
  };

  const addCalloutAtAnchor = ({ text, type = 'leader', anchor, featureId, layerId }) => {
    const calloutId = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      callouts: [
        ...prev.callouts,
        {
          id: calloutId,
          text,
          type,
          priority: 2,
          anchor,
          offset: { x: 20, y: -18 },
          featureId: featureId || null,
          layerId: layerId || null,
        },
      ],
    }));
    setSelectedCalloutId(calloutId);
  };

  const addCalloutFromSelectedLayer = () => {
    if (!selectedLayer?.geojson) return;
    const center = geojsonCenter(selectedLayer.geojson);
    if (!center) return;
    addCalloutAtAnchor({
      text: selectedLayer.displayName || selectedLayer.legend?.label || selectedLayer.name,
      type: selectedLayer.role === 'drillholes' ? 'leader' : 'boxed',
      anchor: { lat: center.lat, lng: center.lng },
      layerId: selectedLayer.id,
    });
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

  const handleFeatureClick = ({ layerId, feature, latlng }) => {
    const layer = project.layers.find((item) => item.id === layerId) || null;
    if (!layer) return;
    setSelectedLayerId(layerId);
    setSelectedMarkerId(null);
    setSelectedEllipseId(null);
    setSelectedFeature({
      layerId,
      layerName: layer.displayName || layer.name,
      role: layer.role,
      feature,
      latlng: { lat: latlng.lat, lng: latlng.lng },
      featureId: feature?.id || feature?.properties?.id || `${layerId}:${latlng.lat.toFixed(6)}:${latlng.lng.toFixed(6)}`,
      suggestedLabel: getFeatureLabel(feature, layer),
    });
  };

  const addCalloutFromSelectedFeature = () => {
    if (!selectedFeature?.latlng) return;
    addCalloutAtAnchor({
      text: selectedFeature.suggestedLabel,
      type: 'leader',
      anchor: selectedFeature.latlng,
      featureId: selectedFeature.featureId,
      layerId: selectedFeature.layerId,
    });
  };

  const addMarkerAt = (latlng) => {
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      markers: [
        ...(prev.markers || []),
        { id, lat: latlng.lat, lng: latlng.lng, type: 'circle', color: '#d97706', size: 18, label: '' },
      ],
    }));
    setSelectedMarkerId(id);
    setSelectedEllipseId(null);
    setSelectedCalloutId(null);
  };

  const addEllipseAt = (latlng) => {
    const id = crypto.randomUUID();
    setProject((prev) => ({
      ...prev,
      ellipses: [
        ...(prev.ellipses || []),
        { id, lat: latlng.lat, lng: latlng.lng, width: 90, height: 56, rotation: -18, color: '#dc2626', dashed: true, label: '' },
      ],
    }));
    setSelectedEllipseId(id);
    setSelectedMarkerId(null);
    setSelectedCalloutId(null);
  };

  const handleMapClick = (latlng) => {
    if (annotationTool === 'marker') {
      addMarkerAt(latlng);
      setAnnotationTool(null);
    } else if (annotationTool === 'ellipse') {
      addEllipseAt(latlng);
      setAnnotationTool(null);
    }
  };

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

  const handleExport = async (format) => {
    if (!leafletMapRef.current || !mapContainerRef.current || exporting) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, { ...project, layout: { ...project.layout, legendItems } }, leafletMapRef.current);
      if (format === 'png') {
        await exportPNG(scene, project.layout?.exportSettings || {});
      } else {
        await exportSVG(scene, project.layout?.exportSettings || {});
      }
    } catch (err) {
      setUploadStatus({ type: 'error', message: `Export failed: ${err.message}` });
    } finally {
      setExporting(false);
    }
  };

  const referenceOverlays = project.layout.referenceOverlays || {};

  if (screen === 'landing') {
    return <LandingPage onOpenEditor={() => setScreen('editor')} />;
  }

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-header-row">
          <div>
            <h1>Mapviewer</h1>
            <p className="sidebar-subtitle">Upload on the left, design in the center, export when ready.</p>
          </div>
          <button className="secondary-btn compact" type="button" onClick={() => setScreen('landing')}>
            Home
          </button>
        </div>

        <UploadPanel onUploadFile={handleUploadFile} inputRef={uploadInputRef} status={uploadStatus} layers={project.layers} />

        <section className="control-section">
          <h2>Template</h2>
          <div className="control-grid">
            <div className="control-row">
              <label>Mode</label>
              <select value={project.layout.mode} onChange={(e) => applyMode(e.target.value)}>
                {Object.entries(TEMPLATE_MODES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="control-row inline-2">
              <div>
                <label>Design Theme</label>
                <select value={project.layout.themeId || 'modern_rounded'} onChange={(e) => updateLayout({ themeId: e.target.value })}>
                  {Object.entries(TEMPLATE_THEMES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Composition</label>
                <select value={project.layout.compositionPreset} onChange={(e) => updateLayout({ compositionPreset: e.target.value, frameVersion: (project.layout.frameVersion || 0) + 1 })}>
                  {Object.entries(COMPOSITION_PRESETS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="button-row">
              <button className="btn" type="button" onClick={autoFrameAll}>Refit Map</button>
              <button className="btn primary" type="button" onClick={improveMap}>Improve Map</button>
            </div>
          </div>
        </section>

        <section className="control-section">
          <h2>Map Content</h2>
          <div className="control-grid">
            <div className="control-row"><label>Title</label><input value={project.layout.title} onChange={(e) => updateLayout({ title: e.target.value })} /></div>
            <div className="control-row"><label>Subtitle</label><input value={project.layout.subtitle} onChange={(e) => updateLayout({ subtitle: e.target.value })} /></div>
            <div className="control-row inline-2">
              <div>
                <label>Basemap</label>
                <select value={project.layout.basemap} onChange={(e) => updateLayout({ basemap: e.target.value })}>
                  <option value="light">Light</option>
                  <option value="satellite">Satellite</option>
                  <option value="topo">Topo</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div>
                <label>Inset Mode</label>
                <select value={project.layout.insetMode} onChange={(e) => updateLayout({ insetMode: e.target.value, insetEnabled: true })}>
                  {Object.entries(INSET_MODES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="control-row inline-2">
              <div>
                <label>Zoom</label>
                <input type="range" min="50" max="200" step="1" value={project.layout.zoomPercent || 100} onChange={(e) => updateLayout({ zoomPercent: Number(e.target.value), frameVersion: (project.layout.frameVersion || 0) + 1 })} />
              </div>
              <div>
                <label>Zoom %</label>
                <input type="number" min="50" max="200" step="1" value={project.layout.zoomPercent || 100} onChange={(e) => updateLayout({ zoomPercent: Number(e.target.value || 100), frameVersion: (project.layout.frameVersion || 0) + 1 })} />
              </div>
            </div>
            <div className="control-row inline-2">
              <div>
                <label>Title Font</label>
                <select value={selectValue(FONT_OPTIONS, project.layout.fonts?.title)} onChange={(e) => updateLayout({ fonts: { title: e.target.value } })}>
                  {Object.entries(FONT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label>Legend Font</label>
                <select value={selectValue(FONT_OPTIONS, project.layout.fonts?.legend)} onChange={(e) => updateLayout({ fonts: { legend: e.target.value } })}>
                  {Object.entries(FONT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="control-row inline-2">
              <div>
                <label>Label Font</label>
                <select value={selectValue(FONT_OPTIONS, project.layout.fonts?.label)} onChange={(e) => updateLayout({ fonts: { label: e.target.value } })}>
                  {Object.entries(FONT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label>Callout Font</label>
                <select value={selectValue(FONT_OPTIONS, project.layout.fonts?.callout)} onChange={(e) => updateLayout({ fonts: { callout: e.target.value } })}>
                  {Object.entries(FONT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
            <div className="control-row"><label>Footer / Source Note</label><input value={project.layout.footerText || ''} onChange={(e) => updateLayout({ footerText: e.target.value })} /></div>
            <div className="button-row three">
              <button className="btn" type="button" onClick={() => logoInputRef.current?.click()}>Upload Logo</button>
              <button className="btn" type="button" onClick={() => insetInputRef.current?.click()}>Upload Inset</button>
              <button className="btn" type="button" onClick={() => updateLayout({ insetEnabled: project.layout.insetEnabled === false })}>{project.layout.insetEnabled === false ? 'Show Inset' : 'Hide Inset'}</button>
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} hidden />
            <input ref={insetInputRef} type="file" accept="image/*" onChange={handleInsetImageChange} hidden />
            {project.layout.insetMode === 'custom_image' ? (
              <div className="inset-status-card">
                {project.layout.insetImage ? (
                  <>
                    <div className="inset-preview"><img src={project.layout.insetImage} alt="Inset preview" /></div>
                    <div className="small-note">Custom inset is active and anchored in the top-right corner.</div>
                    <button className="secondary-btn" type="button" onClick={() => updateLayout({ insetImage: null })}>Remove Inset Image</button>
                  </>
                ) : (
                  <div className="small-note">Custom inset mode is selected, but no image is loaded yet.</div>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <section className="control-section">
          <h2>Reference Overlays</h2>
          <div className="toggle-grid">
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.context} onChange={(e) => updateLayout({ referenceOverlays: { context: e.target.checked } })} /> <span>Roads / Water / Towns</span></label>
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.labels} onChange={(e) => updateLayout({ referenceOverlays: { labels: e.target.checked } })} /> <span>Reference Labels</span></label>
            <label className="toggle-row"><input type="checkbox" checked={referenceOverlays.rail} onChange={(e) => updateLayout({ referenceOverlays: { rail: e.target.checked } })} /> <span>Railways</span></label>
          </div>
        </section>

        <section className="control-section">
          <h2>Layers</h2>
          <LayerList layers={project.layers} selectedLayerId={selectedLayerId} onSelect={setSelectedLayerId} onToggleVisible={toggleLayerVisible} />
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
                <div className="control-row inline-2">
                  <div>
                    <label>Point Size</label>
                    <input type="range" min="6" max="24" step="1" value={selectedLayer.style?.markerSize ?? 12} onChange={(e) => updateLayer(selectedLayer.id, { style: { markerSize: Number(e.target.value) } })} />
                  </div>
                  <div className="range-value">{selectedLayer.style?.markerSize ?? 12}px</div>
                </div>
              ) : (
                <div className="control-row inline-2">
                  <div>
                    <label>Fill Opacity</label>
                    <input type="range" min="0" max="1" step="0.05" value={selectedLayer.style?.fillOpacity ?? 0.22} onChange={(e) => updateLayer(selectedLayer.id, { style: { fillOpacity: Number(e.target.value) } })} />
                  </div>
                  <div className="range-value">{Math.round((selectedLayer.style?.fillOpacity ?? 0.22) * 100)}%</div>
                </div>
              )}
            </div>
          ) : <p className="small-note">Select a layer to edit its display label, role, order, and colors.</p>}
        </section>

        <section className="control-section">
          <h2>Markers & Highlight Areas</h2>
          <div className="button-row">
            <button className={`secondary-btn ${annotationTool === 'marker' ? 'active-toggle' : ''}`} type="button" onClick={() => setAnnotationTool(annotationTool === 'marker' ? null : 'marker')}>Place Marker</button>
            <button className={`secondary-btn ${annotationTool === 'ellipse' ? 'active-toggle' : ''}`} type="button" onClick={() => setAnnotationTool(annotationTool === 'ellipse' ? null : 'ellipse')}>Draw Dashed Area</button>
          </div>
          <div className="small-note" style={{ marginTop: 8 }}>{annotationTool ? 'Click anywhere on the map to place the selected annotation.' : 'Add highlight markers or dashed ellipses anywhere on the map.'}</div>

          {selectedMarker ? (
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
              <div className="selected-note">Selected highlight area</div>
              <div className="control-row"><label>Label</label><input value={selectedEllipse.label || ''} onChange={(e) => updateEllipse(selectedEllipse.id, { label: e.target.value })} /></div>
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
              <label className="toggle-row"><input type="checkbox" checked={selectedEllipse.dashed !== false} onChange={(e) => updateEllipse(selectedEllipse.id, { dashed: e.target.checked })} /> <span>Dashed outline</span></label>
              <button className="secondary-btn" type="button" onClick={() => removeEllipse(selectedEllipse.id)}>Remove Highlight Area</button>
            </div>
          ) : null}
        </section>

        <section className="control-section">
          <h2>Drillhole Label Tool</h2>
          {selectedFeature ? (
            <div className="control-grid">
              <div className="feature-chip">Selected: {selectedFeature.layerName}</div>
              <div className="control-row">
                <label>Label Text</label>
                <input value={selectedFeature.suggestedLabel} onChange={(e) => setSelectedFeature((prev) => ({ ...prev, suggestedLabel: e.target.value }))} />
              </div>
              <div className="small-note">Click a drillhole on the map, edit the label, then add the callout. It will appear immediately in the editor and in export.</div>
              <button className="btn primary" type="button" onClick={addCalloutFromSelectedFeature}>Add Callout From Clicked Drillhole</button>
            </div>
          ) : (
            <div className="small-note">Click a drillhole point on the map to prepare a callout.</div>
          )}
        </section>

        <section className="control-section">
          <h2>Callouts</h2>
          <div className="button-row" style={{ marginBottom: 10 }}>
            <button className="btn primary" type="button" onClick={addCalloutFromSelectedLayer} disabled={!selectedLayer}>Add From Selected Layer</button>
            <button className="btn" type="button" onClick={autoFrameAll}>Auto Frame All</button>
          </div>
          {selectedCallout ? <div className="selected-note">Selected callout: {selectedCallout.text}</div> : null}
          <div className="callout-list">
            {project.callouts.map((callout, index) => (
              <div key={callout.id} className={`callout-card ${selectedCalloutId === callout.id ? 'active' : ''}`}>
                <div className="callout-card-header">
                  <span>Callout {index + 1}</span>
                  <div className="callout-card-actions">
                    <button className="secondary-btn" type="button" onClick={() => setSelectedCalloutId(callout.id)}>Select</button>
                    <button className="secondary-btn" type="button" onClick={() => removeCallout(callout.id)}>Remove</button>
                  </div>
                </div>
                <div className="control-grid">
                  <div className="control-row"><label>Text</label><input value={callout.text} onChange={(e) => updateCallout(callout.id, { text: e.target.value })} /></div>
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
              </div>
            ))}
          </div>
        </section>

        <section className="control-section">
          <h2>Export</h2>
          <div className="control-grid">
            <div className="control-row inline-2">
              <div>
                <label>Filename</label>
                <input value={project.layout.exportSettings.filename} onChange={(e) => updateLayout({ exportSettings: { filename: e.target.value } })} />
              </div>
              <div>
                <label>Scale</label>
                <select value={project.layout.exportSettings.pixelRatio} onChange={(e) => updateLayout({ exportSettings: { pixelRatio: Number(e.target.value) } })}>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={3}>3x</option>
                </select>
              </div>
            </div>
            <div className="button-row">
              <button className="btn primary" type="button" onClick={() => handleExport('png')} disabled={exporting}>Export PNG</button>
              <button className="btn" type="button" onClick={() => handleExport('svg')} disabled={exporting}>Export SVG</button>
            </div>
          </div>
        </section>
      </Sidebar>

      <div
        ref={mapContainerRef}
        className="map-stage"
        data-theme={project.layout.themeId || 'modern_rounded'}
        style={{
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
        <MapCanvas onReady={onMapReady} project={project} template={template} onFeatureClick={handleFeatureClick} onMapClick={handleMapClick} />
        <AnnotationOverlay
          map={leafletMapRef.current}
          markers={project.markers || []}
          ellipses={project.ellipses || []}
          selectedMarkerId={selectedMarkerId}
          selectedEllipseId={selectedEllipseId}
          onSelectMarker={(id) => { setSelectedMarkerId(id); setSelectedEllipseId(null); }}
          onSelectEllipse={(id) => { setSelectedEllipseId(id); setSelectedMarkerId(null); }}
          onMoveMarker={updateMarker}
          onMoveEllipse={updateEllipse}
          labelFont={project.layout.fonts?.label}
        />
        <CalloutsOverlay
          map={leafletMapRef.current}
          callouts={project.callouts}
          selectedCalloutId={selectedCalloutId}
          onSelect={setSelectedCalloutId}
          onMove={(id, offset) => updateCallout(id, { offset: { x: offset.x, y: offset.y }, isManualPosition: true })}
          fontFamily={project.layout.fonts?.callout}
        />

        <div className="template-zone" style={zoneStyle(resolvedZones.title)}>
          <div className="template-card title-card">
            <h2>{project.layout.title}</h2>
            <p>{project.layout.subtitle}</p>
          </div>
        </div>

        {legendItems.length ? (
          <div className="template-zone" style={zoneStyle(resolvedZones.legend)}>
            <div className="template-card legend-card">
              <div className="legend-header"><h3>Legend</h3></div>
              <div className="legend-list">
                {legendGroups.map((group) => (
                  <div key={group.heading || 'all'} className="legend-group">
                    {group.heading ? <div className="legend-group-title">{group.heading}</div> : null}
                    {group.items.map((item) => (
                      <div key={item.id} className="legend-item">
                        {item.type === 'points' ? (
                          <span className="legend-point" style={{ borderColor: item.style.markerColor || '#111', background: item.style.markerFill || '#fff' }} />
                        ) : (
                          <span className="legend-swatch" style={{ borderColor: item.style.stroke || '#3b82f6', background: item.style.fill || '#93c5fd', opacity: item.style.fillOpacity ?? 1 }} />
                        )}
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="template-zone" style={zoneStyle(resolvedZones.northArrow)}><NorthArrow /></div>
        {project.layout.insetEnabled !== false && resolvedZones.inset?.width ? (
          <div className="template-zone" style={zoneStyle(resolvedZones.inset)}>
            <LocatorInset layers={project.layers} insetMode={project.layout.insetMode} insetImage={project.layout.insetImage} mode={project.layout.mode} zone={{ width: '100%', height: '100%' }} />
          </div>
        ) : null}
        <div className="template-zone" style={zoneStyle(resolvedZones.scaleBar)}><ScaleBar map={leafletMapRef.current} /></div>
        {project.layout.footerText && project.layout.footerEnabled !== false ? <div className="template-zone" style={zoneStyle(resolvedZones.footer)}><div className="template-card footer-card">{project.layout.footerText}</div></div> : null}
        {project.layout.logo ? <div className="template-zone" style={zoneStyle(resolvedZones.logo)}><div className="template-card logo-card"><img src={project.layout.logo} alt="Logo" /></div></div> : null}
      </div>
    </div>
  );
}
