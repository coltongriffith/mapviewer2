import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadSharedMap } from '../utils/cloudStorage';
import { trackEvent } from '../utils/track';

const ReadOnlyMapStage = React.lazy(() => import('./ReadOnlyMapStage'));

// ?download=png opens the map and downloads it as a PNG: the link an AI
// assistant hands back with each map preview.
const autoDownload = () => {
  try { return new URLSearchParams(window.location.search).get('download') === 'png'; } catch { return false; }
};

export default function SharedMapViewer({ mapId, onExit, user, entitlements, onEditCopy }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [exporter, setExporter] = useState(null);
  const [download, setDownload] = useState(null); // null | 'working' | 'done' | 'failed'
  const autoStarted = useRef(false);

  const downloadPng = useCallback(async () => {
    if (!exporter || !project || download === 'working') return;
    setDownload('working');
    try {
      const { clamped } = await exporter.downloadPng(entitlements);
      setDownload('done');
      trackEvent('export_completed', { format: 'png', source: 'shared_link', mapId, resolution_clamped: clamped }, user?.id);
    } catch {
      setDownload('failed');
    }
  }, [exporter, project, download, entitlements, mapId, user?.id]);

  useEffect(() => {
    if (!exporter || autoStarted.current || !autoDownload()) return;
    autoStarted.current = true;
    downloadPng();
  }, [exporter, downloadPng]);

  const handleEdit = async () => {
    if (!project || editing) return;
    setEditing(true);
    try {
      await onEditCopy?.(project);
    } finally {
      // If onEditCopy navigated away this unmount-safe reset is harmless; if it
      // only opened the auth modal (signed-out), re-enable the button.
      setEditing(false);
    }
  };

  useEffect(() => {
    if (!mapId) { setError('No map ID provided'); setLoading(false); return; }
    // Cancellation guard: if mapId changes or the viewer unmounts while the
    // load is in flight, the stale completion must not touch state.
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadSharedMap(mapId)
      .then(state => {
        if (cancelled) return;
        if (!state) { setError('not_found'); setLoading(false); return; }
        setProject(state);
        setLoading(false);
        // mapId alone joins this view (and any fork that follows) back to the
        // share_created event; no sharer session id travels in the URL.
        trackEvent('share_viewed', { mapId }, user?.id);
      })
      // A service/network failure must NOT read as "this link was removed" —
      // that hides incidents and misleads the viewer (audit P1-04).
      .catch(() => { if (!cancelled) { setError('unavailable'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mapId]);

  if (loading) {
    return (
      <div className="shared-map-loading">
        <div className="shared-map-spinner" />
        Loading map…
      </div>
    );
  }

  if (error) {
    const unavailable = error === 'unavailable';
    return (
      <div className="shared-map-error">
        <div className="shared-map-error-icon">🗺</div>
        <h2>{unavailable ? 'Couldn’t load this map' : 'Map not available'}</h2>
        <p>
          {unavailable
            ? 'We couldn’t reach the server. The link may still be fine — check your connection and try again.'
            : 'This link is invalid, has expired, or was revoked by its owner.'}
        </p>
        <div className="shared-map-bar-actions">
          {unavailable && (
            <button className="shared-map-edit-btn" onClick={() => window.location.reload()}>Try again</button>
          )}
          <button className="shared-map-cta-btn" onClick={onExit}>Go to ExplorationMaps</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shared-map-viewer">
      <div className="shared-map-canvas-wrap">
        <React.Suspense fallback={<div className="shared-map-loading"><div className="shared-map-spinner" />Loading map…</div>}>
          <ReadOnlyMapStage project={project} onExportReady={setExporter} />
        </React.Suspense>
      </div>
      <div className="shared-map-bar">
        <span className="shared-map-bar-brand">
          Made with <a href="/" rel="noopener">ExplorationMaps</a>
        </span>
        <div className="shared-map-bar-actions">
          {download === 'failed' && <span className="shared-map-bar-note" role="alert">The PNG could not be made. Try again, or use Edit this map → Export.</span>}
          <button className="shared-map-edit-btn" onClick={downloadPng} disabled={!exporter || download === 'working'}>
            {download === 'working' ? 'Preparing PNG…' : download === 'done' ? 'Download PNG again' : 'Download PNG'}
          </button>
          <button className="shared-map-edit-btn" onClick={handleEdit} disabled={editing}>
            {editing ? 'Opening…' : (user ? 'Edit this map' : 'Make your own copy — free, no signup')}
          </button>
          <button className="shared-map-cta-btn" onClick={onExit}>
            Create your own map →
          </button>
        </div>
      </div>
    </div>
  );
}
