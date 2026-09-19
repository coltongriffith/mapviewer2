import React, { useCallback, useEffect, useState } from 'react';
import { createAgentConnection, listAgentConnections, revokeAgentConnection } from '../utils/agentConnections';

function fmt(iso) {
  if (!iso) return 'Never';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function AgentConnectionsSection({ onError }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Muse');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setKeys(await listAgentConnections()); }
    catch (e) { onError?.(e); }
    finally { setLoading(false); }
  }, [onError]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true);
    setCreated(null);
    try {
      const key = await createAgentConnection(name);
      setCreated(key);
      setName('Muse');
      await refresh();
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created?.token) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onError?.(new Error('Could not copy the API key. Select it and copy manually.'));
    }
  };

  return (
    <section className="acct-section">
      <div className="acct-section-header">
        <h2>Agent Connections</h2>
      </div>
      <p className="acct-section-hint">
        Connect ExplorationMaps to AI agents such as Muse. An agent key lets the named service create maps in your account; you can revoke it at any time.
      </p>

      <div className="acct-settings-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={name}
          maxLength={80}
          aria-label="Connection name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Muse"
          style={{ minWidth: 220 }}
        />
        <button className="btn" type="button" disabled={busy || !name.trim()} onClick={create}>
          {busy ? 'Creating…' : 'Create agent key'}
        </button>
      </div>

      {created?.token && (
        <div className="claims-info" style={{ marginTop: 12 }}>
          <strong>Copy this key now.</strong> It will not be shown again.
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <code style={{ wordBreak: 'break-all' }}>{created.token}</code>
            <button className="secondary-btn" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="acct-empty">Loading…</p>
      ) : keys.filter((k) => !k.revoked_at).length === 0 ? (
        <p className="acct-empty">No active agent connections.</p>
      ) : (
        <ul className="acct-share-list" style={{ marginTop: 12 }}>
          {keys.filter((k) => !k.revoked_at).map((key) => (
            <li key={key.id} className="acct-share-row">
              <div>
                <strong>{key.name}</strong>
                <span className="adm-muted">
                  {' '}· {key.token_prefix}… · created {fmt(key.created_at)} · last used {fmt(key.last_used_at)}
                </span>
              </div>
              <button
                className="secondary-btn"
                type="button"
                onClick={async () => {
                  try { await revokeAgentConnection(key.id); await refresh(); }
                  catch (e) { onError?.(e); }
                }}
              >Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
