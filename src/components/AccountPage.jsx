import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { PRICING, yearlyMonthlyEquivalent } from '../utils/pricing';
import { startCheckout, openBillingPortal } from '../utils/billing';
import {
  listCloudProjects,
  loadCloudProject,
  saveCloudProject,
  renameCloudProject,
  deleteCloudProject,
  listBrandKits,
  saveBrandKit,
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

function ProjectCard({ entry, onOpen, onRename, onDelete, onDuplicate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="acct-card acct-project-card">
      <button className="acct-card-thumb" type="button" aria-label={`Open ${entry.name || 'project'}`} onClick={() => !editing && onOpen(entry)}>
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
            <button className="acct-icon-btn" type="button" title="Duplicate" onClick={() => onDuplicate(entry)}>⧉</button>
            <button className="acct-icon-btn danger" type="button" title="Delete" onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function BrandKitCard({ kit, onApply, onUse, onSetDefault, onRename, onDelete, onDuplicate }) {
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
            <button className="acct-icon-btn" title="New project from this kit" type="button" onClick={() => onUse(kit)}>＋</button>
            {!kit.is_default && (
              <button className="acct-icon-btn" title="Set as default" type="button" onClick={() => onSetDefault(kit.id)}>★</button>
            )}
            <button className="acct-icon-btn" title="Rename" type="button" onClick={() => setEditing(true)}>✎</button>
            <button className="acct-icon-btn" title="Duplicate" type="button" onClick={() => onDuplicate(kit)}>⧉</button>
            <button className="acct-icon-btn danger" title="Delete" type="button" onClick={() => setConfirmDelete(true)}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}

const SETTINGS_FIELDS = [
  { key: 'companyName', label: 'Company name', placeholder: 'Acme Exploration Ltd.' },
  { key: 'qpName', label: 'Qualified Person', placeholder: 'Jane Doe, P.Geo.' },
  { key: 'qpCredentials', label: 'QP credentials', placeholder: 'P.Geo., M.Sc.' },
  { key: 'projectionName', label: 'Projection', placeholder: 'NAD83 / UTM Zone 15N' },
];

function AccountSettingsCard({ settings, onSave }) {
  const [form, setForm] = useState(() => ({ ...settings }));
  const [saved, setSaved] = useState(false);

  useEffect(() => { setForm({ ...settings }); }, [settings]);

  const dirty = SETTINGS_FIELDS.some((f) => (form[f.key] || '') !== (settings[f.key] || ''));

  const save = () => {
    const clean = {};
    for (const f of SETTINGS_FIELDS) {
      const v = (form[f.key] || '').trim();
      if (v) clean[f.key] = v;
    }
    onSave(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="acct-settings-card">
      <div className="acct-settings-grid">
        {SETTINGS_FIELDS.map((f) => (
          <label key={f.key} className="acct-settings-field">
            <span>{f.label}</span>
            <input
              type="text"
              value={form[f.key] || ''}
              placeholder={f.placeholder}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="acct-settings-actions">
        <button className="btn" type="button" onClick={save} disabled={!dirty}>Save defaults</button>
        {saved && <span className="acct-settings-saved">✓ Saved</span>}
      </div>
    </div>
  );
}

// Billing section: shows the current plan and routes to Stripe. Grandfathered
// accounts see an explicit "free forever" note instead of upgrade buttons.
function BillingSection({ onError }) {
  const { isPro, planSource, planReady } = useAuth();
  const [busy, setBusy] = useState(null); // 'month' | 'year' | 'portal'

  const act = (kind, fn) => async () => {
    setBusy(kind);
    try {
      await fn(); // redirects on success
    } catch (err) {
      onError(err);
      setBusy(null);
    }
  };

  const grandfathered = planSource === 'grandfathered';
  return (
    <section className="acct-section">
      <div className="acct-section-header">
        <h2>Plan &amp; Billing</h2>
      </div>
      {grandfathered ? (
        <p className="acct-section-hint">
          <strong>Pro — early adopter.</strong> You were here before paid plans existed, so you have
          full Pro access, free, forever: clean exports, HD/SVG/PDF formats, and unlimited projects.
          Nothing changes for your account.
        </p>
      ) : isPro ? (
        <>
          <p className="acct-section-hint">
            <strong>Pro.</strong> Clean exports, HD/SVG/PDF formats, and unlimited cloud projects.
          </p>
          <button className="btn" type="button" disabled={busy === 'portal'} onClick={act('portal', openBillingPortal)}>
            {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        </>
      ) : (
        <>
          <p className="acct-section-hint">
            <strong>Free plan.</strong> Standard PNG export with a small credit, up to 3 cloud projects.
            Pro unlocks clean exports, HD/SVG/PDF formats, and unlimited projects.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" type="button" disabled={Boolean(busy) || !planReady} onClick={act('year', () => startCheckout('year'))}>
              {busy === 'year' ? 'Opening checkout…' : `Upgrade — $${PRICING.yearly}/yr (≈ $${yearlyMonthlyEquivalent()}/mo)`}
            </button>
            <button className="btn" type="button" disabled={Boolean(busy) || !planReady} onClick={act('month', () => startCheckout('month'))}>
              {busy === 'month' ? 'Opening checkout…' : `$${PRICING.monthly}/month`}
            </button>
          </div>
          <p className="acct-section-hint" style={{ marginTop: 8 }}>Secure checkout by Stripe. Cancel anytime.</p>
        </>
      )}
    </section>
  );
}

export default function AccountPage({ onOpenProject, onNewProject, onExit, onApplyBrandKit, onUseKit, accountSettings = {}, onSaveSettings }) {
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState([]);
  const [brandKits, setBrandKits] = useState([]);
  const [loading, setLoading] = useState(true);
  // Visible, non-destructive error banner. Failures never wipe data that
  // already loaded — a failed refresh keeps showing the last good list.
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;   // a sign-out / user switch mid-flight must not apply
    setLoading(true);
    setLoadError(null);
    // Independent requests: one failing must not blank the other's data.
    Promise.allSettled([listCloudProjects(), listBrandKits()])
      .then(([p, k]) => {
        if (cancelled) return;
        if (p.status === 'fulfilled') setProjects(p.value);
        if (k.status === 'fulfilled') setBrandKits(k.value);
        const failures = [p.status === 'rejected' && 'projects', k.status === 'rejected' && 'brand kits'].filter(Boolean);
        if (failures.length) setLoadError(`Couldn't load your ${failures.join(' and ')} — check your connection and reload to retry.`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const refreshProjects = () => listCloudProjects().then((p) => { setProjects(p); }).catch(() => {
    setLoadError("Couldn't refresh your projects — the last loaded list is shown.");
  });
  const refreshBrandKits = () => listBrandKits().then((k) => { setBrandKits(k); }).catch(() => {
    setLoadError("Couldn't refresh your brand kits — the last loaded list is shown.");
  });
  const surfaceActionError = (what) => (err) => {
    setLoadError(`${what} failed: ${String(err?.message || err).slice(0, 140)}`);
  };

  const duplicateProject = async (entry) => {
    try {
      const full = await loadCloudProject(entry.id);
      await saveCloudProject({ id: null, name: `${entry.name} Copy`, payload: full.payload });
      refreshProjects();
    } catch (err) {
      surfaceActionError('Duplicating the project')(err);
    }
  };

  const duplicateKit = async (kit) => {
    try {
      await saveBrandKit({ name: `${kit.name} Copy`, config: kit.config || {} });
      refreshBrandKits();
    } catch (err) {
      surfaceActionError('Duplicating the brand kit')(err);
    }
  };

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
        {loadError && (
          <div className="claims-error" role="alert" style={{ margin: '0 0 12px' }}>
            ⚠ {loadError}
            <button type="button" className="secondary-btn" style={{ marginLeft: 10 }} onClick={() => setLoadError(null)}>Dismiss</button>
          </div>
        )}
        <BillingSection onError={surfaceActionError('Billing')} />

        <section className="acct-section">
          <div className="acct-section-header">
            <h2>Brand defaults</h2>
          </div>
          <p className="acct-section-hint">Used to pre-fill every new project you start.</p>
          <AccountSettingsCard settings={accountSettings} onSave={onSaveSettings} />
        </section>

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
                  onRename={(id, name) => { renameCloudProject(id, name).then(refreshProjects).catch(surfaceActionError('Renaming the project')); }}
                  onDelete={(id) => { deleteCloudProject(id).then(refreshProjects).catch(surfaceActionError('Deleting the project')); }}
                  onDuplicate={duplicateProject}
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
                  onUse={(k) => onUseKit(k.config || {})}
                  onSetDefault={(id) => { setDefaultBrandKit(id).then(refreshBrandKits).catch(surfaceActionError('Setting the default kit')); }}
                  onRename={(id, name) => { updateBrandKit(id, { name }).then(refreshBrandKits).catch(surfaceActionError('Renaming the kit')); }}
                  onDelete={(id) => { deleteBrandKit(id).then(refreshBrandKits).catch(surfaceActionError('Deleting the kit')); }}
                  onDuplicate={duplicateKit}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
