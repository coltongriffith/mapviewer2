import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { loadSharedMap } from '../utils/cloudStorage';
import { trackEvent } from '../utils/track';
import { lazyGuarded } from '../utils/preloadGuard';
import { embedLayers, embedReferrer } from '../utils/embedCode';
import { getTemplate } from '../templates';
import { buildLegendItems } from '../templates/technicalResultsTemplate';
import { applyLegendCustomization, groupLegendItems } from '../utils/legendCustomization.js';
import { fitProjectToTemplate } from '../utils/frameMapForTemplate';
import { savedViewFor, zoomForSize } from '../utils/savedView';
import { LegendPointSwatch, LegendLineSwatch, LegendAreaSwatch } from './LegendSwatches.jsx';
import AnnotationOverlay from './AnnotationOverlay';
import CalloutsOverlay from './CalloutsOverlay';
import { useLazyDrillLegend } from '../utils/useDrillLegend.js';
import '../styles/embed-map.css';

const MapCanvas = lazyGuarded(() => import('./MapCanvas'));
const DrillPlanOverlay = lazyGuarded(() => import('./DrillPlanOverlay'));
const layerName = (l) => l.displayName || l.legend?.label || l.name || 'Layer';
const swatch = (item) => (item.type === 'points' ? <LegendPointSwatch style={item.style} size={14} />
  : item.type === 'line' ? <LegendLineSwatch style={item.style} fx={item.fx} /> : <LegendAreaSwatch style={item.style} fx={item.fx} />);

// The live investor web map (/embed/map/<share id>): a shared map, read afresh on every load so a republished link
// updates every site that embeds it. Chrome-less: pan and zoom, layer switches, the legend, claim records on click,
// the company logo and an attribution line. No editor code.
export default function EmbedMapPage({ shareId }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [map, setMap] = useState(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!shareId) { setError('not_found'); return undefined; }
    loadSharedMap(shareId).then((state) => {
      if (cancelled) return;
      if (!state) { setError('not_found'); return; }
      setProject({ ...state, layers: embedLayers(state.layers) });
      const referrer = embedReferrer();
      trackEvent('share_viewed', { mapId: shareId, embed: true, ...(referrer ? { referrer } : {}) });
    }).catch(() => { if (!cancelled) setError('unavailable'); });
    return () => { cancelled = true; };
  }, [shareId]);

  const layout = useMemo(() => project?.layout || {}, [project]);
  const template = useMemo(() => getTemplate(layout.templateId || 'technical_results_v2'), [layout.templateId]);
  const toggleable = useMemo(() => (project?.layers || []).filter((l) => l.visible !== false && (l.geojson || l.raster)), [project]);
  const shown = useMemo(() => project && { ...project, layers: project.layers.map((l) => (hidden.has(l.id) ? { ...l, visible: false } : l)) }, [project, hidden]);
  const drillLegend = useLazyDrillLegend(project?.drillPlan);
  const legendGroups = useMemo(() => {
    if (!shown) return [];
    return groupLegendItems(applyLegendCustomization([...buildLegendItems(template, shown.layers, layout), ...drillLegend], layout), layout);
  }, [shown, template, layout, drillLegend]);
  const swatches = useMemo(() => new Map(legendGroups.flatMap((g) => g.items).map((i) => [i.id, i])), [legendGroups]);

  useEffect(() => {
    if (!map || !project || fitted.current) return;
    fitted.current = true;
    L.control.zoom({ position: 'topright' }).addTo(map);
    // Scrolling the host page must not zoom the map until the reader engages with it.
    map.scrollWheelZoom.disable();
    map.once('click focus', () => map.scrollWheelZoom.enable());
    const view = savedViewFor(project);
    if (view) {
      const el = map.getContainer();
      map.setView([view.center.lat, view.center.lng], zoomForSize(view, el.offsetWidth, el.offsetHeight), { animate: false });
    } else fitProjectToTemplate(project, map, template, 'balanced', { focusRoles: true });
  }, [map, project, template]);

  if (error) {
    return <div className="embed-map embed-map--message" role="alert">
      <p>{error === 'unavailable' ? 'This map could not be loaded right now. Try again shortly.' : 'This map is not available.'}</p>
      <a href="/" target="_blank" rel="noopener">ExplorationMaps</a>
    </div>;
  }
  if (!shown) return <div className="embed-map embed-map--message" role="status"><div className="shared-map-spinner" />Loading map…</div>;

  const toggle = (id) => setHidden((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div className="embed-map">
      <div className="embed-map-canvas">
        <React.Suspense fallback={null}>
          <MapCanvas onReady={setMap} project={shown} template={template} onFeatureClick={null} onMapClick={null} annotationToolRef={{ current: null }} />
        </React.Suspense>
        {map && <AnnotationOverlay map={map} markers={shown.markers || []} ellipses={shown.ellipses || []} polygons={shown.polygons || []}
          distanceLines={shown.distanceLines || []} labelFont={layout.fonts?.label} />}
        {map && shown.drillPlan && <React.Suspense fallback={null}>
          <DrillPlanOverlay map={map} plan={shown.drillPlan} layout={layout} />
        </React.Suspense>}
        {map && <CalloutsOverlay map={map} callouts={shown.callouts || []} selectedCalloutId={null} onSelect={null} onMove={null}
          onUpdate={null} fontFamily={layout.fonts?.callout} layout={layout} />}
      </div>
      <button type="button" className="embed-map-toggle" aria-expanded={panelOpen} aria-controls="embed-map-panel" onClick={() => setPanelOpen((o) => !o)}>
        {panelOpen ? 'Hide layers' : 'Layers'}
      </button>
      {panelOpen && (
        <aside id="embed-map-panel" className="embed-map-panel" aria-label="Map layers and legend">
          {layout.title && <h1 className="embed-map-title">{layout.title}</h1>}
          {toggleable.length > 0 && <fieldset className="embed-map-layers">
            <legend>Layers</legend>
            {toggleable.map((l) => (
              <label key={l.id}>
                <input type="checkbox" checked={!hidden.has(l.id)} onChange={() => toggle(l.id)} />
                {swatches.get(l.id) ? swatch(swatches.get(l.id)) : <span className="embed-map-swatch" />}
                <span>{layerName(l)}</span>
              </label>
            ))}
          </fieldset>}
          {legendGroups.length > 0 && layout.showLegend !== false && <section className="embed-map-legend" aria-label="Legend">
            <h2>{layout.legendTitle || 'Legend'}</h2>
            {legendGroups.map((g) => (
              <div key={g.heading || 'all'}>
                {g.heading && <div className="embed-map-group">{g.heading}</div>}
                {g.items.map((item) => <div key={item.id} className="embed-map-item">{swatch(item)}<span>{item.label}</span></div>)}
              </div>
            ))}
          </section>}
        </aside>
      )}
      {layout.logo && <img className="embed-map-logo" src={layout.logo} alt={layout.companyName || 'Company logo'} />}
      <div className="embed-map-attribution">
        {layout.companyName && <span>{layout.companyName}</span>}
        {shown.layers.some((l) => l.claimInfo) && <span>Claims from public registries; not a legal survey.</span>}
        <a href="/?utm_source=embed" target="_blank" rel="noopener">Made with ExplorationMaps</a>
      </div>
    </div>
  );
}
