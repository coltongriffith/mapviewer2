import React, { useEffect, useId, useState } from 'react';
import { DRILL_SOURCE_CRS, previewSourceCoordinates, sourceCoordinateMapping, sourceCrs } from '../../utils/drillCoordinates';

export default function DrillCoordinateSource({ mapping, propertyCrs, rows, onChange }) {
  const listId = useId();
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const selected = sourceCrs(mapping.crs);
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
    <p className="dash-muted" style={{ margin: 0 }}>Choose the system used by the file, not a desired destination. X/Y are imported unchanged; no reprojection or datum shift is applied. Elevation is also unchanged.</p>
    {selected ? <p className="dash-muted" style={{ margin: 0 }}>{selected.label}. {selected.geographic ? 'X = longitude, Y = latitude, in decimal degrees.' : 'X = easting, Y = northing, in metres.'} Confirm this against the source file; column names alone do not establish its datum.</p>
      : <p className="ws-notice">{mapping.crs ? 'This code is outside the preset catalog; preview is unavailable. You can still import its source values unchanged.' : 'No source CRS is recorded. For a local grid, leave this blank until its surveyed reference is known; do not assign an EPSG code by guessing.'} NAD83(CSRS) and other realizations need their own exact EPSG code.</p>}
    {propertyCrs && mapping.crs && propertyCrs.toUpperCase() !== mapping.crs.toUpperCase() && <p className="ws-notice">The property uses {propertyCrs}; this file uses {mapping.crs}. This import keeps the file’s coordinates and CRS. Changing this label does not convert coordinates.</p>}
    {selected?.datum !== 'WGS84' && selected && <p className="ws-notice">The preview stays in {selected.datum}; it is not a WGS84 map position. Accurate changes between datums require a verified transformation, including any required grid shifts.</p>}
    {selected && <button type="button" className="btn" onClick={() => setShowPreview(s => !s)}>{showPreview ? 'Hide coordinate preview' : 'Preview source coordinates'}</button>}
    {showPreview && selected && <div aria-label="Coordinate preview" role="region">
      <p className="dash-muted">First {Math.min(5, rows.length)} valid collar rows. Geographic preview in {selected.datum}; imported X/Y below remain unchanged. This checks interpretation, not survey accuracy or the declared datum.</p>
      {error ? <p className="ws-error" role="alert">{error}</p> : !preview ? <p role="status">Preparing coordinate preview…</p> : <div className="ws-table-wrap"><table className="ws-table" aria-label="Source coordinate preview">
        <thead><tr><th>Hole</th><th>Imported X</th><th>Imported Y</th><th>Longitude ({selected.datum})</th><th>Latitude ({selected.datum})</th></tr></thead>
        <tbody>{preview.map(r => <tr key={r.hole_id}><td>{r.hole_id}</td><td>{r.x}</td><td>{r.y}</td>{r.issue ? <td colSpan={2}>{r.issue}</td> : <><td>{r.longitude.toFixed(6)}</td><td>{r.latitude.toFixed(6)}</td></>}</tr>)}</tbody>
      </table></div>}
    </div>}
  </section>;
}
