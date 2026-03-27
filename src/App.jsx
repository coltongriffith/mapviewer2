import React, { useEffect, useMemo, useRef, useState } from 'react';
import MapCanvas from './components/MapCanvas';
import Sidebar from './components/Sidebar';
import LayerList from './components/LayerList';
import LocatorInset from './components/LocatorInset';
import CalloutsOverlay from './components/CalloutsOverlay';
import { loadGeoJSON } from './utils/importers';
import { buildScene } from './export/buildScene';
import { exportPNG } from './export/exportPNG';
import { exportSVG } from './export/exportSVG';
import {
  CALLOUT_TYPES,
  createInitialProjectState,
  INSET_MODES,
  ROLE_LABELS,
  TEMPLATE_MODES,
} from './projectState';
import { applyRoleToLayer, inferRoleFromLayer } from './mapPresets';
import { getTemplate } from './templates';
import { buildLegendItems } from './templates/technicalResultsTemplate';
import { geojsonCenter } from './utils/geometry';
import { cleanLayerName } from './utils/cleanLayerName';
import { fitProjectToTemplate } from './utils/frameMapForTemplate';

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
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function zoneStyle(zone) {
  if (!zone) return {};
  return {
    position: 'absolute',
    top: zone.top,
    left: zone.left,
    width: zone.width,
    height: zone.height,
    zIndex: 400,
  };
}

function resolveZone(zone, width, height) {
  if (!zone) return null;
  const next = { ...zone };
  if (next.right != null && next.left == null && next.width != null) next.left = width - next.right - next.width;
  if (next.bottom != null && next.top == null && next.height != null) next.top = height - next.bottom - next.height;
  return next;
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
          width: Math.max(70, Math.min(180, Math.round((130 * nice) / meters))),
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
      visible: preset.visibleRoles ? preset.visibleRoles.includes(layer.role) : layer.visible,
    })),
    layout: {
      ...project.layout,
      mode,
      basemap: preset.basemap || project.layout.basemap,
      insetMode: preset.insetMode || project.layout.insetMode,
      frameVersion: (project.layout.frameVersion || 0) + 1,
    },
  };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const [project, setProject] = useState(() => {
    const base = createInitialProjectState();
    return {
      ...base,
      layout: {
        ...base.layout,
        title: 'Rift Rare Earth Project',
        subtitle: 'SE Nebraska, USA',
      },
    };
  });
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 1600, height: 1000 });

  const template = useMemo(() => getTemplate(project.layout?.templateId || 'technical_results_v2'), [project.layout?.templateId]);
  const selectedLayer = useMemo(() => project.layers.find((layer) => layer.id === selectedLayerId) || null, [project.layers, selectedLayerId]);

  const resolvedZones = useMemo(
    () => Object.fromEntries(Object.entries(template.zones || {}).map(([key, zone]) => [key, resolveZone(zone, mapSize.width, mapSize.height)])),
    [template, mapSize]
  );

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return undefined;
    const update = () => setMapSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        legendItems: buildLegendItems(template, prev.layers),
      },
    }));
  }, [project.layers, template]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    const framingMode = template.modePresets?.[project.layout.mode]?.framing || 'balanced';
    fitProjectToTemplate(project, map, template, framingMode);
  }, [project.layers, project.layout.primaryLayerId, project.layout.mode, project.layout.frameVersion, template]);

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
        exportSettings: patch.exportSettings
          ? { ...(prev.layout?.exportSettings || {}), ...patch.exportSettings }
          : prev.layout?.exportSettings,
      },
    }));
  };

  const updateLayer = (layerId, patch) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) => (layer.id === layerId ? mergeDeep(layer, patch) : layer)),
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
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await addGeoJSONLayer(file);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      updateLayout({ logo: dataUrl });
    } catch (err) {
      alert(`Logo import failed: ${err.message}`);
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
        return applyRoleToLayer({
          ...layer,
          displayName,
          legend: { ...(layer.legend || {}), label: displayName },
        }, role);
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

  const addCalloutFromSelectedLayer = () => {
    if (!selectedLayer?.geojson) return;
    const center = geojsonCenter(selectedLayer.geojson);
    if (!center) return;

    setProject((prev) => ({
      ...prev,
      callouts: [
        ...prev.callouts,
        {
          id: crypto.randomUUID(),
          text: selectedLayer.displayName || selectedLayer.legend?.label || selectedLayer.name,
          type: selectedLayer.role === 'drillholes' ? 'leader' : 'boxed',
          priority: 2,
          anchor: { lat: center.lat, lng: center.lng },
          offset: { x: 22, y: -20 },
        },
      ],
    }));
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
          ? { ...callout, offset: { x: (callout.offset?.x || 0) + dx, y: (callout.offset?.y || 0) + dy } }
          : callout
      ),
    }));
  };

  const removeCallout = (calloutId) => {
    setProject((prev) => ({ ...prev, callouts: prev.callouts.filter((callout) => callout.id !== calloutId) }));
  };

  const handleExport = async (format) => {
    if (!leafletMapRef.current || !mapContainerRef.current || exporting) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      if (format === 'png') {
        await exportPNG(scene, project.layout?.exportSettings || {});
      } else {
        await exportSVG(scene, project.layout?.exportSettings || {});
      }
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar>
        <h1>Mapviewer</h1>
        <p className="sidebar-subtitle">Template-driven geology figure generator</p>

        <section className="control-section">
          <h2>Template</h2>
          <div className="control-grid">
            <div className="control-row">
              <label>Template</label>
              <select value={project.layout.templateId} onChange={(e) => updateLayout({ templateId: e.target.value })}>
                <option value="technical_results_v2">technical_results_v2</option>
              </select>
            </div>
            <div className="control-row">
              <label>Mode</label>
              <select value={project.layout.mode} onChange={(e) => applyMode(e.target.value)}>
                {Object.entries(TEMPLATE_MODES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
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
                <select value={project.layout.insetMode} onChange={(e) => updateLayout({ insetMode: e.target.value })}>
                  {Object.entries(INSET_MODES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="control-row"><label>Footer / Source Note</label><input value={project.layout.footerText || ''} onChange={(e) => updateLayout({ footerText: e.target.value })} /></div>
            <div className="button-row">
              <button className="btn primary" type="button" onClick={() => fileInputRef.current?.click()}>Import Layer</button>
              <button className="btn" type="button" onClick={() => logoInputRef.current?.click()}>Upload Logo</button>
            </div>
            <input ref={fileInputRef} type="file" accept=".zip,.geojson,.json" onChange={handleFileChange} hidden />
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} hidden />
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
            </div>
          ) : <p className="small-note">Select a layer to edit its display label, role, and order.</p>}
        </section>

        <section className="control-section">
          <h2>Callouts</h2>
          <div className="button-row" style={{ marginBottom: 10 }}>
            <button className="btn primary" type="button" onClick={addCalloutFromSelectedLayer} disabled={!selectedLayer}>Add From Selected Layer</button>
            <button className="btn" type="button" onClick={autoFrameAll}>Auto Frame All</button>
          </div>
          <div className="callout-list">
            {project.callouts.map((callout, index) => (
              <div key={callout.id} className="callout-card">
                <div className="callout-card-header">
                  <span>Callout {index + 1}</span>
                  <button className="secondary-btn" type="button" onClick={() => removeCallout(callout.id)}>Remove</button>
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

      <div ref={mapContainerRef} className="map-stage">
        <MapCanvas onReady={onMapReady} project={project} template={template} />
        <CalloutsOverlay map={leafletMapRef.current} callouts={project.callouts} />

        <div className="template-zone" style={zoneStyle(resolvedZones.title)}>
          <div className="template-card title-card">
            <h2>{project.layout.title}</h2>
            <p>{project.layout.subtitle}</p>
          </div>
        </div>

        <div className="template-zone" style={zoneStyle(resolvedZones.legend)}>
          <div className="template-card legend-card">
            <div className="legend-header">
              <h3>Legend</h3>
              <span className="legend-mode-chip">{TEMPLATE_MODES[project.layout.mode]}</span>
            </div>
            <div className="legend-list">
              {(project.layout.legendItems || []).map((item) => (
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
          </div>
        </div>

        <div className="template-zone" style={zoneStyle(resolvedZones.northArrow)}><NorthArrow /></div>
        <div className="template-zone" style={zoneStyle(resolvedZones.inset)}><LocatorInset layers={project.layers} insetMode={project.layout.insetMode} mode={project.layout.mode} zone={{ width: '100%', height: '100%' }} /></div>
        <div className="template-zone" style={zoneStyle(resolvedZones.scaleBar)}><ScaleBar map={leafletMapRef.current} /></div>
        {project.layout.footerText ? <div className="template-zone" style={zoneStyle(resolvedZones.footer)}><div className="template-card footer-card">{project.layout.footerText}</div></div> : null}
        {project.layout.logo ? <div className="template-zone" style={zoneStyle(resolvedZones.logo)}><div className="template-card logo-card"><img src={project.layout.logo} alt="Logo" /></div></div> : null}
      </div>
    </div>
  );
}
