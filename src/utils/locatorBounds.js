import { geojsonBounds, unionBounds } from './geometry.js';
import { visibleGeojson } from './featureIdentity.js';
import { propertySubject } from './propertyNeighbours.js';

/** Keep regional context separate from the project-location marker. Only an
 * already selected, eligible Property & Neighbours subject narrows the marker.
 * No selection is inferred from file order, an owner name or a stale layer ID.
 */
export function locatorBounds(layers = [], layout = {}) {
  const source = layers || [];
  const contextBounds = unionBounds(source.filter((layer) => layer.visible !== false && layer.geojson)
    .map((layer) => geojsonBounds(visibleGeojson(layer))).filter(Boolean));
  if (layout.propertyNeighboursVersion !== 1 || !layout.primaryLayerId || layout.insetMode === 'custom_image') {
    return { contextBounds, markerBounds: contextBounds };
  }
  const subject = propertySubject({ layers: source, layout });
  const subjectBounds = subject?.id === layout.primaryLayerId ? geojsonBounds(visibleGeojson(subject)) : null;
  return { contextBounds, markerBounds: subjectBounds || contextBounds };
}
