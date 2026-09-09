import React, { useState } from 'react';

const MULTI_ACCEPT = '.zip,.shp,.dbf,.prj,.shx,.geojson,.json,.kml,.kmz,.csv,.png,.jpg,.jpeg,.gif,.webp,.pgw,.jgw,.wld,.tfw';

// A shapefile's parts, or an image with its world file, travel together.
const needsGroup = (files) => files.some((f) => /\.(shp|pgw|jgw|jpgw|wld|tfw|pngw|gfw)$/i.test(f.name));

export default function UploadPanel({ onUploadFile, onUploadFiles, inputRef, status, layers }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;

    if (files.length > 1 && needsGroup(files) && onUploadFiles) {
      await onUploadFiles(files);
    } else {
      await onUploadFile(files[0]);
    }
  };

  const handleChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    if (files.length > 1 && needsGroup(files) && onUploadFiles) {
      await onUploadFiles(files);
    } else {
      await onUploadFile(files[0]);
    }
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
