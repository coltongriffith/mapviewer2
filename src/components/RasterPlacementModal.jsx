import React, { useState } from 'react';
import { reprojectBounds, validBounds, utmProjString, looksLikeLatLng } from '../utils/rasterOverlay.js';

// Where a picture goes on the map. Four edges in latitude/longitude, or a UTM
// box with its zone and datum; a world file dropped beside the image fills
// the box in and the person confirms it.

const num = (v) => (v === '' || v == null ? NaN : Number(v));

export default function RasterPlacementModal({ image, initialBounds, initialCrs, mapCenter, onImport, onClose }) {
  const startUtm = initialCrs === 'utm' || (initialBounds && !looksLikeLatLng(initialBounds));
  const guessZone = mapCenter ? Math.floor((mapCenter.lng + 180) / 6) + 1 : 10;
  const [mode, setMode] = useState(startUtm ? 'utm' : 'latlng');
  const [b, setB] = useState({
    north: initialBounds?.north ?? '', south: initialBounds?.south ?? '',
    east: initialBounds?.east ?? '', west: initialBounds?.west ?? '',
  });
  const [zone, setZone] = useState(initialCrs?.zone ?? guessZone);
  const [hemisphere, setHemisphere] = useState(mapCenter && mapCenter.lat < 0 ? 'S' : 'N');
  const [datum, setDatum] = useState('NAD83');
  const [opacity, setOpacity] = useState(0.85);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setB((prev) => ({ ...prev, [k]: e.target.value }));

  const place = async () => {
    const raw = { north: num(b.north), south: num(b.south), east: num(b.east), west: num(b.west) };
    if (Object.values(raw).some((v) => !Number.isFinite(v))) { setError('All four edges are needed.'); return; }
    if (!(raw.north > raw.south) || !(raw.east > raw.west)) { setError('North must be greater than south, and east greater than west.'); return; }
    setBusy(true);
    try {
      const bounds = mode === 'utm' ? await reprojectBounds(raw, utmProjString(zone, hemisphere, datum)) : raw;
      if (!validBounds(bounds)) { setError('Those edges do not describe a place on Earth. Check the zone and the numbers.'); return; }
      onImport(bounds, opacity);
    } catch (err) {
      setError(err.message || 'Could not place the image.');
    } finally {
      setBusy(false);
    }
  };

  const isUtm = mode === 'utm';
  const unit = isUtm ? 'm' : '°';

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-hd-card" style={{ maxWidth: 520, width: '95vw' }}>
        <button className="export-hd-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        <h3 className="export-hd-title" style={{ marginBottom: 4 }}>Place image on the map</h3>
        <p className="export-hd-desc" style={{ marginBottom: 12 }}>
          <strong>{image?.name}</strong> — {image?.sourceWidth} × {image?.sourceHeight} px.
          {initialBounds ? ' The edges below came from its world file; confirm the coordinate system.' : ' Enter the coordinates of its edges.'}
        </p>
        {image?.dataUri && (
          <div style={{ marginBottom: 12, textAlign: 'center' }}>
            <img src={image.dataUri} alt="" style={{ maxWidth: '100%', maxHeight: 140, border: '1px solid var(--ui-border)', borderRadius: 4 }} />
          </div>
        )}
        <div className="control-grid">
          <div className="control-row">
            <label htmlFor="f-raster-crs">Coordinates are</label>
            <select id="f-raster-crs" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="latlng">Latitude / longitude (WGS84)</option>
              <option value="utm">UTM (metres)</option>
            </select>
          </div>
          {isUtm && (
            <div className="control-row inline-2">
              <div>
                <label htmlFor="f-raster-zone">Zone</label>
                <input id="f-raster-zone" type="number" min="1" max="60" value={zone} onChange={(e) => setZone(e.target.value)} />
              </div>
              <div>
                <label htmlFor="f-raster-hemi">Hemisphere / datum</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select id="f-raster-hemi" value={hemisphere} onChange={(e) => setHemisphere(e.target.value)}>
                    <option value="N">North</option>
                    <option value="S">South</option>
                  </select>
                  <select aria-label="Datum" value={datum} onChange={(e) => setDatum(e.target.value)}>
                    <option value="NAD83">NAD83</option>
                    <option value="WGS84">WGS84</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="control-row inline-2">
            <div>
              <label htmlFor="f-raster-north">{isUtm ? 'North edge (northing)' : 'North edge (latitude)'} {unit}</label>
              <input id="f-raster-north" type="number" step="any" value={b.north} onChange={set('north')} />
            </div>
            <div>
              <label htmlFor="f-raster-south">{isUtm ? 'South edge (northing)' : 'South edge (latitude)'} {unit}</label>
              <input id="f-raster-south" type="number" step="any" value={b.south} onChange={set('south')} />
            </div>
          </div>
          <div className="control-row inline-2">
            <div>
              <label htmlFor="f-raster-west">{isUtm ? 'West edge (easting)' : 'West edge (longitude)'} {unit}</label>
              <input id="f-raster-west" type="number" step="any" value={b.west} onChange={set('west')} />
            </div>
            <div>
              <label htmlFor="f-raster-east">{isUtm ? 'East edge (easting)' : 'East edge (longitude)'} {unit}</label>
              <input id="f-raster-east" type="number" step="any" value={b.east} onChange={set('east')} />
            </div>
          </div>
          <div className="control-row inline-2">
            <div>
              <label htmlFor="f-raster-opacity">Opacity</label>
              <input id="f-raster-opacity" type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </div>
            <div className="range-value">{Math.round(opacity * 100)}%</div>
          </div>
        </div>
        <p className="small-note" style={{ marginTop: 8 }}>
          The image is stretched to fit the box, so it must be north-up in the coordinate system you pick. A rotated grid is placed by its bounding box.
        </p>
        {error && <div className="export-hd-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="export-hd-actions">
          <button className="btn primary export-hd-btn-primary" type="button" onClick={place} disabled={busy}>
            {busy ? 'Placing…' : 'Place on map'}
          </button>
          <button className="export-hd-skip" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
