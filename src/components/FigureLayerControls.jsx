import React from 'react';

// The inspector rows for a layer made from an imported company figure: its
// credit line (shared by every layer from the same figure, so editing it here
// edits theirs) and, on the figure itself, the way back into the fit.

export default function FigureLayerControls({ layer, setProject, onEdit }) {
  const figure = layer.figure || {};
  const georef = layer.raster?.georef;
  const setCredit = (credit) => setProject((prev) => ({
    ...prev, layers: prev.layers.map((l) => (l.figure?.id === figure.id ? { ...l, figure: { ...l.figure, credit } } : l)),
  }));
  return (
    <div className="control-grid fig-layer-controls">
      <div className="control-row">
        <label htmlFor={`f-fig-credit-${layer.id}`}>Credit line (printed on exports)</label>
        <input id={`f-fig-credit-${layer.id}`} value={figure.credit || ''} placeholder="e.g. Geology (simplified) after Tower Fig. 1 (15 Oct 2026)"
          onChange={(e) => setCredit(e.target.value)} />
      </div>
      {georef ? (
        <>
          <p className="small-note">
            Placed by {georef.points?.length || 0} points · {georef.kind === 'affine' ? 'affine' : georef.kind === 'north-up' ? 'north-up' : 'similarity'} fit
            {Number.isFinite(georef.rms) ? ` · RMS ${georef.rms < 10 ? georef.rms.toFixed(1) : Math.round(georef.rms)} m` : ''}
          </p>
          <button className="secondary-btn" type="button" onClick={onEdit}>Edit georeference / trace colours…</button>
        </>
      ) : (
        <p className="small-note">Traced from {figure.source || 'an imported figure'}. Edit its shapes like any other layer.</p>
      )}
    </div>
  );
}
