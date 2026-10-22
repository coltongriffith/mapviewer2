import React from 'react';
import { formatMetres } from '../utils/georef.js';

// The inspector rows for a layer made from an imported company figure: its
// credit line (shared by every layer from the same figure, so editing it here
// edits theirs) and, on the figure itself, the way back into the fit.

export default function FigureLayerControls({ layer, onUpdateFigure, onEdit }) {
  const figure = layer.figure || {};
  const georef = layer.raster?.georef;
  return (
    <div className="control-grid fig-layer-controls">
      <div className="control-row">
        <label htmlFor={`f-fig-credit-${layer.id}`}>Credit line (printed on exports)</label>
        <input id={`f-fig-credit-${layer.id}`} value={figure.credit || ''} placeholder="e.g. Geology (simplified) after Tower Fig. 1 (15 Oct 2026)"
          onChange={(e) => onUpdateFigure(figure.id, { credit: e.target.value })} />
      </div>
      {georef ? (
        <>
          <p className="small-note">
            Placed by {georef.points?.length || 0} points · {georef.kind === 'affine' ? 'affine' : georef.kind === 'north-up' ? 'north-up' : 'similarity'} fit
            {Number.isFinite(georef.rms) ? ` · RMS ${formatMetres(georef.rms)}` : ''}
          </p>
          <button className="secondary-btn" type="button" onClick={onEdit}>Edit georeference / trace colours…</button>
        </>
      ) : (
        <p className="small-note">Traced from {figure.source || 'an imported figure'}. Edit its shapes like any other layer.</p>
      )}
    </div>
  );
}
