import React, { useId, useMemo, useState } from 'react';
import { pointColumnSnapshot, summarizePointColumn } from '../utils/numericColumnSummary.js';

export default function NumericColumnSummary({ geojson, name }) {
  const id = useId();
  const [selection, setSelection] = useState(null);
  const snapshot = useMemo(() => pointColumnSnapshot(geojson), [geojson]);
  // A replaced source is a new population even if the layer ID stays the same.
  const field = selection?.source === geojson ? selection.field : null;
  const result = useMemo(() => summarizePointColumn(snapshot, field), [snapshot, field]);
  if (snapshot.error) return <p role="status">{snapshot.error}</p>;
  const { scope, fields } = snapshot;
  return <section aria-label="Numeric column summary" style={{ overflowWrap: 'anywhere' }}>
    <p><strong>{name}</strong> · Read only</p>
    <p className="small-note">{scope.points} Point records of {scope.total} feature records. Omitted: {scope.traces} derived traces, {scope.multiPoint} MultiPoint records, {scope.other} other records. All Point records are included, even if hidden on the map; duplicate IDs are not removed.</p>
    {!fields.length ? <p>No Point-record columns to inspect.</p> : <>
      <div className="control-row">
        <label htmlFor={id}>Column to inspect</label>
        <select id={id} value={field === null ? '' : String(fields.indexOf(field))} onChange={e => setSelection({ source: geojson, field: e.target.value === '' ? null : fields[Number(e.target.value)] })}>
          <option value="">Choose a column</option>
          {fields.map((key, index) => <option key={key} value={String(index)}>{key || '(empty column name)'}</option>)}
        </select>
      </div>
      {result && <div role="status" aria-live="polite">
        <p>{result.counts.numeric} of {result.counts.total} Point values are plain finite numbers.</p>
        <p>Excluded: {result.counts.blank} blank or missing; {result.counts.qualified} inequality-marked text; {result.counts.other} other nonnumeric values.</p>
        {result.statistics ? <table style={{ width: '100%' }} aria-label="Observed numeric values">
          <thead><tr><th scope="col">Statistic</th><th scope="col">Value</th></tr></thead>
          <tbody>{[['Minimum', 'minimum'], ['P10', 'p10'], ['P50', 'p50'], ['P90', 'p90'], ['Maximum', 'maximum']].map(([label, key]) =>
            <tr key={key}><th scope="row">{label}</th><td>{String(result.statistics[key])}</td></tr>)}</tbody>
        </table> : <p>No plain finite numbers in this column.</p>}
      </div>}
      <p className="small-note">Percentiles use nearest rank: sort included values ascending and take rank ceil(p × n), starting at 1. P50 is an observed value, not the average of two middle values.</p>
      <p className="small-note">Units and numeric codes are not interpreted: codes such as −999 remain numbers. Limits such as &lt;0.005, comma-formatted numbers and other text are excluded, not replaced. This describes the included column values, not a validated sample population or anomaly threshold.</p>
    </>}
  </section>;
}
