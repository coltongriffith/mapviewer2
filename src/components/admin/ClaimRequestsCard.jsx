import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { relTime } from './metrics';

/**
 * "Tell us the project" requests from empty claim searches
 * (public.claim_search_requests). Look each one up, reply by email, then mark
 * it answered so the open count stays honest.
 */
export default function ClaimRequestsCard({ data, loading, error, onReload }) {
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const setAnswered = async (id, answered) => {
    if (!supabase || busyId) return;
    setBusyId(id);
    setActionError('');
    try {
      const { error: rpcError } = await supabase.rpc('admin_set_claim_request_answered', { p_id: id, p_answered: answered });
      if (rpcError) throw rpcError;
      onReload?.();
    } catch (e) {
      setActionError(e?.message || 'Could not update this request.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <section className="adm-card adm-card-full">
        <div className="adm-skeleton adm-skeleton-block" style={{ height: 120 }} />
      </section>
    );
  }

  if (error) {
    return (
      <section className="adm-card adm-card-full">
        <h3 className="adm-card-title">Search requests</h3>
        <p className="claims-error">Couldn’t load search requests: {error}</p>
      </section>
    );
  }

  const items = data?.items || [];
  const openCount = Number(data?.open_count || 0);

  return (
    <section className="adm-card adm-card-full">
      <div className="adm-card-head">
        <div>
          <div className="admx-eyebrow">Searches that found nothing</div>
          <h3 className="adm-card-title">
            Search requests{' '}
            <span style={{ color: openCount > 0 ? '#b7791f' : '#287454' }}>{openCount} open</span>
          </h3>
        </div>
      </div>

      {actionError && <p className="adm-error-bar" role="alert">{actionError}</p>}

      {items.length === 0 ? (
        <p className="adm-empty" style={{ color: '#287454' }}>
          Nothing waiting. Requests come from “tell us the project” under an empty claim search.
        </p>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Looking for</th>
                <th>From</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.query_text}</strong>
                    <div className="adm-muted" style={{ fontSize: 12 }}>
                      {String(r.province || '').toUpperCase()}{r.mode ? ` · ${r.mode} search` : ''}
                    </div>
                    {r.note && <div className="adm-feedback-msg">{r.note}</div>}
                  </td>
                  <td><a href={`mailto:${r.email}?subject=${encodeURIComponent(`Your claim search: ${r.query_text}`)}`}>{r.email}</a></td>
                  <td title={r.created_at}>{r.created_at ? relTime(r.created_at) : '—'}</td>
                  <td>
                    <span className={`adm-tag ${r.answered_at ? 'adm-tag-muted' : 'adm-tag-amber'}`}>{r.answered_at ? 'answered' : 'open'}</span>
                    <div className="adm-feedback-actions" style={{ marginTop: 6 }}>
                      <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === r.id} onClick={() => setAnswered(r.id, !r.answered_at)}>
                        {r.answered_at ? 'Reopen' : 'Mark answered'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
