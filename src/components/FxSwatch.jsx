import React, { useId } from 'react';
import { swatchPrims, paintFxSvg } from '../utils/geoStyle.js';

// A legend swatch for a layer with geology styling (layer.fx) on the editor stage and the shared map: the
// exporters' own swatch primitives (utils/geoStyle.js), so the glow, casing, dash, teeth, feather or plume the
// row shows is the one the PNG and SVG legends draw.
export default function FxSwatch({ item, width, height }) {
  const prefix = `fx-sw-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const defs = [];
  const body = paintFxSvg(swatchPrims(item, 0, 0, width, height), 1, defs, { prefix, W: width, H: height });
  return (
    <svg className="legend-fx-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
      // Markup from the swatch painter: colours checked against a hex pattern, numbers formatted, nothing else.
      dangerouslySetInnerHTML={{ __html: `${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}` }} />
  );
}
