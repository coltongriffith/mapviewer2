import React, { useEffect, useState } from 'react';
import { selectPropertyBoundaryLayer } from '../utils/propertyBoundaryInput.js';
import { Check } from './WashControls.jsx';

const messages = {
  'select-property': 'Select a visible property claims layer for framing first.',
  'no-visible-claims': 'No visible claims are available for this boundary.',
  'complexity-limit': 'This property is too complex for boundary emphasis. Individual claim outlines are unchanged.',
  'derived-complexity-limit': 'The combined outline is too complex. Individual claim outlines are unchanged.',
  'editing-source': 'Boundary emphasis pauses while individual claims are being trimmed or styled.',
  'stroke-hidden': 'The property stroke is hidden by its width or opacity setting.',
  'antimeridian-unsupported': 'Boundary emphasis is unavailable for a property crossing the date line.',
};

/** One contextual choice in existing layer controls; no new panel or defaults. */
export default function PropertyBoundaryControls({ project, layer, setProject, map }) {
  const enabled = project.layout?.propertyBoundaryOutline === true;
  const selected = selectPropertyBoundaryLayer(project,{ enabled: true });
  const eligible = selected.ok && selected.layer.id === layer.id;
  const [report, setReport] = useState(() => map?.emFxReport?.propertyBoundary);
  useEffect(() => {
    setReport(map?.emFxReport?.propertyBoundary);
    if (!map) return undefined;
    const update = (event) => setReport(event.propertyBoundary);
    map.on('emfxreport',update);
    return () => map.off('emfxreport',update);
  }, [map,project.layout?.primaryLayerId]);
  if (!eligible && !enabled) return null;

  const change = (next) => setProject((prev) => {
    // A queued click from an earlier map/layer selection cannot change a newly
    // loaded project, even if it happens to use the same selected layer ID.
    if (prev.layers !== project.layers || prev.layout?.primaryLayerId !== project.layout?.primaryLayerId
      || prev.layout?.propertyNeighboursVersion !== project.layout?.propertyNeighboursVersion) return prev;
    if (next) {
      const current = selectPropertyBoundaryLayer(prev,{ enabled: true });
      if (!current.ok || current.layer.id !== layer.id) return prev;
    }
    return { ...prev, layout: { ...prev.layout, propertyBoundaryOutline: next } };
  });
  const reason = !selected.ok ? selected.reason : report?.reason;
  return (
    <div className="property-boundary-controls">
      <Check label="Emphasize property boundary" checked={enabled} onChange={change} disabled={!eligible && !enabled} />
      {enabled ? <p className="small-note" role="status">{reason
        ? messages[reason] || 'Boundary emphasis is unavailable for this geometry. Individual claim outlines are unchanged.'
        : report?.ok ? 'Property boundary emphasized; individual claims remain selectable.' : 'Preparing the property boundary…'}</p>
        : <p className="small-note">Adds an outer stroke while keeping individual claims.</p>}
    </div>
  );
}
