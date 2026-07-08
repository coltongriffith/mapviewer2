import React, { useState } from 'react';
import RegistrySearch from './RegistrySearch';
import ClaimsFileUpload from './ClaimsFileUpload';

export default function AddClaimsModal({ onClose, onImport, defaultPath = null, initialProvince = null }) {
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
              Load mineral claim boundaries onto your map — search a live provincial registry or upload a file.
            </p>
            <div className="claims-path-row">
              <button className="claims-path-btn" onClick={() => setPath('registry')}>
                <span className="claims-path-icon">🔍</span>
                <strong>Search Claims Registry</strong>
                <span>BC · Ontario · Quebec · Saskatchewan · Manitoba · Newfoundland · Yukon</span>
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
          <RegistrySearch
            initialProvince={initialProvince}
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
