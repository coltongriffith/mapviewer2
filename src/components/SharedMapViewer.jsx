import React, { useEffect, useState, useMemo } from 'react';
import { loadSharedMap } from '../utils/cloudStorage';
import { getTemplate } from '../templates';
import { fitProjectToTemplate } from '../utils/frameMapForTemplate';

const MapCanvas = React.lazy(() => import('./MapCanvas'));

export default function SharedMapViewer({ mapId, onExit }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapInstance, setMapInstance] = useState(null);

  useEffect(() => {
    if (!mapId) { setError('No map ID provided'); setLoading(false); return; }
    loadSharedMap(mapId)
      .then(state => {
        if (!state) { setError('not_found'); setLoading(false); return; }
        setProject(state);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [mapId]);

  const template = useMemo(() => {
    if (!project) return null;
    return getTemplate(project.layout?.templateId || 'technical_results_v2');
  }, [project]);

  // Fit to claims/focus layers once both map and project data are available
  useEffect(() => {
    if (!mapInstance || !project || !template) return;
    fitProjectToTemplate(project, mapInstance, { ...template }, 'balanced', { focusRoles: true });
  }, [mapInstance, project, template]);

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
        <React.Suspense fallback={null}>
          <MapCanvas
            onReady={(m) => setMapInstance(m)}
            project={project}
            template={template}
            onFeatureClick={null}
            onMapClick={null}
            annotationToolRef={{ current: null }}
          />
        </React.Suspense>
      </div>
      <div className="shared-map-bar">
        <span className="shared-map-bar-brand">
          Made with <a href="/" rel="noopener">ExplorationMaps</a>
        </span>
        <button className="shared-map-cta-btn" onClick={onExit}>
          Create your own map →
        </button>
      </div>
    </div>
  );
}
