import React, { useState } from 'react';
import { csvToGeoJSON } from '../utils/importers';

const ROLES = [
  { value: 'x',       label: 'Easting / Longitude (X) *' },
  { value: 'y',       label: 'Northing / Latitude (Y) *' },
  { value: 'id',      label: 'Hole ID / Name' },
  { value: 'elev',    label: 'Elevation / Z' },
  { value: 'azimuth', label: 'Azimuth' },
  { value: 'dip',     label: 'Dip' },
  { value: 'skip',    label: '— Skip —' },
];

export default function ColumnMapperModal({ headers, rows, filename, onImport, onClose }) {
  const [mapping, setMapping] = useState(() => {
    const init = {};
    headers.forEach((h) => { init[h] = 'skip'; });
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
    if (!xCol) { setError('Please assign a column to Easting / Longitude (X).'); return; }
    if (!yCol) { setError('Please assign a column to Northing / Latitude (Y).'); return; }

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
          <strong>{filename}</strong> — assign each column to a role. X and Y are required.
        </p>

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
