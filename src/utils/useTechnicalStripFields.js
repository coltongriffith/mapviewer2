import { useEffect, useState } from 'react';
import { resolveTitleStripFields } from '../templates/technicalReportTemplate.js';
import { autoProjectionName, formatScaleDenom, scaleDenomFromMap } from './geo.js';

// Read-only maps can still pan/zoom. Refresh at completed movements (not every
// animation frame) so title metadata, ScaleBar and export describe the same view.
export function useTechnicalStripFields(map, layout) {
  const [, refresh] = useState(0);
  const enabled = layout?.templateId === 'ni_43101_technical' && layout?.technicalReportVersion === 1;
  useEffect(() => {
    if (!map || !enabled) return undefined;
    const update = () => refresh((revision) => revision + 1);
    map.on('moveend zoomend', update);
    return () => map.off('moveend zoomend', update);
  }, [map, enabled]);
  return resolveTitleStripFields(layout, {
    scaleText: formatScaleDenom(scaleDenomFromMap(map)),
    projectionText: autoProjectionName(map),
  });
}
