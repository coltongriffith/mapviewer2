import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { relTime } from './metrics';

const MATERIAL_LABEL = {
  claims: 'Claims and land', project_maps: 'Project maps', results: 'Exploration results', sections_3d: 'Sections and 3D',
  investor: 'Investor maps', presentation: 'Presentation', fact_sheet: 'Fact sheet', website: 'Website', map_review: 'Free map review',
};
const LEVEL_LABEL = { managed_maps: 'Managed Maps', maps_presentation: 'Maps + Presentation', corporate: 'Corporate Materials', not_sure: 'Not sure' };
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Exploration Maps for Teams enquiries (public.team_enquiries, from /teams).
 * Reply by email, mark contacted, close when it is won or lost. Uploaded files
 * open through a short-lived signed URL from the private bucket.
 */
export default function TeamEnquiriesCard({ data, loading, error, onReload }) {
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');

  const setStatus = async (id, status) => {
    if (!supabase || busyId) return;
    setBusyId(id);
    setActionError('');
    try {
      const { error: rpcError } = await supabase.rpc('admin_set_team_enquiry_status', { p_id: id, p_status: status });
      if (rpcError) throw rpcError;
      onReload?.();
    } catch (e) {
      setActionError(e?.message || 'Could not update this enquiry.');
    } finally {
      setBusyId(null);
    }
  };

  const openFile = async (path) => {
    setActionError('');
    const { data: signed, error: urlError } = await supabase.storage.from('team-enquiries').createSignedUrl(path, 300);
    if (urlError || !signed?.signedUrl) { setActionError('That file was not uploaded, or could not be opened.'); return; }
    window.open(signed.signedUrl, '_blank', 'noopener');
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
        <h3 className="adm-card-title">Team enquiries</h3>
        <p className="claims-error">Couldn’t load team enquiries: {error}</p>
      </section>
    );
  }

  const items = data?.items || [];
  const openCount = Number(data?.open_count || 0);

  return (
    <section className="adm-card adm-card-full">
      <div className="adm-card-head">
        <div>
          <div className="admx-eyebrow">Exploration Maps for Teams</div>
          <h3 className="adm-card-title">
            Team enquiries{' '}
            <span style={{ color: openCount > 0 ? '#b7791f' : '#287454' }}>{openCount} open</span>
          </h3>
        </div>
      </div>

      {actionError && <p className="adm-error-bar" role="alert">{actionError}</p>}

      {items.length === 0 ? (
        <p className="adm-empty" style={{ color: '#287454' }}>
          Nothing waiting. Enquiries come from the form at /teams.
        </p>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Needs</th>
                <th>From</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.company}</strong>
                    {r.projects && <div className="adm-muted" style={{ fontSize: 12 }}>{r.projects}</div>}
                    {r.message && <div className="adm-feedback-msg">{r.message}</div>}
                    {(r.files || []).map((f) => (
                      <div key={f.path} style={{ fontSize: 12 }}>
                        <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => openFile(f.path)}>{f.name}</button>{' '}
                        <span className="adm-muted">{fmtSize(f.size)}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {(r.materials || []).map((m) => MATERIAL_LABEL[m] || m).join(', ') || '—'}
                    <div className="adm-muted" style={{ fontSize: 12 }}>
                      {LEVEL_LABEL[r.service_level] || 'No level chosen'}
                      {r.deadline ? ` · due ${r.deadline}` : ''}{r.deadline_note ? ` (${r.deadline_note})` : ''}
                      {r.ref ? ` · via ${r.ref}` : ''}
                    </div>
                  </td>
                  <td>
                    {r.name && <div>{r.name}</div>}
                    <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Exploration Maps for ${r.company}`)}`}>{r.email}</a>
                  </td>
                  <td title={r.created_at}>{r.created_at ? relTime(r.created_at) : '—'}</td>
                  <td>
                    <span className={`adm-tag ${r.status === 'closed' ? 'adm-tag-muted' : r.status === 'new' ? 'adm-tag-amber' : ''}`}>{r.status}</span>
                    <div className="adm-feedback-actions" style={{ marginTop: 6 }}>
                      {r.status === 'new' && (
                        <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r.id, 'contacted')}>Mark contacted</button>
                      )}
                      <button className="adm-btn adm-btn-ghost adm-btn-sm" disabled={busyId === r.id} onClick={() => setStatus(r.id, r.status === 'closed' ? 'new' : 'closed')}>
                        {r.status === 'closed' ? 'Reopen' : 'Close'}
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
