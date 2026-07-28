import React, { useRef, useState } from 'react';
import { useFileParser, SUPPORTED_CRS } from '../hooks/useFileParser';

const ACCEPTED = '.geojson,.json,.kml,.kmz,.zip';

export default function ClaimsFileUpload({ onImport, onBack }) {
  const { parseFile, parsing, error: parseError, setError, needsCRS, setNeedsCRS } = useFileParser();
  const [preview, setPreview] = useState(null); // { geojson, name, count, crs }
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [chosenCRS, setChosenCRS] = useState('');
  const inputRef = useRef(null);

  async function handleFile(file, opts) {
    setPreview(null);
    setError(null);
    const geojson = await parseFile(file, opts);
    if (!geojson) {
      // parseFile sets needsCRS when it cannot safely determine the CRS.
      setPendingFile(file);
      return;
    }
    const featureCount = geojson.features?.length ?? (geojson.type === 'Feature' ? 1 : 0);
    if (!featureCount) {
      setError('File parsed but contained no valid geometry.');
      return;
    }
    const name = file.name.replace(/\.(zip|geojson|json|kml|kmz)$/i, '');
    setPreview({ geojson, name, count: featureCount, crs: geojson.__crs?.from || null });
    setPendingFile(null);
    setNeedsCRS(null);
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

      {/* No silent guessing: a projected file with no declared CRS stops here
          until the user says what it is. Placing exploration data in the wrong
          country is worse than one extra question. */}
      {needsCRS && pendingFile && (
        <div className="claims-preview-block">
          <label className="auth-label" htmlFor="crs-pick">
            Coordinate system of "{pendingFile.name}"
            <select
              id="crs-pick"
              className="auth-input"
              value={chosenCRS}
              onChange={(e) => setChosenCRS(e.target.value)}
            >
              <option value="">Select…</option>
              {SUPPORTED_CRS.filter((c) => c.projected).map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </label>
          <button
            className="share-generate-btn"
            disabled={!chosenCRS}
            onClick={() => handleFile(pendingFile, { crs: chosenCRS })}
          >
            Convert and preview
          </button>
        </div>
      )}

      {preview && !parseError && (
        <div className="claims-preview-block">
          <span className="claims-preview-count">
            ✓ {preview.count} feature{preview.count !== 1 ? 's' : ''} found in "{preview.name}"
          </span>
          {preview.crs && (
            <span className="claims-dropzone-hint">Converted from {preview.crs} to WGS84.</span>
          )}
          <button className="share-generate-btn" onClick={handleAdd}>
            Add to map
          </button>
        </div>
      )}

      <button className="export-hd-skip" onClick={onBack}>← Back</button>
    </>
  );
}
