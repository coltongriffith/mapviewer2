import React, { useMemo, useRef, useState } from "react";
import L from "leaflet";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import LayerRoleEditor from "./components/LayerRoleEditor";
import MapCanvas from "./components/MapCanvas";
import TemplateRenderer from "./components/TemplateRenderer";
import { loadGeoJSON } from "./utils/importers";
import { createInitialProjectState, ROLE_LABELS } from "./projectState";
import { getTemplate, templates } from "./templates";
import { buildLegendItems } from "./templates/technicalResultsTemplate";
import { buildScene } from "./export/buildScene";
import { exportPNG } from "./export/exportPNG";
import { exportSVG } from "./export/exportSVG";

function detectLayerType(geojson) {
  const features = geojson?.type === "FeatureCollection"
    ? geojson.features || []
    : geojson?.type === "Feature"
      ? [geojson]
      : [];

  const geometryType = features.find((feature) => feature?.geometry?.type)?.geometry?.type || "Polygon";
  if (geometryType.includes("Point")) return "points";
  if (geometryType.includes("Line")) return "line";
  return "polygon";
}

function inferRole(type, name) {
  const v = `${name || ""}`.toLowerCase();
  if (type === "points") return "drillholes";
  if (type === "line") return /trace|hole|drill/.test(v) ? "drill_traces" : "other";
  if (/claim|tenure|license/.test(v)) return "claims";
  if (/anom|target/.test(v)) return "anomaly";
  if (/geo|mag|ip|em|survey/.test(v)) return "geophysics";
  if (/highlight|zone/.test(v)) return "highlight_zone";
  return "other";
}

function mergeLayer(layer, patch, template) {
  const nextRole = patch.role ?? layer.role;
  const roleStyle = template.roleStyles?.[nextRole] || template.roleStyles?.other || {};
  const mergedStyle = patch.style ? { ...(layer.style || {}), ...patch.style } : layer.style;
  return {
    ...layer,
    ...patch,
    style: patch.role ? { ...roleStyle, ...(mergedStyle || {}) } : mergedStyle,
  };
}

function fitGeojson(map, geojson) {
  if (!map || !geojson) return;
  try {
    const bounds = L.geoJSON(geojson).getBounds();
    if (bounds?.isValid?.()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  } catch {
    // ignore invalid features
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const [project, setProject] = useState(createInitialProjectState);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [selectedCalloutId, setSelectedCalloutId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const template = useMemo(() => getTemplate(project.template), [project.template]);
  const legendItems = useMemo(
    () => buildLegendItems(template, project.layers || []),
    [template, project.layers]
  );

  const selectedLayer = useMemo(
    () => project.layers.find((layer) => layer.id === selectedLayerId) || null,
    [project.layers, selectedLayerId]
  );

  const selectedCallout = useMemo(
    () => project.annotations.callouts.find((callout) => callout.id === selectedCalloutId) || null,
    [project.annotations.callouts, selectedCalloutId]
  );

  const updateProject = (updater) => setProject((prev) => updater(prev));

  const updateLayout = (patch) => {
    updateProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
      },
    }));
  };

  const updateLayer = (layerId, patch) => {
    updateProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === layerId ? mergeLayer(layer, patch, template) : layer
      ),
    }));
  };

  const removeLayer = (layerId) => {
    updateProject((prev) => ({
      ...prev,
      layers: prev.layers.filter((layer) => layer.id !== layerId),
      annotations: {
        ...prev.annotations,
        callouts: prev.annotations.callouts.filter((callout) => callout.layerId !== layerId),
      },
    }));
    if (selectedLayerId === layerId) setSelectedLayerId(null);
  };

  const updateCallout = (calloutId, patch) => {
    updateProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: prev.annotations.callouts.map((callout) =>
          callout.id === calloutId
            ? {
                ...callout,
                ...patch,
                offset: patch.offset
                  ? { ...(callout.offset || { x: 0, y: 0 }), ...patch.offset }
                  : callout.offset,
              }
            : callout
        ),
      },
    }));
  };

  const removeCallout = (calloutId) => {
    updateProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: prev.annotations.callouts.filter((callout) => callout.id !== calloutId),
      },
    }));
    if (selectedCalloutId === calloutId) setSelectedCalloutId(null);
  };

  const onMapReady = (map) => {
    leafletMapRef.current = map;
  };

  const addLayer = async (file) => {
    const geojson = await loadGeoJSON(file);
    const name = file.name.replace(/\.(zip|geojson|json)$/i, "") || "Layer";
    const type = detectLayerType(geojson);
    const role = inferRole(type, name);
    const roleStyle = template.roleStyles?.[role] || template.roleStyles?.other || {};

    const layer = {
      id: crypto.randomUUID(),
      name,
      role,
      type,
      visible: true,
      geojson,
      style: { ...roleStyle },
      legendLabel: ROLE_LABELS[role] || name,
      legendEnabled: true,
    };

    updateProject((prev) => ({
      ...prev,
      layers: [...prev.layers, layer],
      layout: {
        ...prev.layout,
        legendItems: buildLegendItems(template, [...prev.layers, layer]),
      },
    }));

    setSelectedLayerId(layer.id);
    requestAnimationFrame(() => fitGeojson(leafletMapRef.current, geojson));
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await addLayer(file);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const logo = await readFileAsDataURL(file);
      updateLayout({ logo });
    } catch (error) {
      alert(`Logo import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const rebuildLegend = () => {
    updateLayout({ legendItems });
  };

  const onDrillholeClick = ({ layerId, feature, anchor }) => {
    const holeId =
      feature?.properties?.hole_id ||
      feature?.properties?.HoleID ||
      feature?.properties?.name ||
      feature?.properties?.Name ||
      "Drillhole";

    const callout = {
      id: crypto.randomUUID(),
      layerId,
      anchor,
      offset: { x: 54, y: -46 },
      text: `${holeId}\nAdd intercept here`,
      hero: project.annotations.callouts.length === 0,
    };

    updateProject((prev) => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        callouts: [...prev.annotations.callouts, callout],
      },
    }));
    setSelectedCalloutId(callout.id);
  };

  const handleNudgeCallout = (calloutId, dx, dy) => {
    const callout = project.annotations.callouts.find((item) => item.id === calloutId);
    if (!callout) return;
    updateCallout(calloutId, {
      offset: {
        x: (callout.offset?.x || 0) + dx,
        y: (callout.offset?.y || 0) + dy,
      },
    });
  };

  const handleExportPNG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, { ...project, layout: { ...project.layout, legendItems } }, leafletMapRef.current);
      await exportPNG(scene, project.exportSettings);
    } catch (error) {
      alert(error.message || "PNG export failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = async () => {
    if (!mapContainerRef.current) return;
    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, { ...project, layout: { ...project.layout, legendItems } }, leafletMapRef.current);
      await exportSVG(scene, project.exportSettings);
    } catch (error) {
      alert(error.message || "SVG export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-section">
          <div className="sidebar-title">Mapviewer</div>
          <div className="sidebar-subtitle">Template-based geology figure builder</div>
        </div>

        <div className="sidebar-section">
          <label className="field-label">1. Upload Data</label>
          <button className="btn" type="button" onClick={() => fileInputRef.current?.click()}>
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
          <label className="field-label">2. Template</label>
          <select
            className="text-input"
            value={project.template}
            onChange={(e) => updateProject((prev) => ({ ...prev, template: e.target.value }))}
          >
            {Object.values(templates).map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>

          <label className="field-label">Basemap</label>
          <select
            className="text-input"
            value={project.layout.basemap}
            onChange={(e) => updateLayout({ basemap: e.target.value })}
          >
            <option value="light">Light</option>
            <option value="topo">Topo</option>
            <option value="satellite">Satellite</option>
            <option value="dark">Dark</option>
          </select>

          <label className="field-label">Inset Map</label>
          <select
            className="text-input"
            value={project.layout.insetEnabled ? "yes" : "no"}
            onChange={(e) => updateLayout({ insetEnabled: e.target.value === "yes" })}
          >
            <option value="yes">On</option>
            <option value="no">Off</option>
          </select>
        </div>

        <div className="sidebar-section">
          <div className="row-between">
            <span className="field-label">3. Layers</span>
            <button className="btn btn-small" type="button" onClick={rebuildLegend}>Rebuild Legend</button>
          </div>
          <LayerList
            layers={project.layers}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onToggleVisible={(layerId) => {
              const layer = project.layers.find((item) => item.id === layerId);
              if (!layer) return;
              updateLayer(layerId, { visible: !layer.visible });
            }}
          />
        </div>

        {selectedLayer && (
          <div className="sidebar-section">
            <div className="field-label">Selected Layer</div>
            <LayerRoleEditor
              layer={selectedLayer}
              onChange={(patch) => updateLayer(selectedLayer.id, patch)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-small" type="button" onClick={() => fitGeojson(leafletMapRef.current, selectedLayer.geojson)}>
                Zoom to Layer
              </button>
              <button className="btn btn-small" type="button" onClick={() => removeLayer(selectedLayer.id)}>
                Remove
              </button>
            </div>
          </div>
        )}

        <div className="sidebar-section">
          <label className="field-label">4. Title</label>
          <input
            className="text-input"
            value={project.layout.title}
            onChange={(e) => updateLayout({ title: e.target.value })}
          />
          <label className="field-label">Subtitle</label>
          <input
            className="text-input"
            value={project.layout.subtitle}
            onChange={(e) => updateLayout({ subtitle: e.target.value })}
          />
        </div>

        <div className="sidebar-section">
          <div className="row-between">
            <span className="field-label">5. Branding</span>
            <button className="btn btn-small" type="button" onClick={() => logoInputRef.current?.click()}>
              Upload Logo
            </button>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleLogoChange}
          />
          {project.layout.logo && (
            <button className="btn btn-small" type="button" onClick={() => updateLayout({ logo: null })}>
              Remove Logo
            </button>
          )}
        </div>

        <div className="sidebar-section">
          <div className="field-label">6. Callouts</div>
          <div style={{ fontSize: 12, color: "#a8b0be", marginBottom: 8 }}>
            Click a drillhole on the map to add a callout.
          </div>
          <select
            className="text-input"
            value={selectedCalloutId || ""}
            onChange={(e) => setSelectedCalloutId(e.target.value || null)}
          >
            <option value="">Select callout</option>
            {project.annotations.callouts.map((callout, index) => (
              <option key={callout.id} value={callout.id}>Callout {index + 1}</option>
            ))}
          </select>
          {selectedCallout && (
            <>
              <textarea
                className="text-input"
                rows={5}
                value={selectedCallout.text}
                onChange={(e) => updateCallout(selectedCallout.id, { text: e.target.value })}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-small" type="button" onClick={() => removeCallout(selectedCallout.id)}>
                  Remove Callout
                </button>
              </div>
            </>
          )}
        </div>

        <div className="sidebar-section">
          <div className="field-label">7. Export</div>
          <label className="field-label">Filename</label>
          <input
            className="text-input"
            value={project.exportSettings.filename}
            onChange={(e) => updateProject((prev) => ({
              ...prev,
              exportSettings: { ...prev.exportSettings, filename: e.target.value },
            }))}
          />
          <label className="field-label">Pixel Ratio</label>
          <select
            className="text-input"
            value={String(project.exportSettings.pixelRatio)}
            onChange={(e) => updateProject((prev) => ({
              ...prev,
              exportSettings: { ...prev.exportSettings, pixelRatio: Number(e.target.value) },
            }))}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
          </select>
          <div className="export-buttons">
            <button className="btn" type="button" disabled={exporting} onClick={handleExportPNG}>
              {exporting ? "Working..." : "Export PNG"}
            </button>
            <button className="btn" type="button" disabled={exporting} onClick={handleExportSVG}>
              {exporting ? "Working..." : "Export SVG"}
            </button>
          </div>
        </div>
      </Sidebar>

      <div className="map-stage">
        <div className="map-container" ref={mapContainerRef}>
          <MapCanvas
            onReady={onMapReady}
            project={{ ...project, layout: { ...project.layout, legendItems } }}
            template={template}
            onDrillholeClick={onDrillholeClick}
          />
          <TemplateRenderer
            project={{ ...project, layout: { ...project.layout, legendItems } }}
            template={template}
            map={leafletMapRef.current}
            legendItems={legendItems}
            onNudgeCallout={handleNudgeCallout}
          />
        </div>
      </div>
    </div>
  );
}
