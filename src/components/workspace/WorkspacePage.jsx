import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import {
  createWorkspace, renameWorkspace, listMembers, setMemberRole, removeMember,
  createInvite, listInvites, revokeInvite, listProperties, createProperty, updateProperty, deleteProperty,
  permissions, assignableRoles, canManageMember, ROLE_LABELS, ROLE_HINTS, formatWhen,
} from '../../utils/workspace';
import {
  useWorkspaces, WorkspaceHeader, WorkspaceSwitcher, RoleBadge, StatusBadge, ErrorNote,
  PropertyForm, ActivityFeed, propertySummary, copyText,
} from './shared';

// /workspace: a company's members, invites, properties and activity, or the
// form to create a company workspace when the user has none.

function CreateWorkspace({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter the company name.'); return; }
    setBusy(true); setError(null);
    try { onCreated(await createWorkspace(name)); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <section className="dash-panel" style={{ maxWidth: 560 }}>
      <h2>Create a company workspace</h2>
      <p className="dash-panel-lead">
        One place for your company&apos;s properties, drill data, source files, maps, 3D figures and claims. Invite geologists and consultants as
        editors, and investors, JV partners or auditors as read-only viewers.
      </p>
      <ErrorNote error={error} />
      <form className="ws-form" onSubmit={submit}>
        <label className="ws-field">Company name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Star Copper Corp." autoComplete="organization" />
        </label>
        <div className="ws-actions">
          {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </form>
    </section>
  );
}

function Members({ org, me, onLeft }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const perms = permissions(org.role);
  const load = useCallback(() => listMembers(org.id).then(setMembers).catch((e) => setError(e.message)), [org.id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { setError(null); try { await fn(); await load(); } catch (e) { setError(e.message); } };
  const leave = () => act(async () => {
    if (!window.confirm(`Leave ${org.name}? You will lose access to its properties, maps and figures.`)) return;
    await removeMember(org.id, me);
    onLeft();
  });
  return (
    <section className="dash-panel" aria-labelledby="ws-members-h">
      <div className="dash-panel-head">
        <h2 id="ws-members-h">Members {members && <span className="dash-count">{members.length}</span>}</h2>
        <button type="button" className="dash-link" onClick={leave}>Leave workspace</button>
      </div>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {!members ? <p className="dash-muted">Loading…</p> : (
        <ul className="ws-list">
          {members.map((m) => {
            const manage = !m.is_me && canManageMember(org.role, m.role);
            const roles = assignableRoles(org.role);
            return (
              <li key={m.user_id}>
                <span className="ws-list-main"><b>{m.email}{m.is_me ? ' (you)' : ''}</b><small>Joined {formatWhen(m.joined_at)}</small></span>
                {manage || (m.is_me && perms.manageMembers && m.role !== 'owner') ? (
                  <select aria-label={`Role for ${m.email}`} value={m.role}
                    onChange={(e) => act(() => setMemberRole(org.id, m.user_id, e.target.value))}>
                    {[...new Set([m.role, ...roles])].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (
                  <span className="ws-badge">{ROLE_LABELS[m.role]}</span>
                )}
                {manage && (
                  <button type="button" className="dash-icon-btn danger" aria-label={`Remove ${m.email}`}
                    onClick={() => window.confirm(`Remove ${m.email} from ${org.name}?`) && act(() => removeMember(org.id, m.user_id))}>Remove</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Invites({ org }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [pending, setPending] = useState([]);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const roles = assignableRoles(org.role);
  const load = useCallback(() => listInvites(org.id).then(setPending).catch((e) => setError(e.message)), [org.id]);
  useEffect(() => { load(); }, [load]);
  const send = async (toEmail, toRole) => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await createInvite(org.id, toEmail, toRole);
      setCreated(r);
      setEmail('');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async (link) => setCopied(await copyText(link));
  return (
    <section className="dash-panel" aria-labelledby="ws-invites-h">
      <h2 id="ws-invites-h">Invite people</h2>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      <form className="ws-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) send(email.trim(), role); }}>
        <div className="ws-form-grid">
          <label className="ws-field">Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="geologist@company.com" required autoComplete="off" />
          </label>
          <label className="ws-field">Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}: {ROLE_HINTS[r]}</option>)}
            </select>
          </label>
        </div>
        <div className="ws-actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button></div>
      </form>
      {created && (
        <div className="ws-form" style={{ marginTop: 12 }} aria-live="polite">
          <p className="ws-ok">Invite sent to {created.email}. You can also share this link with them; it works once, for that address, for 14 days.</p>
          <div className="ws-link-box">
            <code title={created.link}>{created.link}</code>
            <button type="button" className="btn" onClick={() => copy(created.link)}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: '18px 0 4px' }}>Pending invites</h3>
          <p className="dash-muted" style={{ marginBottom: 6 }}>Links are shown only once. &ldquo;New link&rdquo; replaces the old one and emails it again.</p>
          <ul className="ws-list" aria-label="Pending invites">
            {pending.map((i) => (
              <li key={i.id}>
                <span className="ws-list-main"><b>{i.email}</b><small>{ROLE_LABELS[i.role]} · expires {formatWhen(i.expires_at)}</small></span>
                {roles.includes(i.role) && <button type="button" className="dash-icon-btn" onClick={() => send(i.email, i.role)}>New link</button>}
                <button type="button" className="dash-icon-btn danger" aria-label={`Cancel the invite for ${i.email}`}
                  onClick={async () => { setError(null); try { await revokeInvite(i.id); await load(); } catch (e) { setError(e.message); } }}>Cancel</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Properties({ org, properties, onChanged, onOpenProperty }) {
  const perms = permissions(org.role);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  return (
    <section aria-labelledby="ws-props-h">
      <div className="dash-panel-head">
        <h2 id="ws-props-h">Properties {properties.length > 0 && <span className="dash-count">{properties.length}</span>}</h2>
        {perms.edit && !creating && <button type="button" className="btn primary" style={{ width: 'auto', padding: '0 14px', height: 'var(--ctl-h)' }} onClick={() => setCreating(true)}>+ New property</button>}
      </div>
      <ErrorNote error={error} onDismiss={() => setError(null)} />
      {creating && (
        <div className="dash-panel" style={{ marginBottom: 14 }}>
          <PropertyForm submitLabel="Create property" onCancel={() => setCreating(false)}
            onSubmit={async (f) => { await createProperty(org.id, f); setCreating(false); onChanged(); }} />
        </div>
      )}
      {properties.length === 0 && !creating ? (
        <div className="dash-empty">
          <p><strong>No properties yet.</strong></p>
          <p className="dash-muted">Create a property to keep an exploration project&apos;s drill data, source files, maps, 3D figures and claims together.</p>
        </div>
      ) : (
        <div className="ws-properties">
          {properties.map((p) => (editing === p.id ? (
            <div key={p.id} className="dash-panel" style={{ gridColumn: '1 / -1' }}>
              <PropertyForm initial={p} onCancel={() => setEditing(null)}
                onSubmit={async (f) => { await updateProperty(p.id, f); setEditing(null); onChanged(); }} />
              {perms.deleteProperty && (
                <div className="ws-actions" style={{ marginTop: 8 }}>
                  <button type="button" className="dash-link" style={{ color: 'var(--ui-danger)' }}
                    onClick={async () => {
                      if (!window.confirm(`Delete ${p.name}? Move its maps, figures and claims out, and delete its data files, first.`)) return;
                      try { await deleteProperty(p.id); setEditing(null); onChanged(); } catch (e) { setError(e.message); }
                    }}>Delete property</button>
                </div>
              )}
            </div>
          ) : (
            <div key={p.id} className="ws-property" role="group" aria-label={p.name}>
              <button type="button" className="dash-tile-name" style={{ fontSize: 15 }} onClick={() => onOpenProperty(org.slug, p.slug)}>{p.name}</button>
              <p>{propertySummary(p) || 'No details yet'}</p>
              <div className="ws-row"><StatusBadge status={p.status} />
                {perms.edit && <button type="button" className="dash-link" onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`}>Edit</button>}
              </div>
            </div>
          )))}
        </div>
      )}
    </section>
  );
}

export default function WorkspacePage({ onExit, onOpenDashboard, onOpenProperty }) {
  const { user } = useAuth();
  const ws = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [properties, setProperties] = useState([]);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(null);
  const org = ws.active;

  const loadProps = useCallback(() => {
    if (!org) return;
    listProperties(org.id).then(setProperties).catch((e) => setError(e.message));
  }, [org]);
  useEffect(() => { setProperties([]); loadProps(); }, [loadProps]);

  const switchTo = (id) => {
    if (id === 'new') { setCreating(true); return; }
    if (id === 'personal') { ws.choose('personal'); onOpenDashboard(); return; }
    setCreating(false);
    ws.choose(id);
  };
  const perms = permissions(org?.role);
  const showCreate = creating || (!ws.loading && !org);

  return (
    <div className="dash-shell ws-page">
      <WorkspaceHeader onExit={onExit} onOpenDashboard={onOpenDashboard}>
        {ws.list.length > 0 && <WorkspaceSwitcher workspaces={ws.list} value={org?.id} onChange={switchTo} />}
      </WorkspaceHeader>
      <main className="dash-main">
        <ErrorNote error={error || ws.error} onDismiss={() => setError(null)} />
        {ws.loading ? <p className="dash-muted">Loading your workspaces…</p> : showCreate ? (
          <CreateWorkspace
            onCancel={org ? () => setCreating(false) : null}
            onCreated={async (r) => { setCreating(false); await ws.reload(); ws.choose(r.id); }}
          />
        ) : (
          <>
            <div className="dash-hero">
              <div>
                {renaming ? (
                  <form className="ws-row" onSubmit={async (e) => {
                    e.preventDefault();
                    const name = new FormData(e.currentTarget).get('name');
                    try { await renameWorkspace(org.id, name); setRenaming(false); ws.reload(); } catch (err) { setError(err.message); }
                  }}>
                    <label className="ws-field">Workspace name<input name="name" defaultValue={org.name} maxLength={120} autoFocus /></label>
                    <button className="btn primary" type="submit">Save</button>
                    <button className="btn" type="button" onClick={() => setRenaming(false)}>Cancel</button>
                  </form>
                ) : (
                  <h1 className="dash-title">{org.name} <RoleBadge role={org.role} /></h1>
                )}
                <p className="dash-subtitle">
                  {org.member_count} {org.member_count === 1 ? 'member' : 'members'} · {properties.length} {properties.length === 1 ? 'property' : 'properties'}
                  {perms.manageMembers && !renaming && <> · <button type="button" className="dash-link" onClick={() => setRenaming(true)}>Rename</button></>}
                </p>
              </div>
            </div>
            {!perms.edit && (
              <p className="ws-notice">You have view-only access to {org.name}. You can open everything here; ask an admin if you need to edit.</p>
            )}
            <div className="dash-columns">
              <div className="ws-stack">
                <Properties org={org} properties={properties} onChanged={() => { loadProps(); ws.reload(); }} onOpenProperty={onOpenProperty} />
                <section className="dash-panel" aria-labelledby="ws-activity-h">
                  <h2 id="ws-activity-h" style={{ marginBottom: 10 }}>Activity</h2>
                  <ActivityFeed key={org.id} orgId={org.id} properties={properties} />
                </section>
              </div>
              <aside className="dash-side">
                <Members key={org.id} org={org} me={user?.id}
                  onLeft={async () => { const list = await ws.reload(); ws.choose(list?.[0]?.id || 'personal'); }} />
                {perms.invite && <Invites key={`i-${org.id}`} org={org} />}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
