import React, { useState } from 'react';
import { studioCard, labelHalo, studioNorthStyle } from '../utils/studioCards.js';

// The Studio theme's settings (layout.studio, layout.labelHalo, fullBleed), shown under the theme picker
// while Studio is the theme. Loaded only then.

const CARDS = [['title', 'Title'], ['legend', 'Legend'], ['inset', 'Locator'], ['scale', 'Scale & north'], ['callout', 'Results']];
const NORTH = [['rose', 'Studio rose'], ['split', 'Split arrow'], ['arrow', 'Simple arrow'], ['surveyor', 'Surveyor'], ['decorative', 'Decorative']];
const CORNERS = [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']];

function Text({ label, value, placeholder, onChange }) {
  return (
    <label className="control-row">
      <span>{label}</span>
      <input type="text" value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function StudioControls({ layout, updateLayout }) {
  const s = layout.studio || {};
  const [kind, setKind] = useState('title');
  const setStudio = (patch) => updateLayout({ studio: { ...s, ...patch } });
  const card = studioCard(layout, kind);
  const setCard = (patch) => setStudio({ cards: { ...(s.cards || {}), [kind]: { ...(s.cards?.[kind] || {}), ...patch } } });
  const halo = labelHalo(layout);
  const setHalo = (patch) => updateLayout({ labelHalo: { ...(halo || { color: '#ffffff', width: 3, opacity: 0.9 }), enabled: true, ...patch } });

  return (
    <div className="studio-controls" data-testid="studio-controls">
      <h3 className="ins-sub-title">Studio title card</h3>
      <Text label="Caps line" value={s.kicker} placeholder={layout.companyName ? String(layout.companyName).toUpperCase() : 'COMPANY · TSXV: TICK'} onChange={(v) => setStudio({ kicker: v })} />
      <label className="control-row">
        <span>Position</span>
        <select value={layout.titleCorner || 'tl'} onChange={(e) => updateLayout({ titleCorner: e.target.value, cornerLayout: null })}>
          {CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={!!s.titleScale} onChange={(e) => setStudio({ titleScale: e.target.checked })} />
        <span>Scale bar and north arrow in the title card</span>
      </label>

      <h3 className="ins-sub-title">Scale and north</h3>
      <label className="toggle-row">
        <input type="checkbox" checked={s.scaleNorth !== false} disabled={!!s.titleScale} onChange={(e) => setStudio({ scaleNorth: e.target.checked })} />
        <span>Scale bar beside the north arrow, one card</span>
      </label>
      <Text label="Datum note" value={s.datumNote} placeholder="From the map (e.g. NAD83 / UTM Zone 10N)" onChange={(v) => setStudio({ datumNote: v || undefined })} />
      <Text label="Second line" value={s.datumSub} placeholder="e.g. Grid: UTM ticks on frame" onChange={(v) => setStudio({ datumSub: v })} />
      <label className="control-row">
        <span>North arrow</span>
        <select value={studioNorthStyle(layout)} onChange={(e) => updateLayout({ northArrowStyle: e.target.value })}>
          {NORTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <h3 className="ins-sub-title">Locator card</h3>
      <Text label="Heading" value={layout.insetTitle} placeholder="Project location" onChange={(v) => updateLayout({ insetTitle: v })} />
      <Text label="Pill" value={s.pill} placeholder="e.g. TSXV: TICK" onChange={(v) => setStudio({ pill: v })} />
      <Text label="Project name at the marker" value={s.projectLabel} placeholder="e.g. RABBIT NORTH" onChange={(v) => setStudio({ projectLabel: v })} />
      <Text label="Caption" value={layout.insetLabel} placeholder="The province or state" onChange={(v) => updateLayout({ insetLabel: v })} />

      <h3 className="ins-sub-title">Card style</h3>
      <div className="button-row" role="radiogroup" aria-label="Card">
        {CARDS.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={kind === v} className={`secondary-btn${kind === v ? ' active' : ''}`} onClick={() => setKind(v)}>{l}</button>
        ))}
      </div>
      <label className="control-row">
        <span>Paper</span>
        <select value={card.tone} onChange={(e) => setCard({ tone: e.target.value })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="control-row">
        <span>Accent bar</span>
        <select value={card.accent} onChange={(e) => setCard({ accent: e.target.value })}>
          <option value="left">Left</option>
          <option value="top">Top</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="control-row">
        <span>Corner radius {card.radius}px</span>
        <input type="range" min="0" max="24" step="1" value={card.radius} onChange={(e) => setCard({ radius: Number(e.target.value) })} />
      </label>
      <label className="control-row">
        <span>Background {Math.round(card.opacity * 100)}%</span>
        <input type="range" min="0" max="1" step="0.02" value={card.opacity} onChange={(e) => setCard({ opacity: Number(e.target.value) })} />
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={card.shadow} onChange={(e) => setCard({ shadow: e.target.checked })} />
        <span>Soft shadow</span>
      </label>

      <h3 className="ins-sub-title">Labels</h3>
      <label className="toggle-row">
        <input type="checkbox" checked={!!halo} onChange={(e) => (e.target.checked ? setHalo({}) : updateLayout({ labelHalo: { ...(halo || {}), enabled: false } }))} />
        <span>Halo round map labels and callout text</span>
      </label>
      {halo && (
        <div className="button-row">
          <label className="control-row"><span>Colour</span><input type="color" value={halo.color} onChange={(e) => setHalo({ color: e.target.value })} /></label>
          <label className="control-row"><span>Width {halo.width}px</span><input type="range" min="0" max="8" step="0.5" value={halo.width} onChange={(e) => setHalo({ width: Number(e.target.value) })} /></label>
          <label className="control-row"><span>Opacity {Math.round(halo.opacity * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={halo.opacity} onChange={(e) => setHalo({ opacity: Number(e.target.value) })} /></label>
        </div>
      )}

      <h3 className="ins-sub-title">Layout</h3>
      <label className="toggle-row">
        <input
          type="checkbox" checked={!!layout.fullBleed}
          onChange={(e) => { const on = e.target.checked; updateLayout({ fullBleed: on, showTitle: !on, showLegend: !on, insetEnabled: !on }); }}
        />
        <span>Full bleed: the map fills the frame (no title, legend or locator)</span>
      </label>
    </div>
  );
}
