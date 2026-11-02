import React, { useEffect, useState } from 'react';
import { createClaimKeySnapshot, resolveClaimKeySnapshot } from '../utils/claimKeyCandidates.js';

const messages = {
  'select-property': 'Choose a visible claims layer as the property framing layer first.',
  'select-identifier-field': 'Choose the column containing your supplied claim identifiers.',
  'incomplete-identifiers': 'Every retained claim needs a short text or whole-number identifier in this column.',
  'duplicate-identifiers': 'This column contains repeated identifiers. Choose a unique identifier column.',
  'duplicate-feature-identity': 'Some shapes share the same source identity. Resolve those duplicates before creating a key.',
  'supplied-identity-required': 'Each shape needs a supplied source identity; geometry alone cannot identify a key row.',
  'feature-limit': 'Use a claims layer with at most 5,000 source shapes.',
  'row-limit': 'Keep at most 200 retained claims in one key. Split the map or remove unneeded shapes.',
  'rebuild-key': 'The selected property or its identifiers changed. Rebuild the key to update its references.',
  'invalid-key': 'This saved key needs to be rebuilt.',
  'no-visible-claims': 'There are no retained claims to locate.',
  'no-key-space': 'No clear space fits the key. Zoom in or move map furniture, or use fewer claims.',
  'polygon-required': 'A claim key needs polygon claim shapes.',
};

export default function ClaimKeyControls({ project, layer, fields, setProject, map }) {
  const saved = project.layout?.claimKey;
  const ownKey = saved?.layerId === layer.id;
  const eligible = project.layout?.propertyNeighboursVersion === 1 && project.layout.primaryLayerId === layer.id
    && layer.role === 'claims' && layer.visible !== false && layer.focus !== false;
  const [field, setField] = useState(ownKey ? saved.field : '');
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  useEffect(() => { setField(ownKey ? saved.field : ''); setError(''); }, [layer.id, ownKey, saved?.field]);
  useEffect(() => {
    setReport(map?.emFxReport?.claimKey || null);
    if (!map) return undefined;
    const onReport = (event) => setReport(event.claimKey || null);
    map.on('emfxreport', onReport);
    return () => map.off('emfxreport', onReport);
  }, [map, saved]);
  if (!eligible && !ownKey) return null;
  const validation = ownKey ? resolveClaimKeySnapshot(project, saved) : null;
  const reason = error || (validation && !validation.ok ? validation.reason : report && ownKey && !report.ok ? report.reason : '');
  const create = () => {
    const result = createClaimKeySnapshot(project, field, { maxRows: 200 });
    setError(result.ok ? '' : result.reason);
    if (!result.ok) return;
    setProject((prev) => {
      if (prev.layout.primaryLayerId !== layer.id) return prev;
      const next = createClaimKeySnapshot(prev, field, { maxRows: 200 });
      return next.ok ? { ...prev, layout: { ...prev.layout, claimKey: next.snapshot } } : prev;
    });
  };
  return <details className="claim-key-controls">
    <summary>Compact claim key</summary>
    <p className="small-note">Use short map references with a table of your supplied identifiers. Existing labels and source data stay intact.</p>
    <label htmlFor={`claim-key-field-${layer.id}`}>Source identifier column</label>
    <select id={`claim-key-field-${layer.id}`} value={field} onChange={(event) => { setField(event.target.value); setError(''); }}>
      <option value="">Choose a column…</option>
      {fields.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <button type="button" onClick={create} disabled={!eligible || !field}>{ownKey ? 'Rebuild claim key' : 'Create claim key'}</button>
    {ownKey && <button type="button" onClick={() => setProject((prev) => prev.layout.claimKey?.layerId === layer.id
      ? { ...prev, layout: { ...prev.layout, claimKey: null } } : prev)}>Remove claim key</button>}
    {reason && <p role="status" className="small-note">{messages[reason] || 'The key cannot be drawn completely. Rebuild it or make more map space.'}</p>}
    {!reason && ownKey && report?.ok && <p role="status" className="small-note">{report.notice}</p>}
  </details>;
}
