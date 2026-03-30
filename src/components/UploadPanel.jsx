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
      <div className="upload-header-row">
        <h2>Upload</h2>
        <div className="hover-help">
          <button className="hover-help-trigger" type="button" aria-label="What is a shapefile?">i</button>
          <div className="hover-help-tooltip">
            A shapefile usually comes as multiple files used together. Upload one <code>.zip</code> that contains the main parts like <code>.shp</code>, <code>.shx</code>, <code>.dbf</code>, and often <code>.prj</code>. You can also upload <code>.geojson</code> or <code>.json</code> directly.
          </div>
        </div>
      </div>
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
