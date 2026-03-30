import React, { useMemo, useState } from 'react';

function formatAccepted() {
  return '.zip, .geojson, .json';
}

export default function UploadPanel({ onUploadFile, inputRef, status, layers }) {
  const [dragging, setDragging] = useState(false);
  const accepted = useMemo(() => formatAccepted(), []);

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await onUploadFile(file);
    }
  };

  return (
    <section className="control-section">
      <h2>Upload</h2>
      <div
        className={`upload-dropzone ${dragging ? 'dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
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
        <small>Accepted: {accepted}</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accepted}
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await onUploadFile(file);
          event.target.value = '';
        }}
      />

      <div className="info-note">
        <strong>What is a shapefile?</strong>
        <p>
          A shapefile is usually a set of files that work together. For this app, zip the shapefile parts into one
          <code>.zip</code> before uploading. A typical shapefile zip includes <code>.shp</code>, <code>.shx</code>,
          <code>.dbf</code>, and often <code>.prj</code>.
        </p>
        <p>GeoJSON files can be uploaded directly as <code>.geojson</code> or <code>.json</code>.</p>
      </div>

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
