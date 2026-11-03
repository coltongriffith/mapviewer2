import React, { useCallback, useId, useRef, useState } from 'react';
import { lazyGuarded } from '../utils/preloadGuard';
import RegistrySearch from './RegistrySearch';
import { US_CLAIMS_ENABLED } from '../utils/jurisdictions';
import Dialog from './Dialog';

const ClaimsFileUpload = lazyGuarded(() => import('./ClaimsFileUpload'));

export default function AddClaimsModal({ onClose, onImport, onCSVFile, defaultPath = null, initialProvince = null, initialQuery = '', autoSearch = false, initialMode = null }) {
  const [path, setPath] = useState(defaultPath); // null | 'registry' | 'upload'
  const titleId = useId();
  const returnFocus = useRef(document.activeElement);
  const close = useCallback(() => {
    onClose();
    queueMicrotask(() => {
      // A successful import may have opened the next mapping dialog already.
      if (document.activeElement?.closest('[role="dialog"]')) return;
      const visible = (el) => {
        if (!el?.isConnected || el.disabled || el.closest('[hidden],[inert]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
      };
      [returnFocus.current, document.getElementById('ins-tab-data'), document.querySelector('button.ed-mobile-only[aria-expanded]')].find(visible)?.focus();
    });
  }, [onClose]);

  return (
    <Dialog onClose={close} labelledBy={titleId} className="export-hd-overlay" panelClassName="claims-modal-card">
        <span id={titleId} hidden>{path === 'registry' ? 'Claims Registry Search' : path === 'upload' ? 'Upload Claims' : 'Add Claims'}</span>
        <button className="export-hd-close" onClick={close} aria-label="Close">✕</button>

        {!path && (
          <>
            <div className="share-modal-icon-wrap" style={{ fontSize: 22 }}>🗺</div>
            <h3 className="export-hd-title">Add Claims</h3>
            <p className="export-hd-desc">
              Load mineral claim boundaries onto your map — search a live claims registry or upload a file.
            </p>
            <div className="claims-path-row">
              <button className="claims-path-btn" onClick={() => setPath('registry')}>
                <span className="claims-path-icon">🔍</span>
                <strong>Search Claims Registry</strong>
                <span>{US_CLAIMS_ENABLED
                  ? 'Canada: BC · ON · QC · SK · MB · NL · Yukon  ·  U.S.: 11 western states (federal BLM)'
                  : 'BC · Ontario · Quebec · Saskatchewan · Manitoba · Newfoundland · Yukon'}</span>
              </button>
              <button className="claims-path-btn" onClick={() => setPath('upload')}>
                <span className="claims-path-icon">📁</span>
                <strong>Upload File</strong>
                <span>KML, KMZ, Shapefile, GeoJSON{onCSVFile ? ', CSV' : ''}</span>
              </button>
            </div>
          </>
        )}

        {path === 'registry' && (
          <RegistrySearch
            initialProvince={initialProvince}
            initialQuery={initialQuery}
            autoSearch={autoSearch}
            initialMode={initialMode}
            onImport={(items) => {
              // items is [{geojson, name, provenance}, ...] — one entry per
              // geographic group. provenance carries degraded-scoping and
              // auto-adopted-jurisdiction attribution onto the layer.
              items.forEach(({ geojson, name, provenance }) => onImport(geojson, name, provenance));
              close();
            }}
            onBack={() => setPath(null)}
          />
        )}

        {path === 'upload' && (
          <React.Suspense fallback={<p role="status">Opening file upload…</p>}>
            <ClaimsFileUpload
              onImport={(geojson, name) => { onImport(geojson, name, undefined, 'upload'); close(); }}
              onCSVFile={onCSVFile}
              onBack={() => setPath(null)}
            />
          </React.Suspense>
        )}
    </Dialog>
  );
}
