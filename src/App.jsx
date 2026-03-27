import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import MapCanvas from "./components/MapCanvas";
import Sidebar from "./components/Sidebar";
import LayerList from "./components/LayerList";
import { loadGeoJSON } from "./utils/importers";
import { buildScene } from "./export/buildScene";
import { exportPNG } from "./export/exportPNG";
import { exportSVG } from "./export/exportSVG";
import { createInitialProjectState } from "./projectState";
import { applyPresetToLayer, LAYER_PRESETS } from "./mapPresets";

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function getDefaultLayoutPatch() {
  return {
    basemap: "light",
    exportSettings: {
      pixelRatio: 2,
      filename: "mapviewer-export",
    },
    legendStyle: {
      background: "#ffffff",
      border: "#d9d9d9",
      text: "#1f1f1f",
      borderRadius: 10,
      padding: 12,
      width: 220,
    },
    overlays: {
      title: {
        visible: true,
        x: 24,
        y: 20,
      },
      legend: {
        visible: true,
        x: 24,
        y: 96,
      },
      northArrow: {
        visible: true,
        x: 24,
        y: 340,
      },
      scaleBar: {
        visible: true,
        x: 24,
        y: 410,
      },
      logo: {
        visible: true,
        x: 24,
        y: 470,
        width: 140,
      },
    },
    logo: null,
  };
}

function OverlayHandle({
  label,
  position,
  onChange,
  children,
  hidden = false,
  boundsRef,
}) {
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  if (hidden) return null;

  const onPointerDown = (e) => {
    if (e.target.closest("input, button, select, textarea")) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x || 0,
      originY: position.y || 0,
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;

    const bounds = boundsRef.current?.getBoundingClientRect();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    let nextX = dragRef.current.originX + dx;
    let nextY = dragRef.current.originY + dy;

    if (bounds) {
      nextX = clamp(nextX, 0, Math.max(0, bounds.width - 50));
      nextY = clamp(nextY, 0, Math.max(0, bounds.height - 30));
    }

    onChange({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const onPointerUp = () => {
    dragRef.current.active = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: position.x || 0,
        top: position.y || 0,
        cursor: "grab",
        zIndex: 500,
        userSelect: "none",
      }}
      title={`Drag ${label}`}
    >
      {children}
    </div>
  );
}

function NorthArrow() {
  return (
    <div
      style={{
        width: 46,
        textAlign: "center",
        fontWeight: 700,
        color: "#111",
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #d9d9d9",
        borderRadius: 10,
        padding: "8px 6px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontSize: 12, marginBottom: 2 }}>N</div>
      <div style={{ fontSize: 24, lineHeight: 1 }}>↑</div>
    </div>
  );
}

function ScaleBar({ map }) {
  const [label, setLabel] = useState("1 km");
  const [barWidth, setBarWidth] = useState(120);

  useEffect(() => {
    if (!map) return;

    const updateScale = () => {
      try {
        const size = map.getSize();
        const y = size.y / 2;
        const x1 = 20;
        const x2 = 140;

        const latlng1 = map.containerPointToLatLng([x1, y]);
        const latlng2 = map.containerPointToLatLng([x2, y]);

        const meters = latlng1.distanceTo(latlng2);
        if (!Number.isFinite(meters) || meters <= 0) return;

        const candidates = [
          50, 100, 200, 250, 500,
          1000, 2000, 2500, 5000,
          10000, 20000, 25000, 50000,
          100000,
        ];

        const target = meters;
        const nice = candidates.reduce((best, n) =>
          Math.abs(n - target) < Math.abs(best - target) ? n : best
        , candidates[0]);

        const ratio = nice / meters;
        const width = clamp(Math.round((x2 - x1) * ratio), 50, 180);

        setBarWidth(width);
        setLabel(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`);
      } catch {
        // ignore transient map state
      }
    };

    updateScale();
    map.on("zoomend moveend resize", updateScale);

    return () => {
      map.off("zoomend moveend resize", updateScale);
    };
  }, [map]);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #d9d9d9",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        color: "#111",
        minWidth: 120,
      }}
    >
      <div
        style={{
          width: barWidth,
          height: 10,
          border: "1px solid #111",
          background:
            "linear-gradient(to right, #111 0 50%, #fff 50% 100%)",
        }}
      />
      <div style={{ fontSize: 12, marginTop: 6 }}>{label}</div>
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
        ...getDefaultLayoutPatch(),
      },
    };
  });

  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const selectedLayer = useMemo(
    () => project.layers.find((l) => l.id === selectedLayerId) || null,
    [project.layers, selectedLayerId]
  );

  const updateLayout = (patch) => {
    setProject((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        ...patch,
        exportSettings: patch.exportSettings
          ? { ...(prev.layout?.exportSettings || {}), ...patch.exportSettings }
          : prev.layout?.exportSettings,
        legendStyle: patch.legendStyle
          ? { ...(prev.layout?.legendStyle || {}), ...patch.legendStyle }
          : prev.layout?.legendStyle,
        overlays: patch.overlays
          ? {
              ...(prev.layout?.overlays || {}),
              ...Object.fromEntries(
                Object.entries(patch.overlays).map(([key, value]) => [
                  key,
                  {
                    ...(prev.layout?.overlays?.[key] || {}),
                    ...(value || {}),
                  },
                ])
              ),
            }
          : prev.layout?.overlays,
      },
    }));
  };

  const updateLayer = (layerId, patch) => {
    setProject((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === layerId ? mergeDeep(layer, patch) : layer
      ),
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
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch {
      // no-op
    }
  };

  const fitSelectedLayer = () => {
    if (!selectedLayer?.geojson) return;
    fitLayerBounds(selectedLayer.geojson);
  };

  const addGeoJSONLayer = async (file) => {
    try {
      const geojson = await loadGeoJSON(file);
      const id = crypto.randomUUID();
      const baseName = file.name.replace(/\.(zip|geojson|json)$/i, "") || "Layer";
      const kind = detectLayerKind(geojson);
      const presetKey = kind === "points" ? "drillhole" : "claim";

      const rawLayer = {
        id,
        name: baseName,
        type: kind,
        visible: true,
        geojson,
        style: {
          stroke: "#54a6ff",
          fill: "#54a6ff",
          fillOpacity: 0.22,
          strokeWidth: 2,
          markerColor: "#111111",
          markerSize: 10,
          dashArray: "",
        },
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

      setTimeout(() => {
        fitLayerBounds(geojson);
      }, 50);
    } catch (err) {
      console.error(err);
      alert(`Import failed: ${err.message}`);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addGeoJSONLayer(file);
    e.target.value = "";
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataURL(file);
      updateLayout({ logo: dataUrl });
    } catch (err) {
      console.error(err);
      alert(`Logo import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  };

  const handleBuildLegend = () => {
    const legendItems = project.layers
      .filter((layer) => layer.visible !== false)
      .filter((layer) => layer.legend?.enabled !== false)
      .map((layer) => ({
        id: layer.id,
        label: layer.legend?.label || layer.name,
        type: layer.type,
        style: layer.style,
      }));

    updateLayout({ legendItems });
  };

  const handleApplyPreset = (presetKey) => {
    if (!selectedLayer) return;
    const next = applyPresetToLayer(selectedLayer, presetKey);
    updateLayer(selectedLayer.id, next);
  };

  const handleExportPNG = async () => {
    if (!mapContainerRef.current) return;

    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      await exportPNG(scene, project.layout?.exportSettings || {});
    } catch (err) {
      console.error(err);
      alert(`PNG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSVG = async () => {
    if (!mapContainerRef.current) return;

    setExporting(true);
    try {
      const scene = buildScene(mapContainerRef.current, project, leafletMapRef.current);
      exportSVG(scene, project.layout?.exportSettings || {});
    } catch (err) {
      console.error(err);
      alert(`SVG export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const overlays = project.layout?.overlays || {};
  const legendStyle = project.layout?.legendStyle || {};
  const exportSettings = project.layout?.exportSettings || {};

  return (
    <div className="app-shell">
      <Sidebar>
        <div className="sidebar-section">
          <div className="sidebar-title">Mapviewer</div>
          <div className="sidebar-subtitle">Map composition + export</div>
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
            <span className="field-label">Layers</span>
            <button className="btn btn-small" onClick={handleBuildLegend}>
              Build Legend
            </button>
          </div>

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
              <button className="btn btn-small" onClick={fitSelectedLayer}>
                Zoom to Selected
              </button>
              <button
                className="btn btn-small"
                onClick={() => removeLayer(selectedLayer.id)}
              >
                Remove Selected
              </button>
            </div>
          )}
        </div>

        {selectedLayer && (
          <div className="sidebar-section">
            <div className="field-label">Selected Layer</div>

            <label className="field-label">Name</label>
            <input
              className="text-input"
              value={selectedLayer.name}
              onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })}
            />

            <label className="field-label">Preset</label>
            <select
              className="text-input"
              defaultValue=""
              onChange={(e) => e.target.value && handleApplyPreset(e.target.value)}
            >
              <option value="">Choose preset</option>
              {Object.keys(LAYER_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {LAYER_PRESETS[key].label}
                </option>
              ))}
            </select>

            {selectedLayer.type !== "points" && (
              <>
                <label className="field-label">Stroke</label>
                <input
                  className="color-input"
                  type="color"
                  value={selectedLayer.style?.stroke || "#54a6ff"}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { stroke: e.target.value },
                    })
                  }
                />

                <label className="field-label">Fill</label>
                <input
                  className="color-input"
                  type="color"
                  value={selectedLayer.style?.fill || "#54a6ff"}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { fill: e.target.value },
                    })
                  }
                />

                <label className="field-label">Fill Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selectedLayer.style?.fillOpacity ?? 0.22}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { fillOpacity: Number(e.target.value) },
                    })
                  }
                />

                <label className="field-label">Stroke Width</label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={selectedLayer.style?.strokeWidth ?? 2}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { strokeWidth: Number(e.target.value) },
                    })
                  }
                />
              </>
            )}

            {selectedLayer.type === "points" && (
              <>
                <label className="field-label">Marker Color</label>
                <input
                  className="color-input"
                  type="color"
                  value={selectedLayer.style?.markerColor || "#111111"}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { markerColor: e.target.value },
                    })
                  }
                />

                <label className="field-label">Marker Size</label>
                <input
                  type="range"
                  min="6"
                  max="24"
                  step="1"
                  value={selectedLayer.style?.markerSize ?? 10}
                  onChange={(e) =>
                    updateLayer(selectedLayer.id, {
                      style: { markerSize: Number(e.target.value) },
                    })
                  }
                />
              </>
            )}

            <label className="field-label">Legend Label</label>
            <input
              className="text-input"
              value={selectedLayer.legend?.label || ""}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    enabled: true,
                    label: e.target.value,
                  },
                })
              }
            />

            <label className="field-label">Legend Enabled</label>
            <select
              className="text-input"
              value={selectedLayer.legend?.enabled === false ? "no" : "yes"}
              onChange={(e) =>
                updateLayer(selectedLayer.id, {
                  legend: {
                    ...(selectedLayer.legend || {}),
                    enabled: e.target.value === "yes",
                  },
                })
              }
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        )}

        <div className="sidebar-section">
          <div className="field-label">Layout Elements</div>

          <label className="field-label">Title Visible</label>
          <select
            className="text-input"
            value={overlays.title?.visible === false ? "no" : "yes"}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  title: { visible: e.target.value === "yes" },
                },
              })
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>

          <label className="field-label">Legend Visible</label>
          <select
            className="text-input"
            value={overlays.legend?.visible === false ? "no" : "yes"}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  legend: { visible: e.target.value === "yes" },
                },
              })
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>

          <label className="field-label">North Arrow Visible</label>
          <select
            className="text-input"
            value={overlays.northArrow?.visible === false ? "no" : "yes"}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  northArrow: { visible: e.target.value === "yes" },
                },
              })
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>

          <label className="field-label">Scale Bar Visible</label>
          <select
            className="text-input"
            value={overlays.scaleBar?.visible === false ? "no" : "yes"}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  scaleBar: { visible: e.target.value === "yes" },
                },
              })
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>

          <label className="field-label">Logo Visible</label>
          <select
            className="text-input"
            value={overlays.logo?.visible === false ? "no" : "yes"}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  logo: { visible: e.target.value === "yes" },
                },
              })
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        <div className="sidebar-section">
          <div className="row-between">
            <span className="field-label">Logo</span>
            <button className="btn btn-small" onClick={() => logoInputRef.current?.click()}>
              Upload
            </button>
          </div>

          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleLogoChange}
          />

          <label className="field-label">Logo Width</label>
          <input
            type="range"
            min="40"
            max="260"
            step="5"
            value={overlays.logo?.width ?? 140}
            onChange={(e) =>
              updateLayout({
                overlays: {
                  logo: { width: Number(e.target.value) },
                },
              })
            }
          />

          {project.layout?.logo && (
            <button className="btn btn-small" onClick={() => updateLayout({ logo: null })}>
              Remove Logo
            </button>
          )}
        </div>

        <div className="sidebar-section">
          <div className="field-label">Legend Style</div>

          <label className="field-label">Background</label>
          <input
            className="color-input"
            type="color"
            value={legendStyle.background || "#ffffff"}
            onChange={(e) =>
              updateLayout({
                legendStyle: { background: e.target.value },
              })
            }
          />

          <label className="field-label">Border</label>
          <input
            className="color-input"
            type="color"
            value={legendStyle.border || "#d9d9d9"}
            onChange={(e) =>
              updateLayout({
                legendStyle: { border: e.target.value },
              })
            }
          />

          <label className="field-label">Text</label>
          <input
            className="color-input"
            type="color"
            value={legendStyle.text || "#1f1f1f"}
            onChange={(e) =>
              updateLayout({
                legendStyle: { text: e.target.value },
              })
            }
          />

          <label className="field-label">Width</label>
          <input
            type="range"
            min="160"
            max="340"
            step="10"
            value={legendStyle.width ?? 220}
            onChange={(e) =>
              updateLayout({
                legendStyle: { width: Number(e.target.value) },
              })
            }
          />
        </div>

        <div className="sidebar-section">
          <div className="field-label">Export</div>

          <label className="field-label">Filename</label>
          <input
            className="text-input"
            value={exportSettings.filename || "mapviewer-export"}
            onChange={(e) =>
              updateLayout({
                exportSettings: { filename: e.target.value },
              })
            }
          />

          <label className="field-label">Pixel Ratio</label>
          <select
            className="text-input"
            value={String(exportSettings.pixelRatio || 2)}
            onChange={(e) =>
              updateLayout({
                exportSettings: { pixelRatio: Number(e.target.value) },
              })
            }
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
            <option value="4">4x</option>
          </select>

          <div className="export-buttons">
            <button className="btn" disabled={exporting} onClick={handleExportPNG}>
              {exporting ? "Working..." : "Export PNG"}
            </button>
            <button className="btn" disabled={exporting} onClick={handleExportSVG}>
              {exporting ? "Working..." : "Export SVG"}
            </button>
          </div>
        </div>
      </Sidebar>

      <div className="map-stage">
        <div className="map-container" ref={mapContainerRef} style={{ position: "relative" }}>
          <MapCanvas onReady={onMapReady} project={project} />

          <OverlayHandle
            label="title"
            position={overlays.title || { x: 24, y: 20 }}
            onChange={(patch) =>
              updateLayout({
                overlays: {
                  title: patch,
                },
              })
            }
            hidden={overlays.title?.visible === false}
            boundsRef={mapContainerRef}
          >
            <div
              className="map-title-block"
              style={{
                background: "rgba(255,255,255,0.88)",
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                padding: "12px 14px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                maxWidth: 420,
              }}
            >
              <div className="map-title">{project.layout.title}</div>
              <div className="map-subtitle">{project.layout.subtitle}</div>
            </div>
          </OverlayHandle>

          {project.layout.legendItems?.length > 0 && (
            <OverlayHandle
              label="legend"
              position={overlays.legend || { x: 24, y: 96 }}
              onChange={(patch) =>
                updateLayout({
                  overlays: {
                    legend: patch,
                  },
                })
              }
              hidden={overlays.legend?.visible === false}
              boundsRef={mapContainerRef}
            >
              <div
                className="legend-box"
                style={{
                  width: legendStyle.width || 220,
                  background: legendStyle.background || "#ffffff",
                  border: `1px solid ${legendStyle.border || "#d9d9d9"}`,
                  color: legendStyle.text || "#1f1f1f",
                  borderRadius: legendStyle.borderRadius ?? 10,
                  padding: legendStyle.padding ?? 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                }}
              >
                <div
                  className="legend-title"
                  style={{ marginBottom: 8, fontWeight: 700, fontSize: 14 }}
                >
                  Legend
                </div>

                {project.layout.legendItems.map((item) => (
                  <div
                    key={item.id}
                    className="legend-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      className="legend-swatch"
                      style={{
                        width: item.type === "points" ? 12 : 18,
                        height: item.type === "points" ? 12 : 12,
                        display: "inline-block",
                        background:
                          item.type === "points"
                            ? item.style?.markerColor || "#111111"
                            : item.style?.fill || "#54a6ff",
                        border: `2px solid ${
                          item.type === "points"
                            ? item.style?.markerColor || "#111111"
                            : item.style?.stroke || "#54a6ff"
                        }`,
                        borderRadius: item.type === "points" ? "999px" : "2px",
                        opacity:
                          item.type === "points"
                            ? 1
                            : item.style?.fillOpacity ?? 1,
                        flex: "0 0 auto",
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </OverlayHandle>
          )}

          <OverlayHandle
            label="north arrow"
            position={overlays.northArrow || { x: 24, y: 340 }}
            onChange={(patch) =>
              updateLayout({
                overlays: {
                  northArrow: patch,
                },
              })
            }
            hidden={overlays.northArrow?.visible === false}
            boundsRef={mapContainerRef}
          >
            <NorthArrow />
          </OverlayHandle>

          <OverlayHandle
            label="scale bar"
            position={overlays.scaleBar || { x: 24, y: 410 }}
            onChange={(patch) =>
              updateLayout({
                overlays: {
                  scaleBar: patch,
                },
              })
            }
            hidden={overlays.scaleBar?.visible === false}
            boundsRef={mapContainerRef}
          >
            <ScaleBar map={leafletMapRef.current} />
          </OverlayHandle>

          {project.layout?.logo && (
            <OverlayHandle
              label="logo"
              position={overlays.logo || { x: 24, y: 470, width: 140 }}
              onChange={(patch) =>
                updateLayout({
                  overlays: {
                    logo: patch,
                  },
                })
              }
              hidden={overlays.logo?.visible === false}
              boundsRef={mapContainerRef}
            >
              <div
                style={{
                  background: "rgba(255,255,255,0.9)",
                  border: "1px solid #d9d9d9",
                  borderRadius: 10,
                  padding: 8,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                }}
              >
                <img
                  src={project.layout.logo}
                  alt="Logo"
                  style={{
                    display: "block",
                    width: overlays.logo?.width ?? 140,
                    height: "auto",
                    maxWidth: "none",
                  }}
                />
              </div>
            </OverlayHandle>
          )}
        </div>
      </div>
    </div>
  );
}