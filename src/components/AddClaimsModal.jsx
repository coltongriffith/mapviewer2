import React, { useState } from 'react';
import BCRegistrySearch from './BCRegistrySearch';
import ClaimsFileUpload from './ClaimsFileUpload';

export default function AddClaimsModal({ onClose, onImport, defaultPath = null }) {
  const [path, setPath] = useState(defaultPath); // null | 'registry' | 'upload'

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className="claims-modal-card">
        <button className="export-hd-close" onClick={onClose} aria-label="Close">✕</button>

        {!path && (
          <>
            <div className="share-modal-icon-wrap" style={{ fontSize: 22 }}>🗺</div>
            <h3 className="export-hd-title">Add Claims</h3>
            <p className="export-hd-desc">
              Load BC mineral claim boundaries onto your map — search the live registry or upload a file.
            </p>
            <div className="claims-path-row">
              <button className="claims-path-btn" onClick={() => setPath('registry')}>
                <span className="claims-path-icon">🔍</span>
                <strong>Search BC Registry</strong>
                <span>Find claims by company name</span>
              </button>
              <button className="claims-path-btn" onClick={() => setPath('upload')}>
                <span className="claims-path-icon">📁</span>
                <strong>Upload File</strong>
                <span>KML, KMZ, Shapefile, GeoJSON</span>
              </button>
            </div>
          </>
        )}

        {path === 'registry' && (
          <BCRegistrySearch
            onImport={(items) => {
              // items is [{geojson, name}, ...] — one entry per geographic group
              items.forEach(({ geojson, name }) => onImport(geojson, name));
              onClose();
            }}
            onBack={() => setPath(null)}
          />
        )}

        {path === 'upload' && (
          <ClaimsFileUpload
            onImport={(geojson, name) => { onImport(geojson, name); onClose(); }}
            onBack={() => setPath(null)}
          />
        )}
      </div>
    </div>
  );
}
