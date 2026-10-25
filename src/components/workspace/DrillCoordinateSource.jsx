import React, { useEffect, useId, useState } from 'react';
import { DRILL_SOURCE_CRS, conversionMapping, previewSourceCoordinates, sourceCoordinateMapping, sourceCrs } from '../../utils/drillCoordinates';

const holes = (list) => `${list.slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''}`;
const METHOD = { projection: 'projection only', grid: 'grid shift', 'grid+null': 'grid shift, NAD83 = WGS84', helmert: '3-parameter shift', null: 'NAD83 = WGS84' };

export default function DrillCoordinateSource({ mapping, propertyCrs, jurisdiction, rows, onChange, onConverted }) {
  const listId = useId();
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const selected = sourceCrs(mapping.crs), target = sourceCrs(propertyCrs);
  const cs = mapping.coordinateSource;
  const canConvert = !!(selected && target && selected.code !== target.code);
  const converting = canConvert && cs?.operation === 'convert' && cs.target === target.code;
  useEffect(() => {
    let active = true;
    if (!converting) { setResult(null); onConverted?.(null); return undefined; }
    import('../../utils/datumConvert.js').then(m => m.convertCollars(rows, selected.code, target.code, { jurisdiction }))
      .then(r => { if (active) { setResult(r); onConverted?.({ ...r, input: rows }); } })
      .catch(e => { if (active) { setResult({ error: e.message }); onConverted?.(null); } });
    return () => { active = false; };
  }, [converting, rows, selected, target, jurisdiction, onConverted]);
  useEffect(() => {
    let active = true;
    setPreview(null); setError(null);
    if (showPreview && selected) previewSourceCoordinates(rows, selected.code)
      .then(result => { if (active) setPreview(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [showPreview, rows, selected]);
  return <section aria-label="Source coordinates" className="ws-stack">
    <label className="ws-field">Source coordinate system
      <input list={listId} value={mapping.crs || ''} placeholder="Search presets or enter EPSG:26910" onChange={e => onChange(sourceCoordinateMapping(mapping, e.target.value))} />
    </label>
    <datalist id={listId}>{DRILL_SOURCE_CRS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}</datalist>
    <p className="dash-muted" style={{ margin: 0 }}>{converting ? `Choose the file’s CRS. X/Y are converted to ${target.code}; elevation stays unchanged. The file’s X/Y and CRS are stored with each collar.` : 'Choose the file’s CRS. X/Y and elevation stay unchanged; no reprojection or datum shift.'}</p>
    {selected ? <p className="dash-muted" style={{ margin: 0 }}>{selected.label}. {selected.geographic ? 'X = longitude, Y = latitude, in decimal degrees.' : 'X = easting, Y = northing, in metres.'} Confirm against the source file.</p>
      : <p className="ws-notice">{mapping.crs ? 'This code is outside the preset catalog; preview is unavailable. You can still import its source values unchanged.' : 'No source CRS is recorded. For a local grid, leave this blank until its surveyed reference is known; do not assign an EPSG code by guessing.'} NAD83(CSRS) and other realizations need their own exact EPSG code.</p>}
    {propertyCrs && mapping.crs && propertyCrs.toUpperCase() !== mapping.crs.toUpperCase() && <p className="ws-notice">The property uses {propertyCrs}; this file uses {mapping.crs}. {converting ? 'This import converts the coordinates to the property CRS.' : 'This import keeps the file’s coordinates and CRS. Changing this label does not convert coordinates.'}</p>}
    {canConvert && <label><input type="checkbox" checked={converting} onChange={e => onChange(conversionMapping(mapping, target.code, e.target.checked))} /> Convert X/Y to the property’s {target.code} ({target.label}) on import; the file’s values are kept for audit</label>}
    {converting && <Conversion result={result} rows={rows} target={target} acknowledged={cs.acknowledged === true} onAcknowledge={ok => onChange({ ...mapping, coordinateSource: { ...cs, acknowledged: ok || undefined } })} />}
    {selected && <button type="button" className="btn" onClick={() => setShowPreview(s => !s)}>{showPreview ? 'Hide coordinate preview' : 'Preview source coordinates'}</button>}
    {showPreview && selected && <div aria-label="Coordinate preview" role="region">
      {selected.datum !== 'WGS84' && <p className="ws-notice">The preview stays in {selected.datum}; it is not a WGS84 map position. Accurate changes between datums require a verified transformation, including any required grid shifts.</p>}
      <p className="dash-muted">First {Math.min(5, rows.length)} valid collar rows. Geographic preview in {selected.datum}; imported X/Y below remain unchanged. This checks interpretation, not survey accuracy or the declared datum.</p>
      {error ? <p className="ws-error" role="alert">{error}</p> : !preview ? <p role="status">Preparing coordinate preview…</p> : <div className="ws-table-wrap"><table className="ws-table" aria-label="Source coordinate preview">
        <thead><tr><th>Hole</th><th>Imported X</th><th>Imported Y</th><th>Longitude ({selected.datum})</th><th>Latitude ({selected.datum})</th></tr></thead>
        <tbody>{preview.map(r => <tr key={r.hole_id}><td>{r.hole_id}</td><td>{r.x}</td><td>{r.y}</td>{r.issue ? <td colSpan={2}>{r.issue}</td> : <><td>{r.longitude.toFixed(6)}</td><td>{r.latitude.toFixed(6)}</td></>}</tr>)}</tbody>
      </table></div>}
    </div>}
  </section>;
}

function Conversion({ result, rows, target, acknowledged, onAcknowledge }) {
  if (!result) return <p role="status">Converting coordinates…</p>;
  if (result.error || !result.rows) return <p className="ws-error" role="alert">{result.error || `${result.failed.length} of ${rows.length} collars could not be converted (${holes(result.failed)}). Check the source CRS, columns and units.`}</p>;
  const { counts: c } = result, helmert = c.helmert > 0;
  const why = [result.outside.length && `outside the grid’s coverage: ${holes(result.outside)}`, ...result.unavailable,
    !result.region && 'the property has no country or province, so no national grid is chosen'].filter(Boolean);
  return <div className="ws-stack" role="region" aria-label="Coordinate conversion">
    <p className="dash-muted" style={{ margin: 0 }}>{c.grid > 0 && `${c.grid} with the ${result.grids.map(g => `${g}.gsb`).join(', ')} grid shift. `}{helmert && `${c.helmert} with a regional 3-parameter shift. `}{c.null > 0 && `${c.null} treating NAD83 as WGS84. `}{c.projection > 0 && `${c.projection} by projection only (same datum). `}Stored in {target.code}.</p>
    {result.needsAck && <div className="ws-notice" role="alert">
      {helmert ? <p style={{ margin: 0 }}>NAD27→NAD83 without a grid shift can be off by up to ~{result.expectedErrorM} m (typically 5–20 m). {why.length ? `No grid shift for ${c.helmert} ${c.helmert === 1 ? 'collar' : 'collars'}: ${why.join('; ')}.` : ''}</p>
        : <p style={{ margin: 0 }}>NAD83 and WGS84 are treated as identical (proj4’s default); positions can be off by up to ~{result.expectedErrorM} m.</p>}
      <label><input type="checkbox" checked={acknowledged} onChange={e => onAcknowledge(e.target.checked)} /> I accept converted positions that may be off by up to ~{result.expectedErrorM} m</label>
    </div>}
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Converted coordinates">
      <thead><tr><th>Hole</th><th>File X</th><th>File Y</th><th>Stored X</th><th>Stored Y</th><th>Method</th></tr></thead>
      <tbody>{result.rows.slice(0, 5).map(r => <tr key={r.hole_id}><td>{r.hole_id}</td><td>{r.x_src}</td><td>{r.y_src}</td><td>{r.x}</td><td>{r.y}</td><td>{METHOD[r.transform.method]}</td></tr>)}</tbody>
    </table></div>
  </div>;
}
