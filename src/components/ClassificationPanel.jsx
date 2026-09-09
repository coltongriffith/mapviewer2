import React from 'react';
import ColorField from './ColorField.jsx';
import { attributeFields, buildGraduated, buildCategorical, classLabel, MAX_CATEGORIES } from '../utils/classification.js';

// Colour by attribute: ranges of a numeric column or one colour per unique
// value, each class its own legend row. Loaded on demand — it is a large
// panel used by a minority of layers, and the editor's first load should
// not carry it.
export default function ClassificationPanel({ layer, isPoint, updateLayer, brandColors }) {
  const selectedLayer = layer;
  const isPt = isPoint;
  const fields = attributeFields(selectedLayer);
  if (!fields.length) return null;
  const cls = selectedLayer.classification || null;
  const setCls = (next) => updateLayer(selectedLayer.id, { classification: next });
  const build = (field, mode, n) => (mode === 'graduated'
    ? buildGraduated(selectedLayer, field, n || 4)
    : buildCategorical(selectedLayer, field));
  return (
    <details className="sub-details" open={!!cls} style={{ marginTop: 8 }}>
      <summary>Colour by attribute</summary>
      <div className="sub-details-body">
        <div className="control-row">
          <label htmlFor="f-class-field">Attribute</label>
          <select
            id="f-class-field"
            value={cls?.field || ''}
            onChange={(e) => {
              const f = e.target.value;
              if (!f) { setCls(null); return; }
              const numeric = fields.find((x) => x.key === f)?.numeric;
              setCls(build(f, numeric ? 'graduated' : 'categorical', cls?.classes?.length));
            }}
          >
            <option value="">None (one style for the layer)</option>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.key}{f.numeric ? ' (numeric)' : ''}</option>)}
          </select>
        </div>
        {cls && (
          <>
            <div className="control-row inline-2">
              <div>
                <label htmlFor="f-class-mode">Method</label>
                <select id="f-class-mode" value={cls.mode} onChange={(e) => setCls(build(cls.field, e.target.value, cls.classes.length))}>
                  <option value="graduated">Ranges</option>
                  <option value="categorical">Unique values</option>
                </select>
              </div>
              {cls.mode === 'graduated' && (
                <div>
                  <label htmlFor="f-class-count">Classes</label>
                  <select id="f-class-count" value={cls.classes.length} onChange={(e) => setCls(build(cls.field, 'graduated', Number(e.target.value)))}>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="class-list">
              {cls.classes.map((c, i) => {
                const patch = (pch) => setCls({ ...cls, classes: cls.classes.map((k, j) => (j === i ? { ...k, ...pch } : k)) });
                const last = i === cls.classes.length - 1;
                return (
                  <div className="class-row" key={i}>
                    <ColorField value={c.color} onChange={(e) => patch({ color: e.target.value })} brandColors={brandColors} />
                    {cls.mode === 'graduated'
                      ? (last
                        ? <span className="class-max small-note">and above</span>
                        : <input className="class-max" type="number" value={c.max ?? ''} aria-label="Class upper limit" title="Upper limit (inclusive)" onChange={(e) => patch({ max: e.target.value === '' ? null : Number(e.target.value) })} />)
                      : <span className="class-max small-note" title={String(c.value)}>{String(c.value)}</span>}
                    {isPt && <input className="class-size" type="number" min="4" max="30" value={c.size ?? 10} aria-label="Point size" title="Point size (px)" onChange={(e) => patch({ size: Number(e.target.value) })} />}
                    <input className="class-label" value={c.label || ''} placeholder={classLabel(cls, i)} aria-label="Legend label" onChange={(e) => patch({ label: e.target.value })} />
                  </div>
                );
              })}
            </div>
            {cls.truncated && <p className="small-note">Only the {MAX_CATEGORIES} most common values are classed; the rest keep the layer's style.</p>}
            <p className="small-note">Features with no value keep the layer's own style. Each class is its own legend row.</p>
          </>
        )}
      </div>
    </details>
  );
}
