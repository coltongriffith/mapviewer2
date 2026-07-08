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
    loadSharedMap(mapId)
      .then(state => {
        if (!state) { setError('not_found'); setLoading(false); return; }
        setProject(state);
        setLoading(false);
        // ?ref carries the sharer's session id — joins this view (and any fork
        // that follows) back to the share_created event.
        let ref = null;
        try { ref = new URLSearchParams(window.location.search).get('ref'); } catch { /* noop */ }
        trackEvent('share_viewed', { mapId, ref }, user?.id);
      })
      .catch(e => { setError(e.message); setLoading(false); });
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
    return (
      <div className="shared-map-error">
        <div className="shared-map-error-icon">🗺</div>
        <h2>{error === 'not_found' ? 'Map not found' : 'Something went wrong'}</h2>
        <p>{error === 'not_found' ? 'This shared map link may be invalid or has been removed.' : error}</p>
        <button className="shared-map-cta-btn" onClick={onExit}>Go to ExplorationMaps</button>
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
            {editing ? 'Opening…' : (user ? 'Edit this map' : 'Sign in to edit')}
          </button>
          <button className="shared-map-cta-btn" onClick={onExit}>
            Create your own map →
          </button>
        </div>
      </div>
    </div>
  );
}
