import React from 'react';
import ColorField from './ColorField.jsx';
import { attributeFields, buildGraduated, buildCategorical, classLabel, MAX_CATEGORIES, hasClassSizes, withClassSizes, withoutClassSizes } from '../utils/classification.js';
import { DEFAULT_POINT_SIZE, clampPointSize } from '../utils/pointSymbol.js';

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
  const baseSize = Number(selectedLayer.style?.markerSize) || DEFAULT_POINT_SIZE;
  const sizedByClass = isPt && hasClassSizes(cls);
  // Rebuilding classes (new field, method or count) keeps "Size by class" on
  // when it was on, and keeps each edited size where the class still exists:
  // matched by value for categories, by position when the break count holds.
  const build = (field, mode, n) => {
    const next = mode === 'graduated'
      ? buildGraduated(selectedLayer, field, n || 4)
      : buildCategorical(selectedLayer, field);
    // Rebuilding keeps the classification's own options.
    if (cls?.outlineFollowsClass) next.outlineFollowsClass = true;
    if (!sizedByClass) return next;
    const sized = withClassSizes(next, baseSize);
    const prev = cls?.classes || [];
    const sameCount = cls?.mode === 'graduated' && mode === 'graduated' && prev.length === sized.classes.length;
    return {
      ...sized,
      classes: sized.classes.map((c, i) => {
        const old = mode === 'categorical'
          ? prev.find((p) => p.value !== undefined && String(p.value) === String(c.value))
          : (sameCount ? prev[i] : null);
        return old && Number.isFinite(old.size) ? { ...c, size: old.size } : c;
      }),
    };
  };
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
            {!isPt && selectedLayer.type !== 'line' && (
              <label className="toggle-row" title="On: each area's outline takes its class colour as well as its fill.">
                <input type="checkbox" checked={!!cls.outlineFollowsClass}
                  onChange={(e) => setCls({ ...cls, outlineFollowsClass: e.target.checked })} />
                <span>Outline follows class colour</span>
              </label>
            )}
            {isPt && (
              <label className="toggle-row" title="Off: every class uses the layer's Point Size. On: each class sets its own size.">
                <input type="checkbox" checked={sizedByClass}
                  onChange={(e) => setCls(e.target.checked ? withClassSizes(cls, baseSize) : withoutClassSizes(cls))} />
                <span>Size by class{sizedByClass ? ' — overrides the layer Point Size' : ''}</span>
              </label>
            )}
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
                    {sizedByClass && (
                      // Blank = inherit the layer size. The field used to show 10
                      // for a class with no size while the map drew the layer size.
                      <input className="class-size" type="number" min="1" max="64" step="0.5"
                        value={Number.isFinite(c.size) ? c.size : ''} placeholder={String(baseSize)}
                        aria-label="Point size (px, diameter)" title="Point diameter in px — blank uses the layer size"
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : clampPointSize(e.target.value);
                          patch({ size: v == null ? undefined : v });
                        }} />
                    )}
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
