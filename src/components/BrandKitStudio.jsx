import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ColorField from './ColorField';
import { renderBrandKitSwatch } from '../utils/brandKitSwatch';
import { TEMPLATE_THEMES, FONT_OPTIONS } from '../projectState';
import {
  saveBrandKit,
  updateBrandKit,
  setDefaultBrandKit,
  deleteBrandKit,
  BRAND_KIT_SAVEABLE_KEYS,
} from '../utils/cloudStorage';

// The five brand-defining colours, with the same labels used elsewhere, plus a
// sensible fallback so the native colour input always has a valid hex even when
// the kit hasn't set that colour yet (matches renderBrandKitSwatch's defaults).
const COLOR_FIELDS = [
  ['accentColor', 'Accent', '#2563eb'],
  ['titleBgColor', 'Title background', '#0c1a35'],
  ['titleFgColor', 'Title text', '#ffffff'],
  ['panelBgColor', 'Panel background', '#ffffff'],
  ['panelFgColor', 'Panel text', '#1e293b'],
];
const FONT_SLOTS = [
  ['title', 'Title'],
  ['legend', 'Legend'],
  ['label', 'Labels'],
  ['callout', 'Callouts'],
];
const COMPANY_FIELDS = [
  ['companyName', 'Company name', 'Acme Exploration Ltd.'],
  ['qpName', 'Qualified Person', 'Jane Doe, P.Geo.'],
  ['qpCredentials', 'QP credentials', 'P.Geo., M.Sc.'],
  ['projectionName', 'Projection', 'NAD83 / UTM Zone 15N'],
];

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function RailCard({ kit, active, liveSrc, status }) {
  const src = active && liveSrc ? liveSrc : renderBrandKitSwatch(kit.config || {}, { width: 220, height: 88 });
  return (
    <>
      <img src={src} alt="" />
      <div className="bks-rail-cardrow">
        <span className="bks-rail-name">{kit.name || 'Untitled kit'}</span>
        {kit.is_default && <span className="bks-rail-default" title="Default kit">★</span>}
      </div>
      <span className={`bks-rail-status${status === 'error' ? ' bks-status-error' : ''}`}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : ''}
      </span>
    </>
  );
}

/**
 * Brand Kit Studio — a two-pane "list + live editor".
 *
 * Left rail: a card per kit (live preview + name + default), plus "New" and
 * "Capture current settings". Right detail: a sticky header with a big, always-
 * visible name field and a live preview, then in-place editors for the kit's
 * brand colours, theme, fonts, logo, and company/QP info. Every edit autosaves
 * (debounced) via updateBrandKit(id, { name, config }) — no Apply-then-recapture.
 */
export default function BrandKitStudio({
  onClose,
  isAuthed,
  kits = [],
  brandColors = [],
  project,
  onReload,
  applyToProject,
  onRequestAuth,
}) {
  const [selectedKitId, setSelectedKitId] = useState(
    () => kits.find((k) => k.is_default)?.id ?? kits[0]?.id ?? null,
  );
  const [draft, setDraft] = useState(null); // { id, name, config }
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [previewSrc, setPreviewSrc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveTimerRef = useRef(null);
  const lastSavedRef = useRef('');
  const justCreatedRef = useRef(false);
  const nameInputRef = useRef(null);
  const logoInputRef = useRef(null);

  // Hydrate the editor when the selected kit changes. Crucially, keep the
  // in-progress draft when `kits` merely reloads after our own autosave (same
  // id) so edits aren't clobbered mid-typing.
  useEffect(() => {
    if (!isAuthed) return;
    const kit = kits.find((k) => k.id === selectedKitId);
    if (!kit) {
      if (selectedKitId == null) setDraft(null);
      return;
    }
    setDraft((prev) => {
      if (prev && prev.id === kit.id) return prev;
      lastSavedRef.current = JSON.stringify({ name: kit.name || '', config: kit.config || {} });
      setSaveStatus('idle');
      setConfirmDelete(false);
      return { id: kit.id, name: kit.name || '', config: { ...(kit.config || {}) } };
    });
  }, [selectedKitId, kits, isAuthed]);

  // Debounced autosave. A freshly hydrated draft equals lastSaved, so this only
  // fires on real edits; a 700ms debounce coalesces bursts (e.g. logo + colours)
  // into a single write.
  useEffect(() => {
    if (!draft) return undefined;
    const serialized = JSON.stringify({ name: draft.name, config: draft.config });
    if (serialized === lastSavedRef.current) return undefined;
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateBrandKit(draft.id, {
          name: draft.name.trim() || 'Untitled kit',
          config: draft.config,
        });
        lastSavedRef.current = serialized;
        setSaveStatus('saved');
        onReload?.();
      } catch {
        setSaveStatus('error');
      }
    }, 700);
    return () => clearTimeout(saveTimerRef.current);
  }, [draft, onReload]);

  // Live preview. renderBrandKitSwatch only draws config.logo once the Image is
  // decoded, so pre-decode a freshly pasted base64 logo before re-rendering.
  useEffect(() => {
    if (!draft) { setPreviewSrc(''); return; }
    const render = () => setPreviewSrc(renderBrandKitSwatch(draft.config, { width: 360, height: 150 }));
    const logo = draft.config?.logo;
    if (typeof logo === 'string' && logo.startsWith('data:')) {
      const img = new Image();
      img.onload = render;
      img.onerror = render;
      img.src = logo;
      if (img.decode) img.decode().then(render).catch(() => {});
    } else {
      render();
    }
  }, [draft]);

  // Focus + select the name field right after a kit is created/captured.
  useEffect(() => {
    if (justCreatedRef.current && draft && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
      justCreatedRef.current = false;
    }
  }, [draft]);

  const onPatch = useCallback((partial) => {
    setDraft((d) => (d ? { ...d, config: { ...d.config, ...partial } } : d));
  }, []);
  const onPatchFont = useCallback((slot, value) => {
    setDraft((d) => (d ? { ...d, config: { ...d.config, fonts: { ...(d.config.fonts || {}), [slot]: value } } } : d));
  }, []);
  const onPatchName = useCallback((name) => {
    setDraft((d) => (d ? { ...d, name } : d));
  }, []);

  const createKit = useCallback(async () => {
    try {
      const row = await saveBrandKit({ name: 'Untitled kit', config: {} });
      justCreatedRef.current = true;
      onReload?.();
      setSelectedKitId(row.id);
    } catch { /* surfaced via the absence of a new card */ }
  }, [onReload]);

  const captureKit = useCallback(async () => {
    try {
      const config = {};
      for (const k of BRAND_KIT_SAVEABLE_KEYS) {
        if (project?.layout?.[k] !== undefined) config[k] = project.layout[k];
      }
      if (project?.layout?.fonts) config.fonts = project.layout.fonts;
      const row = await saveBrandKit({ name: project?.layout?.title || 'Captured kit', config });
      justCreatedRef.current = true;
      onReload?.();
      setSelectedKitId(row.id);
    } catch { /* ignore */ }
  }, [onReload, project]);

  const duplicateKit = useCallback(async () => {
    if (!draft) return;
    try {
      const row = await saveBrandKit({ name: `${draft.name || 'Untitled kit'} copy`, config: draft.config || {} });
      onReload?.();
      setSelectedKitId(row.id);
    } catch { /* ignore */ }
  }, [draft, onReload]);

  const makeDefault = useCallback(async (id) => {
    try { await setDefaultBrandKit(id); onReload?.(); } catch { /* ignore */ }
  }, [onReload]);

  const doDelete = useCallback(async () => {
    if (!draft) return;
    const id = draft.id;
    try {
      await deleteBrandKit(id);
      setConfirmDelete(false);
      const remaining = kits.filter((k) => k.id !== id);
      onReload?.();
      setSelectedKitId(remaining[0]?.id ?? null);
      setDraft(remaining[0] ? null : null);
    } catch { /* ignore */ }
  }, [draft, kits, onReload]);

  const handleLogoFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setSaveStatus('error'); return; }
    try {
      const dataUrl = await readFileAsDataURL(file);
      onPatch({ logo: dataUrl });
    } catch { setSaveStatus('error'); }
  }, [onPatch]);

  const selectedKit = useMemo(() => kits.find((k) => k.id === draft?.id) || null, [kits, draft]);
  const isDefault = !!selectedKit?.is_default;

  const statusLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? 'Saved'
      : saveStatus === 'error' ? 'Save failed — retry' : '';

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel bks-panel">
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>

        {!isAuthed ? (
          <div className="bks-empty">
            <div className="bks-empty-icon">🎨</div>
            <h2>Brand Kits</h2>
            <p>Brand kits are saved to your account. Sign in to create and edit reusable brand looks you can apply to any map.</p>
            {onRequestAuth && <button className="btn" type="button" onClick={onRequestAuth}>Sign in</button>}
          </div>
        ) : (
          <div className="bks-shell">
            {/* Left rail */}
            <div className="bks-rail">
              <div className="bks-rail-actions">
                <button className="btn compact" type="button" onClick={createKit}>+ New brand kit</button>
                <button className="btn compact secondary" type="button" onClick={captureKit} title="Save this project's current look as a new kit">Capture current settings</button>
              </div>
              {kits.length === 0 ? (
                <p className="bks-rail-empty">No brand kits yet. Create one or capture your current project.</p>
              ) : (
                <div className="bks-rail-list">
                  {kits.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className={`bks-rail-card${k.id === selectedKitId ? ' active' : ''}`}
                      onClick={() => setSelectedKitId(k.id)}
                    >
                      <RailCard
                        kit={k}
                        active={k.id === selectedKitId}
                        liveSrc={previewSrc}
                        status={k.id === draft?.id ? saveStatus : ''}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right detail */}
            <div className="bks-detail">
              {!draft ? (
                <div className="bks-empty">
                  <div className="bks-empty-icon">🎨</div>
                  <h2>Your brand, reusable</h2>
                  <p>Pick a kit on the left to edit it, or start a new one.</p>
                  <button className="btn" type="button" onClick={createKit}>+ New brand kit</button>
                </div>
              ) : (
                <>
                  <div className="bks-detail-header">
                    <div className="bks-header-main">
                      <input
                        ref={nameInputRef}
                        className="bks-name-input"
                        value={draft.name}
                        placeholder="Brand kit name"
                        onChange={(e) => onPatchName(e.target.value)}
                      />
                      <div className="bks-header-actions">
                        <button className="btn compact" type="button" onClick={() => applyToProject?.(draft.config)}>Apply to map</button>
                        <button
                          className={`btn compact secondary bks-star${isDefault ? ' active' : ''}`}
                          type="button"
                          onClick={() => !isDefault && makeDefault(draft.id)}
                          title={isDefault ? 'This is your default kit' : 'Set as default'}
                        >★ {isDefault ? 'Default' : 'Set default'}</button>
                        <button className="btn compact secondary" type="button" onClick={duplicateKit}>Duplicate</button>
                        {confirmDelete ? (
                          <>
                            <span className="bks-confirm">Delete?</span>
                            <button className="btn compact danger" type="button" onClick={doDelete}>Yes</button>
                            <button className="btn compact secondary" type="button" onClick={() => setConfirmDelete(false)}>No</button>
                          </>
                        ) : (
                          <button className="btn compact secondary bks-delete" type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
                        )}
                        <span className={`bks-status${saveStatus === 'error' ? ' bks-status-error' : ''}`}>{statusLabel}</span>
                      </div>
                    </div>
                    <img className="bks-preview" src={previewSrc} alt="Brand kit preview" />
                  </div>

                  <div className="bks-detail-body">
                    <section className="bks-section">
                      <h3>Colours &amp; theme</h3>
                      <div className="bks-color-grid">
                        {COLOR_FIELDS.map(([key, label, fallback]) => (
                          <label key={key} className="bks-field">
                            <span>{label}</span>
                            <ColorField
                              value={draft.config[key] || fallback}
                              brandColors={brandColors}
                              title={label}
                              onChange={(e) => onPatch({ [key]: e.target.value })}
                              onReset={() => onPatch({ [key]: null })}
                            />
                          </label>
                        ))}
                        <label className="bks-field">
                          <span>Theme</span>
                          <select value={draft.config.themeId || 'investor_clean'} onChange={(e) => onPatch({ themeId: e.target.value })}>
                            {Object.entries(TEMPLATE_THEMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                      </div>
                    </section>

                    <section className="bks-section">
                      <h3>Fonts</h3>
                      <div className="bks-color-grid">
                        {FONT_SLOTS.map(([slot, label]) => (
                          <label key={slot} className="bks-field">
                            <span>{label}</span>
                            <select value={draft.config.fonts?.[slot] || 'Inter'} onChange={(e) => onPatchFont(slot, e.target.value)}>
                              {Object.entries(FONT_OPTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      <p className="bks-note">Fonts are applied when you Apply the kit to a map — the preview above shows colours and logo.</p>
                    </section>

                    <section className="bks-section">
                      <h3>Logo</h3>
                      {draft.config.logo ? (
                        <div className="logo-upload-card has-logo bks-logo-row">
                          <img className="logo-thumb" src={draft.config.logo} alt="Brand logo" />
                          <div className="bks-logo-actions">
                            <button className="btn compact" type="button" onClick={() => logoInputRef.current?.click()}>Replace</button>
                            <button className="secondary-btn compact" type="button" onClick={() => onPatch({ logo: null })}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <button className="logo-upload-btn" type="button" onClick={() => logoInputRef.current?.click()}>
                          <span className="logo-upload-icon">↑</span> Upload logo
                        </button>
                      )}
                      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={handleLogoFile} />
                      <label className="bks-field bks-logo-scale">
                        <span>Logo size</span>
                        <input type="range" min="0.5" max="2" step="0.1" value={draft.config.logoScale ?? 1} onChange={(e) => onPatch({ logoScale: Number(e.target.value) })} />
                      </label>
                    </section>

                    <section className="bks-section">
                      <h3>Company &amp; QP defaults</h3>
                      <div className="bks-color-grid">
                        {COMPANY_FIELDS.map(([key, label, placeholder]) => (
                          <label key={key} className="bks-field">
                            <span>{label}</span>
                            <input
                              type="text"
                              value={draft.config[key] || ''}
                              placeholder={placeholder}
                              onChange={(e) => onPatch({ [key]: e.target.value })}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
