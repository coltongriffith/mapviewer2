import React, { Suspense, useState } from 'react';
import { lazyGuarded } from '../utils/preloadGuard';

const NumericColumnSummary = lazyGuarded(() => import('./NumericColumnSummary.jsx'));

function Inspector({ geojson, name }) {
  const [open, setOpen] = useState(false);
  return <details className="sub-details" style={{ marginTop: 8 }} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Inspect numeric columns</summary>
    {open && <div className="sub-details-body"><Suspense fallback={<p role="status">Loading column inspector…</p>}>
      <NumericColumnSummary geojson={geojson} name={name} />
    </Suspense></div>}
  </details>;
}

// No project setter is accepted. Switching layers discards open/column state;
// closing unmounts the data reader, so unrelated editor changes do no scanning.
export default function NumericColumnInspector({ layer }) {
  return <Inspector key={layer.id} geojson={layer.geojson} name={layer.displayName || layer.name || 'Selected layer'} />;
}
