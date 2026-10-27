import React, { useEffect, useState } from 'react';
import Dialog from './Dialog';
import { useAuth } from '../hooks/useAuth.jsx';
import { loadCloudProject } from '../utils/cloudStorage';
import { layerCollection, layerDataFile } from '../utils/layerDataExport';
import { downloadBlob } from '../utils/svg';

export default function ProjectDataDownload({ project, onClose }) {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState('0');
  const [status, setStatus] = useState('');
  const key = user?.id ? user.id + ':' + project.id : null;
  useEffect(() => {
    let cancelled = false;
    setLoaded(null); setError(''); setStatus(''); setChoice('0');
    if (!key) return undefined;
    loadCloudProject(project.id).then(record => {
      if (cancelled) return;
      if (!record?.payload || !Array.isArray(record.payload.layers)) throw new Error('Missing map data');
      setLoaded({ key, name: record.name || project.name, layers: record.payload.layers });
    }).catch(() => {
      if (!cancelled) setError('Could not load this saved map. Check your connection and access, then try again.');
    });
    return () => { cancelled = true; };
  }, [key, project.id, project.name, attempt]);

  const layers = loaded?.key === key ? loaded.layers : null;
  const vectors = layers?.filter(layer => layerCollection(layer)) || [];
  const selected = vectors[Number(choice)];
  const download = (format) => {
    if (!key || !selected) return;
    try {
      const { filename, blob } = layerDataFile(selected, format, loaded.name);
      downloadBlob(filename, blob);
      setStatus('Downloaded ' + filename); setError('');
    } catch {
      setError('This layer could not be downloaded. Try again or choose another layer.');
    }
  };
  return <Dialog title="Download map data" titleId="map-data-title" onClose={onClose} panelClassName="modal-panel auth-modal">
    <p className="dash-muted">Download layers from the saved version of {project.name || 'this map'}. Hidden features are included; unsaved edits are not.</p>
    {!key ? <p role="alert">Sign in to download your saved map data.</p> : <>
      {!layers && !error && <p role="status">Loading saved map data…</p>}
      {error && <p role="alert">{error} {!layers && <button type="button" className="dash-link" onClick={() => setAttempt(n => n + 1)}>Try again</button>}</p>}
      {layers && (vectors.length ? <>
        <label className="auth-label" htmlFor="map-data-layer">Map layer</label>
        <select id="map-data-layer" className="auth-input" value={choice} onChange={e => { setChoice(e.target.value); setStatus(''); }}>
          {vectors.map((layer, index) => <option key={index} value={index}>{layer.name || 'Layer ' + (index + 1)} ({layerCollection(layer).features.length} features)</option>)}
        </select>
        <p className="dash-muted">GeoJSON keeps geometry and attributes as saved. CSV includes all attributes and geometry as JSON, plus coordinate columns for points. Text that could run as a spreadsheet formula is prefixed with an apostrophe in CSV.</p>
        <div className="dash-hero-actions">
          <button type="button" className="btn" onClick={() => download('csv')}>Download CSV</button>
          <button type="button" className="btn" onClick={() => download('geojson')}>Download GeoJSON</button>
        </div>
      </> : <p>No saved vector layers are available to download from this map.</p>)}
      {layers && layers.length > vectors.length && <p className="dash-muted">Basemaps, imagery and linked layers without saved vector data are not included.</p>}
      {status && <p role="status">{status}</p>}
    </>}
    <button type="button" className="btn" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
  </Dialog>;
}
