import React, { useState } from 'react';
import { isRasterName, isWorldFileName } from '../utils/rasterOverlay.js';

const MULTI_ACCEPT = '.zip,.shp,.dbf,.prj,.shx,.geojson,.json,.kml,.kmz,.csv,.png,.jpg,.jpeg,.gif,.webp,.pgw,.jgw,.wld,.tfw';

const shapePart = (name) => /\.(shp|dbf|prj|shx|cpg|qix|sbn|sbx)$/i.test(name);
const stem = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();

// Keep paired source files together, and independent imports in selection order.
export function groupUploadFiles(input) {
  const files = Array.from(input), names = new Set(), used = new Set(), groups = [];
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (names.has(name)) throw new Error('Several selected files have the same name. Import those files separately.');
    names.add(name);
  }
  for (let i = 0; i < files.length; i++) {
    if (used.has(i)) continue;
    const f = files[i], same = files.map((file, index) => ({ file, index })).filter(({ file }) => stem(file.name) === stem(f.name));
    let selected = [{ file: f, index: i }], kind = 'file';
    if (shapePart(f.name)) {
      selected = same.filter(({ file }) => shapePart(file.name)); kind = 'shapefile';
    } else if (isRasterName(f.name) || isWorldFileName(f.name)) {
      const images = same.filter(({ file }) => isRasterName(file.name)), worlds = same.filter(({ file }) => isWorldFileName(file.name));
      if (worlds.length > 1 || (worlds.length && images.length > 1)) throw new Error('An image has more than one possible matching world file or image. Import each image and its world file separately.');
      if (images.length === 1 && worlds.length === 1) { selected = same.filter(({ file }) => isRasterName(file.name) || isWorldFileName(file.name)); kind = 'raster'; }
    }
    selected.forEach(({ index }) => used.add(index));
    groups.push({ kind, files: selected.map(({ file }) => file) });
  }
  return groups;
}

export default function UploadPanel({ onUploadFile, onUploadFiles, inputRef, status, layers }) {
  const [dragging, setDragging] = useState(false);
  const upload = async (files) => {
    if (!files.length) return;
    if (files.length > 1 && onUploadFiles) await onUploadFiles(files);
    else for (const file of files) await onUploadFile(file);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files || []);
    await upload(files);
  };

  const handleChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await upload(files);
  };

  return (
    <section className="control-section">
      <div className="upload-header-row">
        <h2>Upload</h2>
        <div className="hover-help">
          <button className="hover-help-trigger" type="button" aria-label="What file formats are supported?">i</button>
          <div className="hover-help-tooltip">
            Drop a <code>.zip</code> containing your shapefile, or drop all shapefile parts together (<code>.shp</code>, <code>.dbf</code>, <code>.prj</code>, <code>.shx</code>) without zipping. Also accepts <code>.geojson</code>, <code>.json</code>, <code>.kml</code>, <code>.kmz</code>, <code>.csv</code> for drillhole collar tables, and a <code>.png</code>/<code>.jpg</code> image (a geophysics grid, say) with its world file or typed-in corner coordinates.
          </div>
        </div>
      </div>
      <div
        className={`upload-dropzone ${dragging ? 'dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Upload shapefile, GeoJSON, KML, CSV or georeferenced image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <strong>Drag and drop a map file here</strong>
        <span>or click to browse</span>
        <small>.zip · .shp+.dbf · .geojson · .kml · .kmz · .csv</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={MULTI_ACCEPT}
        multiple
        hidden
        onChange={handleChange}
      />

      {status?.message ? (
        <div className={`upload-status ${status.type || 'info'}`}>
          {status.message}
          {status.action ? (
            <> <button type="button" className="link-btn" onClick={status.action.onClick}>{status.action.label}</button></>
          ) : null}
        </div>
      ) : null}

      {layers?.length ? (
        <div className="upload-summary">
          <div className="upload-summary-title">Imported layers</div>
          <div className="upload-summary-list">
            {layers.map((layer) => (
              <div key={layer.id} className="upload-summary-item">
                <span>{layer.displayName || layer.name}</span>
                <small>{layer.sourceName}</small>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
