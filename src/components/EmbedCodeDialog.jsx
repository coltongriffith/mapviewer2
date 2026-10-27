import React, { useEffect, useRef, useState } from 'react';
import { getLiveMap, publishLiveMap, revokeLiveMap } from '../utils/cloudStorage';
import { embedCode, embedUrl, EMBED_ASPECTS } from '../utils/embedCode';
import { trackEvent } from '../utils/track';

const when = (iso) => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return ''; } };

// "Embed on your website": the saved map's live web map (one link, republished in place) and its <iframe> code.
// Pro, or an editor of a paid company workspace's map (as publish_live_map); otherwise the upsell. getState: the map as it would be shared now, read only when publishing.
export default function EmbedCodeDialog({ projectId, canPublish, entitlements, workspacePaid, title, getState, onUpgrade, onClose }) {
  const [live, setLive] = useState(undefined); // undefined: loading; null: never published
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState({ width: 960, aspect: '16:9', responsive: true });
  const [copied, setCopied] = useState(false);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const readProject = useRef(projectId);
  const readVersion = useRef(0);
  const allowed = Boolean(entitlements?.live_embed || workspacePaid);

  useEffect(() => {
    // A plan downgrade may block republishing, never stopping an existing
    // publication. Read its management metadata independently of paid access.
    if (!canPublish || !projectId) return undefined;
    let cancelled = false;
    const version = ++readVersion.current;
    const current = () => !cancelled && version === readVersion.current;
    if (readProject.current !== projectId) { setLive(undefined); readProject.current = projectId; }
    setReading(true); setReadError('');
    getLiveMap(projectId).then((d) => { if (current()) setLive(d); }).catch((e) => {
      if (current()) setReadError(e?.code === 'LIVE_MAP_UNAVAILABLE' ? e.message : 'The live map status could not be loaded. Try again.');
    }).finally(() => { if (current()) setReading(false); });
    return () => { cancelled = true; };
  }, [canPublish, projectId, reload]);

  const setConfirmedLive = (value) => {
    // Stop stays available during a retry. Its success must outrank any older
    // status response, which may have observed the still-published link.
    readVersion.current += 1;
    setReading(false); setReadError(''); setLive(value);
  };

  const publish = async () => {
    setBusy(true); setError('');
    try {
      const id = await publishLiveMap(projectId, getState());
      setConfirmedLive((await getLiveMap(projectId).catch(() => null)) || { id, updated_at: new Date().toISOString(), view_count: 0 });
      trackEvent('share_created', { mapId: id, live: true });
    } catch (e) { setError(e.message || 'The map could not be published.'); } finally { setBusy(false); }
  };
  // Stop the live link for every site embedding it; the next publish makes a new one.
  const unpublish = async () => {
    if (!window.confirm('Stop the live map? Every website embedding it will show it as unavailable.')) return;
    setBusy(true); setError('');
    try { await revokeLiveMap(projectId); setConfirmedLive(null); } catch (e) { setError(e.message || 'The live map could not be stopped.'); } finally { setBusy(false); }
  };
  const code = live?.id ? embedCode(live.id, { title, ...opts }) : '';
  const copy = () => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  const statusNotice = readError && <><p className="share-note" role="alert">{readError}</p>
    <button className="share-copy-btn" disabled={reading} onClick={() => setReload((v) => v + 1)}>Retry live map status</button></>;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="share-modal embed-dialog" role="dialog" aria-modal="true" aria-labelledby="embed-dialog-title" onClick={(e) => e.stopPropagation()}>
        <button className="export-hd-close" aria-label="Close embed dialog" onClick={onClose}>✕</button>
        <h3 className="share-modal-title" id="embed-dialog-title">Embed on your website</h3>
        {readError && !live ? statusNotice : canPublish && projectId && live === undefined ? <p className="share-modal-desc" role="status">Loading…</p> : !allowed && !live ? (<>
          <p className="share-modal-desc">Put this map on your company website as a live, interactive investor map: pan and zoom, layer switches, the legend and claim records. Republish after new results and every page showing it updates.</p>
          <button className="share-generate-btn" onClick={() => onUpgrade('live_embed')}>See Pro</button>
        </>) : !canPublish ? (
          <p className="share-modal-desc">Save this map to your account first. A live web map is published from a saved map, so you can republish it after every update.</p>
        ) : (<>
          <p className="share-modal-desc">{live
            ? `Published ${when(live.updated_at)} · ${live.view_count} view${live.view_count === 1 ? '' : 's'} (link and embeds). Edits stay private until you republish; then every site showing the map updates on its next load.`
            : 'Publish this map as a live web map. Edits stay private until you republish.'}</p>
          {error && <p className="share-note" role="alert">{error}</p>}
          {statusNotice}
          {allowed ? <button className="share-generate-btn" disabled={busy || reading || Boolean(readError)} onClick={publish}>{busy ? 'Publishing…' : live ? 'Republish with the current map' : 'Publish live map'}</button>
            : <><p className="share-note">You can still copy or stop this live map. Pro or a paid company plan is needed to republish it.</p>
              <button className="share-generate-btn" onClick={() => onUpgrade('live_embed')}>See Pro</button></>}
          {live && (<>
            <div className="embed-dialog-options">
              <label>Width <input type="number" min="200" max="4000" step="10" value={opts.width} onChange={(e) => setOpts({ ...opts, width: e.target.value })} /> px</label>
              <label>Shape <select value={opts.aspect} onChange={(e) => setOpts({ ...opts, aspect: e.target.value })}>
                {Object.keys(EMBED_ASPECTS).map((a) => <option key={a} value={a}>{a}</option>)}
              </select></label>
              <label><input type="checkbox" checked={opts.responsive} onChange={(e) => setOpts({ ...opts, responsive: e.target.checked })} /> Fit the page width</label>
            </div>
            <textarea className="share-url-input embed-dialog-code" readOnly rows={4} value={code} aria-label="Embed code" onFocus={(e) => e.target.select()} />
            <div className="share-url-row">
              <button className={`share-copy-btn${copied ? ' copied' : ''}`} onClick={copy}>{copied ? '✓ Copied!' : 'Copy embed code'}</button>
              <a className="share-copy-btn" href={embedUrl(live.id)} target="_blank" rel="noopener">Preview</a>
              <button className="share-copy-btn" disabled={busy} onClick={unpublish}>Stop live map</button>
            </div>
          </>)}
        </>)}
      </div>
    </div>
  );
}
