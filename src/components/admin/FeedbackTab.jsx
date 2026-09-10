import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { relTime } from './metrics';

/**
 * User-submitted feedback and issue reports (public.feedback, migration
 * 20260910000001). The Health tab shows what the code saw; this shows what
 * the user said — and lets you mark each one acknowledged or resolved so the
 * "new" count means something.
 */
const KIND_LABEL = { bug: 'Bug', feedback: 'Feedback', idea: 'Idea' };
const KIND_CLASS = { bug: 'adm-tag-red', feedback: 'adm-tag-blue', idea: 'adm-tag-green' };
const STATUS_CLASS = { new: 'adm-tag-amber', acknowledged: 'adm-tag-blue', resolved: 'adm-tag-muted' };
const FILTERS = [['new', 'Open'], [null, 'All']];

export default function FeedbackTab({ data, loading, error, filter, onFilter, onReload }) {
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const setStatus = async (id, status) => {
    if (!supabase || busyId) return;
    setBusyId(id);
    setActionError('');
    try {
      const { error: rpcError } = await supabase.rpc('admin_set_feedback_status', { p_id: id, p_status: status });
      if (rpcError) throw rpcError;
      onReload?.();
    } catch (e) {
      setActionError(e?.message || 'Could not update this report.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <section className="adm-card">
        <div className="adm-skeleton adm-skeleton-block" style={{ height: 160 }} />
      </section>
    );
  }

  if (error) {
    return (
      <section className="adm-card">
        <h3 className="adm-card-title">Feedback</h3>
        <p className="claims-error">Couldn’t load feedback: {error}</p>
      </section>
    );
  }

  const items = data?.items || [];
  const openCount = Number(data?.open_count || 0);

  return (
    <section className="adm-card adm-card-full">
      <div className="adm-card-head">
        <div>
          <div className="admx-eyebrow">{filter === 'new' ? 'Awaiting a look' : 'Newest 100'}</div>
          <h3 className="adm-card-title">
            Feedback{' '}
            <span style={{ color: openCount > 0 ? '#b7791f' : '#287454' }}>{openCount} open</span>
          </h3>
        </div>
        <div className="adm-feedback-filter" role="group" aria-label="Filter feedback">
          {FILTERS.map(([value, label]) => (
            <button
              key={label}
              className={`adm-btn adm-btn-sm${filter === value ? '' : ' adm-btn-ghost'}`}
              aria-pressed={filter === value}
              onClick={() => onFilter?.(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {actionError && <p className="adm-error-bar" role="alert">{actionError}</p>}

      {items.length === 0 ? (
        <p className="adm-empty" style={{ color: '#287454' }}>
          {filter === 'new' ? 'Nothing waiting. Every report has been acknowledged or resolved.' : 'No feedback yet. The form is in the sidebar account panel and on the crash screen.'}
        </p>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>From</th>
                <th>Where</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => {
                const who = f.user_email || f.email;
                const recentErrors = Array.isArray(f.context?.recentErrors) ? f.context.recentErrors : [];
                return (
                  <tr key={f.id}>
                    <td>
                      <span className={`adm-tag ${KIND_CLASS[f.kind] || ''}`}>{KIND_LABEL[f.kind] || f.kind}</span>
                      <div className="adm-feedback-msg">{f.message}</div>
                      {(f.context?.crash || recentErrors.length > 0) && (
                        <details>
                          <summary className="adm-muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                            diagnostics{recentErrors.length ? ` · ${recentErrors.length} recent error${recentErrors.length === 1 ? '' : 's'}` : ''}
                          </summary>
                          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                            {f.context.crash ? `crash: ${f.context.crash}\n` : ''}
                            {recentErrors.map((e) => `${e.at || ''} ${e.kind || ''} ${e.message || ''}`).join('\n')}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td>
                      {who ? <a href={`mailto:${who}`}>{who}</a> : <span className="adm-muted">anonymous</span>}
                      {f.user_id && <div className="adm-muted adm-mono" style={{ fontSize: 11 }}>{String(f.user_id).slice(0, 8)}</div>}
                    </td>
                    <td>
                      {f.path && <div className="adm-truncate" style={{ maxWidth: 180 }} title={f.path}>{f.path}</div>}
                      <div className="adm-muted adm-mono" style={{ fontSize: 11 }}>{f.release || '—'}</div>
                      {f.context?.viewport && <div className="adm-muted" style={{ fontSize: 11 }}>{f.context.viewport}</div>}
                    </td>
                    <td title={f.created_at}>{f.created_at ? relTime(f.created_at) : '—'}</td>
                    <td>
                      <span className={`adm-tag ${STATUS_CLASS[f.status] || ''}`}>{f.status}</span>
                      <div className="adm-feedback-actions" style={{ marginTop: 6 }}>
                        {f.status !== 'acknowledged' && f.status !== 'resolved' && (
                          <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === f.id} onClick={() => setStatus(f.id, 'acknowledged')}>Acknowledge</button>
                        )}
                        {f.status !== 'resolved' && (
                          <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === f.id} onClick={() => setStatus(f.id, 'resolved')}>Resolve</button>
                        )}
                        {f.status === 'resolved' && (
                          <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === f.id} onClick={() => setStatus(f.id, 'new')}>Reopen</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
