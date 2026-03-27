import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import MapCanvas from "./components/MapCanvas";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import { loadGeoJSON } from "./utils/importers";
import { buildScene } from "./export/buildScene";
import { exportPNG } from "./export/exportPNG";
import { exportSVG } from "./export/exportSVG";
import { createInitialProjectState, ROLE_LABELS } from "./projectState";
import { applyPresetToLayer, LAYER_PRESETS } from "./mapPresets";
import { getTemplate } from "./templates";
import { buildLegendItems } from "./templates/technicalResultsTemplate";

function detectLayerKind(geojson) {
  if (!geojson) return "geojson";

  const features =
    geojson.type === "FeatureCollection"
      ? geojson.features || []
      : geojson.type === "Feature"
        ? [geojson]
        : [];

  const first = features.find((f) => f?.geometry?.type);
  const type = first?.geometry?.type;

  if (type === "Point" || type === "MultiPoint") return "points";
  return "geojson";
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
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function zoneStyle(zone) {
  if (!zone) return {};
  return {
    position: "absolute",
    top: zone.top,
    left: zone.left,
    width: zone.width,
    height: zone.height,
    zIndex: 500,
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
  const [state, setState] = useState({ label: "1 km", width: 130 });

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
        // ignore transient map state
      }
    };

    update();
    map.on("moveend zoomend resize", update);
    return () => map.off("moveend zoomend resize", update);
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
        title: "Project Map",
        subtitle: "Technical results template",
        templateId: "technical_results_v1",
        basemap: "light",
        exportSettings: {
          pixelRatio: 2,
          filename: "mapviewer-export",
        },
      },
    };
  });
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const template = useMemo(
    () => getTemplate(project.layout?.templateId || "technical_results_v1"),
    [project.layout?.templateId]
  );

  const selectedLayer = useMemo(
    () => project.layers.find((layer) => layer.id === selectedLayerId) || null,
    [project.layers, selectedLayerId]
  );

  useEffect(() => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        legendItems: buildLegendItems(template, prev.layers),
      },
    }));
  }, [project.layers, template]);

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

  const removeLayer = (layerId) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.filter((layer) => layer.id !== layerId),
    }));
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
    }
  };

  const onMapReady = (map) => {
    leafletMapRef.current = map;
  };

  const fitLayerBounds = (geojson) => {
    const map = leafletMapRef.current;
    if (!map || !geojson) return;

    try {
      const tmp = L.geoJSON(geojson);
      const bounds = tmp.getBounds?.();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    } catch {
      // ignore bad bounds
    }
  };

  const addGeoJSONLayer = async (file) => {
    const geojson = await loadGeoJSON(file);
    const id = crypto.randomUUID();
    const baseName = file.name.replace(/\.(zip|geojson|json)$/i, "") || "Layer";
    const kind = detectLayerKind(geojson);
    const presetKey = kind === "points" ? "drillhole" : "claim";
    const preset = LAYER_PRESETS[presetKey];

    const rawLayer = {
      id,
      name: baseName,
      type: kind,
      visible: true,
      role: kind === "points" ? "drillholes" : "claims",
      geojson,
      style: { ...(preset?.style || {}) },
      legend: {
        enabled: true,
        label: baseName,
      },
    };

    const nextLayer = applyPresetToLayer(rawLayer, presetKey);
    setProject((prev) => ({
      ...prev,
      layers: [...prev.layers, nextLayer],
    }));
    setSelectedLayerId(id);
    fitLayerBounds(geojson);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await addGeoJSONLayer(file);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      e.target.value = "";
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
      e.target.value = "";
    }
  };

  const handleExport = async (kind) => {
    if (!mapContainerRef.current) return;

    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      if (kind === "png") {
        await exportPNG(scene, project.layout?.exportSettings || {});
      } else {
        await exportSVG(scene, project.layout?.exportSettings || {});
      }
    } catch (err) {
      alert(`${kind.toUpperCase()} export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const resolvedScene = mapContainerRef.current
    ? buildScene(mapContainerRef.current, project, leafletMapRef.current)
    : { template };
  const zones = resolvedScene.template?.zones || template.zones;
  const legendItems = project.layout?.legendItems || [];
  const exportSettings = project.layout?.exportSettings || {};

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-section">
          <div className="sidebar-title">Mapviewer</div>
          <div className="sidebar-subtitle">Template-driven geology map builder</div>
        </div>

        <div className="sidebar-section">
          <label className="field-label">Import GIS</label>
          <button className="btn" onClick={() => fileInputRef.current?.click()}>
            Upload .zip / .geojson / .json
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.geojson,.json,application/json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        <div className="sidebar-section">
          <label className="field-label">Template</label>
          <div className="template-note">Technical Results v1 is locked. Layout elements export exactly where they appear on screen.</div>
        </div>

        <div className="sidebar-section">
          <label className="field-label">Basemap</label>
          <select
            className="text-input"
            value={project.layout?.basemap || "light"}
            onChange={(e) => updateLayout({ basemap: e.target.value })}
          >
            <option value="light">Light</option>
            <option value="satellite">Satellite</option>
            <option value="dark">Dark</option>
            <option value="topo">Topo</option>
          </select>
        </div>

        <div className="sidebar-section">
          <label className="field-label">Title</label>
          <input className="text-input" value={project.layout.title} onChange={(e) => updateLayout({ title: e.target.value })} />

          <label className="field-label">Subtitle</label>
          <input className="text-input" value={project.layout.subtitle} onChange={(e) => updateLayout({ subtitle: e.target.value })} />
        </div>

        <div className="sidebar-section">
          <div className="field-label">Layers</div>
          <LayerList
            layers={project.layers}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onToggleVisible={(layerId) => {
              const layer = project.layers.find((l) => l.id === layerId);
              if (!layer) return;
              updateLayer(layerId, { visible: !layer.visible });
            }}
          />

          {selectedLayer && (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <button className="btn btn-small" onClick={() => fitLayerBounds(selectedLayer.geojson)}>
                Zoom to Selected
              </button>
              <button className="btn btn-small" onClick={() => removeLayer(selectedLayer.id)}>
                Remove Selected
              </button>
            </div>
          )}
        </div>

        {selectedLayer && (
          <div className="sidebar-section">
            <div className="field-label">Selected Layer</div>

            <label className="field-label">Layer Role</label>
            <select
              className="text-input"
              value={selectedLayer.role || "other"}
              onChange={(e) => updateLayer(selectedLayer.id, { role: e.target.value })}
            >
              <option value="claims">Claims</option>
              <option value="highlight_zone">Highlight Zone</option>
              <option value="anomaly">Anomaly</option>
              <option value="geophysics">Geophysics</option>
              <option value="drill_traces">Drill Traces</option>
              <option value="drillholes">Drillholes</option>
              <option value="other">Other</option>
            </select>

            <label className="field-label">Legend Label</label>
            <input
              className="text-input"
              value={selectedLayer.legend?.label || selectedLayer.name || ""}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    ...(selectedLayer.legend || {}),
                    enabled: true,
                    label: e.target.value,
                  },
                })
              }
            />

            <label className="field-label">Legend Entry</label>
            <select
              className="text-input"
              value={selectedLayer.legend?.enabled === false ? "no" : "yes"}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    ...(selectedLayer.legend || {}),
                    enabled: e.target.value === "yes",
                    label: selectedLayer.legend?.label || selectedLayer.name || ROLE_LABELS[selectedLayer.role] || "Layer",
                  },
                })
              }
            >
              <option value="yes">Include</option>
              <option value="no">Hide</option>
            </select>
          </div>
        )}

        <div className="sidebar-section">
          <div className="row-between">
            <span className="field-label">Logo</span>
            <button className="btn btn-small" onClick={() => logoInputRef.current?.click()}>
              Upload
            </button>
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoChange} />
          {project.layout?.logo && (
            <button className="btn btn-small" style={{ marginTop: 8 }} onClick={() => updateLayout({ logo: null })}>
              Remove Logo
            </button>
          )}
        </div>

        <div className="sidebar-section">
          <div className="field-label">Export</div>

          <label className="field-label">Filename</label>
          <input
            className="text-input"
            value={exportSettings.filename || "mapviewer-export"}
            onChange={(e) => updateLayout({ exportSettings: { filename: e.target.value } })}
          />

          <label className="field-label">Pixel Ratio</label>
          <select
            className="text-input"
            value={String(exportSettings.pixelRatio || 2)}
            onChange={(e) => updateLayout({ exportSettings: { pixelRatio: Number(e.target.value) } })}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
          </select>

          <div className="export-buttons">
            <button className="btn" disabled={exporting} onClick={() => handleExport("png")}>
              {exporting ? "Working..." : "Export PNG"}
            </button>
            <button className="btn" disabled={exporting} onClick={() => handleExport("svg")}>
              {exporting ? "Working..." : "Export SVG"}
            </button>
          </div>
        </div>
      </Sidebar>

      <div className="map-stage">
        <div className="map-container geology-template-stage" ref={mapContainerRef}>
          <MapCanvas onReady={onMapReady} project={project} template={template} />

          <div style={zoneStyle(zones.title)} className="template-title-shell">
            <div className="map-title-block template-card title-card">
              <div className="map-title">{project.layout.title}</div>
              <div className="map-subtitle">{project.layout.subtitle}</div>
            </div>
          </div>

          {legendItems.length > 0 && (
            <div style={zoneStyle(zones.legend)}>
              <div className="legend-box template-card legend-card">
                <div className="legend-title">Legend</div>
                {legendItems.map((item) => (
                  <div key={item.id} className="legend-row">
                    <span
                      className={`legend-swatch ${item.type === "points" ? "point" : "area"}`}
                      style={{
                        background: item.type === "points" ? item.style?.markerFill || item.style?.markerColor || "#111111" : item.style?.fill || "#74a0f6",
                        borderColor: item.type === "points" ? item.style?.markerColor || "#111111" : item.style?.stroke || "#305ea8",
                        opacity: item.type === "points" ? 1 : item.style?.fillOpacity ?? 1,
                      }}
                    />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={zoneStyle(zones.northArrow)}>
            <NorthArrow />
          </div>

          <div style={zoneStyle(zones.scaleBar)}>
            <ScaleBar map={leafletMapRef.current} />
          </div>

          {project.layout?.logo && (
            <div style={zoneStyle(zones.logo)}>
              <div className="template-card logo-card">
                <img src={project.layout.logo} alt="Logo" className="logo-image" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
