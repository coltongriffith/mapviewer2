import React, { useEffect, useState } from 'react';
import { loadSharedMap } from '../utils/cloudStorage';
import { trackEvent } from '../utils/track';

const ReadOnlyMapStage = React.lazy(() => import('./ReadOnlyMapStage'));

export default function SharedMapViewer({ mapId, onExit, user, onEditCopy }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

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
        // ?ref carries the sharer's session id — joins this view (and any fork
        // that follows) back to the share_created event.
        let ref = null;
        try { ref = new URLSearchParams(window.location.search).get('ref'); } catch { /* noop */ }
        trackEvent('share_viewed', { mapId, ref }, user?.id);
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
          <ReadOnlyMapStage project={project} />
        </React.Suspense>
      </div>
      <div className="shared-map-bar">
        <span className="shared-map-bar-brand">
          Made with <a href="/" rel="noopener">ExplorationMaps</a>
        </span>
        <div className="shared-map-bar-actions">
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
