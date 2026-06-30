import React, { useRef, useState } from 'react';
import { useFileParser } from '../hooks/useFileParser';

const ACCEPTED = '.geojson,.json,.kml,.kmz,.zip';

export default function ClaimsFileUpload({ onImport, onBack }) {
  const { parseFile, parsing, error: parseError, setError } = useFileParser();
  const [preview, setPreview] = useState(null); // { geojson, name, count }
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    setPreview(null);
    setError(null);
    const geojson = await parseFile(file);
    if (!geojson) return;
    const featureCount = geojson.features?.length ?? (geojson.type === 'Feature' ? 1 : 0);
    if (!featureCount) {
      setError('File parsed but contained no valid geometry.');
      return;
    }
    const name = file.name.replace(/\.(zip|geojson|json|kml|kmz)$/i, '');
    setPreview({ geojson, name, count: featureCount });
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected after a clear
    e.target.value = '';
  }

  function handleAdd() {
    if (!preview) return;
    onImport(preview.geojson, preview.name);
  }

  return (
    <>
      <h3 className="export-hd-title">Upload File</h3>
      <p className="export-hd-desc">Load claim boundaries from a local file.</p>

      <div
        className={`claims-dropzone${dragOver ? ' drag-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Upload claim boundaries file (GeoJSON, KML, or zipped shapefile)"
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
        {parsing ? (
          <>
            <span className="claims-dropzone-spinner" />
            Parsing file…
          </>
        ) : (
          <>
            <span style={{ fontSize: 28 }}>📂</span>
            Drop file here or <strong>click to browse</strong>
          </>
        )}
        <span className="claims-dropzone-hint">GeoJSON · KML · KMZ · Shapefile (.zip)</span>
      </div>

      {parseError && <p className="claims-error">⚠ {parseError}</p>}

      {preview && !parseError && (
        <div className="claims-preview-block">
          <span className="claims-preview-count">
            ✓ {preview.count} feature{preview.count !== 1 ? 's' : ''} found in "{preview.name}"
          </span>
          <button className="share-generate-btn" onClick={handleAdd}>
            Add to map
          </button>
        </div>
      )}

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
