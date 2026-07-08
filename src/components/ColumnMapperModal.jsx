import React, { useState } from 'react';
import { csvToGeoJSON } from '../utils/importers';

const ROLES = [
  { value: 'x',       label: 'Longitude — east/west position *' },
  { value: 'y',       label: 'Latitude — north/south position *' },
  { value: 'id',      label: 'Point name (hole ID, sample #…)' },
  { value: 'elev',    label: 'Elevation' },
  { value: 'azimuth', label: 'Azimuth' },
  { value: 'dip',     label: 'Dip' },
  { value: 'skip',    label: '— Skip —' },
];

export default function ColumnMapperModal({ headers, rows, filename, onImport, onClose, guesses = {}, hint = '' }) {
  const [mapping, setMapping] = useState(() => {
    const init = {};
    headers.forEach((h) => { init[h] = 'skip'; });
    // Pre-select detected columns so most users just confirm and import.
    Object.entries(guesses).forEach(([role, header]) => {
      if (header && init[header] !== undefined) init[header] = role;
    });
    return init;
  });
  const [error, setError] = useState('');

  const setRole = (header, role) => {
    setMapping((prev) => {
      const next = { ...prev };
      // Clear existing assignment of this role (one column per role)
      if (role !== 'skip') {
        Object.keys(next).forEach((k) => { if (next[k] === role) next[k] = 'skip'; });
      }
      next[header] = role;
      return next;
    });
    setError('');
  };

  const handleImport = () => {
    const xCol = Object.keys(mapping).find((h) => mapping[h] === 'x');
    const yCol = Object.keys(mapping).find((h) => mapping[h] === 'y');
    if (!xCol) { setError('Which column has the east/west position (longitude)? Pick it above.'); return; }
    if (!yCol) { setError('Which column has the north/south position (latitude)? Pick it above.'); return; }

    const idCol = Object.keys(mapping).find((h) => mapping[h] === 'id');
    const elevCol = Object.keys(mapping).find((h) => mapping[h] === 'elev');
    const m = {
      x: xCol,
      y: yCol,
      ...(idCol ? { id: idCol } : {}),
      ...(elevCol ? { elev: elevCol } : {}),
    };

    try {
      const geojson = csvToGeoJSON(rows, m);
      onImport(geojson);
    } catch (err) {
      setError(err.message);
    }
  };

  const preview = rows.slice(0, 3);

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-hd-card" style={{ maxWidth: 540, width: '95vw' }}>
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        <h3 className="export-hd-title" style={{ marginBottom: 4 }}>Map CSV columns</h3>
        <p className="export-hd-desc" style={{ marginBottom: 12 }}>
          <strong>{filename}</strong> — tell us which columns hold the coordinates. We've pre-selected our best guess.
        </p>
        {hint && (
          <p className="export-hd-desc" style={{ marginBottom: 12, background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '8px 12px', color: '#713f12' }}>
            {hint}
          </p>
        )}

        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e2e8f0' }}>Column</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e2e8f0' }}>Role</th>
                {preview.map((_, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    Row {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => (
                <tr key={h} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <select
                      value={mapping[h]}
                      onChange={(e) => setRole(h, e.target.value)}
                      style={{ fontSize: 12, padding: '2px 4px' }}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  {preview.map((row, i) => (
                    <td key={i} style={{ padding: '4px 8px', color: '#475569', whiteSpace: 'nowrap' }}>
                      {row[h] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="export-hd-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={handleImport}>
            Import drillholes
          </button>
          <button className="export-hd-skip" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
