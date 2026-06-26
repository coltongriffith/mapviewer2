import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  listCloudProjects,
  renameCloudProject,
  deleteCloudProject,
  listBrandKits,
  setDefaultBrandKit,
  updateBrandKit,
  deleteBrandKit,
} from '../utils/cloudStorage';
import { renderBrandKitSwatch } from '../utils/brandKitSwatch';

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ProjectCard({ entry, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="acct-card acct-project-card">
      <button className="acct-card-thumb" type="button" onClick={() => !editing && onOpen(entry)}>
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt="" />
        ) : (
          <span className="acct-card-thumb-placeholder">{entry.name?.slice(0, 2).toUpperCase() || '?'}</span>
        )}
      </button>
      <div className="acct-card-body">
        {editing ? (
          <input
            autoFocus
            className="acct-card-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name.trim() !== entry.name) onRename(entry.id, name.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setName(entry.name); setEditing(false); } }}
          />
        ) : (
          <button className="acct-card-name" type="button" onClick={() => onOpen(entry)}>{entry.name}</button>
        )}
        <span className="acct-card-date">{fmtRelative(entry.updatedAt)}</span>
      </div>
      <div className="acct-card-actions">
        {confirmDelete ? (
          <>
            <span className="acct-confirm-label">Delete?</span>
            <button className="acct-icon-btn danger" type="button" onClick={() => { onDelete(entry.id); setConfirmDelete(false); }}>Yes</button>
            <button className="acct-icon-btn" type="button" onClick={() => setConfirmDelete(false)}>No</button>
          </>
        ) : (
          <>
            <button className="acct-icon-btn" type="button" title="Rename" onClick={() => setEditing(true)}>✎</button>
            <button className="acct-icon-btn danger" type="button" title="Delete" onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function BrandKitCard({ kit, onApply, onSetDefault, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(kit.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const swatch = renderBrandKitSwatch(kit.config || {});

  return (
    <div className="acct-card acct-brandkit-card">
      <img className="acct-card-thumb acct-brandkit-thumb" src={swatch} alt="" />
      <div className="acct-card-body">
        {editing ? (
          <input
            autoFocus
            className="acct-card-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name.trim() !== kit.name) onRename(kit.id, name.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setName(kit.name); setEditing(false); } }}
          />
        ) : (
          <span className="acct-card-name">
            {kit.name}
            {kit.is_default && <span className="acct-badge">Default</span>}
          </span>
        )}
      </div>
      <div className="acct-card-actions">
        {confirmDelete ? (
          <>
            <span className="acct-confirm-label">Delete?</span>
            <button className="acct-icon-btn danger" type="button" onClick={() => { onDelete(kit.id); setConfirmDelete(false); }}>Yes</button>
            <button className="acct-icon-btn" type="button" onClick={() => setConfirmDelete(false)}>No</button>
          </>
        ) : (
          <>
            <button className="btn compact" type="button" onClick={() => onApply(kit)}>Apply</button>
            {!kit.is_default && (
              <button className="acct-icon-btn" title="Set as default" type="button" onClick={() => onSetDefault(kit.id)}>★</button>
            )}
            <button className="acct-icon-btn" title="Rename" type="button" onClick={() => setEditing(true)}>✎</button>
            <button className="acct-icon-btn danger" title="Delete" type="button" onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AccountPage({ onOpenProject, onNewProject, onExit, onApplyBrandKit }) {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState([]);
  const [brandKits, setBrandKits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([listCloudProjects(), listBrandKits()])
      .then(([p, k]) => { setProjects(p); setBrandKits(k); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const refreshProjects = () => listCloudProjects().then(setProjects).catch(() => {});
  const refreshBrandKits = () => listBrandKits().then(setBrandKits).catch(() => {});

  return (
    <div className="acct-shell">
      <header className="acct-header">
        <div className="acct-header-left">
          <button className="acct-back-link" type="button" onClick={onExit}>← Back to editor</button>
          <span className="acct-header-title">My Account</span>
        </div>
        <div className="acct-header-right">
          <span className="acct-header-email">{user?.email}</span>
          <button className="secondary-btn" type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="acct-main">
        <section className="acct-section">
          <div className="acct-section-header">
            <h2>My Projects</h2>
            <button className="btn" type="button" onClick={onNewProject}>+ New Project</button>
          </div>
          {loading ? (
            <p className="acct-empty">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="acct-empty">No saved projects yet — start a new one to see it here.</p>
          ) : (
            <div className="acct-grid">
              {projects.map((entry) => (
                <ProjectCard
                  key={entry.id}
                  entry={entry}
                  onOpen={onOpenProject}
                  onRename={(id, name) => { renameCloudProject(id, name).then(refreshProjects).catch(() => {}); }}
                  onDelete={(id) => { deleteCloudProject(id).then(refreshProjects).catch(() => {}); }}
                />
              ))}
            </div>
          )}
        </section>

        <section className="acct-section">
          <div className="acct-section-header">
            <h2>My Brand Kits</h2>
          </div>
          {loading ? (
            <p className="acct-empty">Loading…</p>
          ) : brandKits.length === 0 ? (
            <p className="acct-empty">No brand kits yet — save your look from any project to reuse it here.</p>
          ) : (
            <div className="acct-grid">
              {brandKits.map((kit) => (
                <BrandKitCard
                  key={kit.id}
                  kit={kit}
                  onApply={(k) => onApplyBrandKit(k.config || {})}
                  onSetDefault={(id) => { setDefaultBrandKit(id).then(refreshBrandKits).catch(() => {}); }}
                  onRename={(id, name) => { updateBrandKit(id, { name }).then(refreshBrandKits).catch(() => {}); }}
                  onDelete={(id) => { deleteBrandKit(id).then(refreshBrandKits).catch(() => {}); }}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
