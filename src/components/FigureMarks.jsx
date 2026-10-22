import React from 'react';
import { LINE_STYLES, POINT_STYLES } from '../utils/figureImport.js';

// The "Lines & points" step of "Import a company figure": the colours picked
// for lines (faults, trends) and for point symbols (stars, diamonds, circles),
// the detection settings, and the review of what was found. Each find is
// pending until accepted or rejected; only accepted finds reach the map.
// Part of the lazy FigureImport chunk.

export const STATUS_COLOUR = { pending: '#f59e0b', accepted: '#16a34a', rejected: '#94a3b8' };
const STATUS_LABEL = { pending: 'to review', accepted: 'accepted', rejected: 'rejected' };
const KIND_LABEL = { line: 'Lines', point: 'Points' };

/** The finds of each set in the last detection: [{ set, finds }]. */
export function findsBySet(detection, marks) {
  if (!detection) return [];
  return detection.sets.map((s, i) => ({ set: marks.find((m) => m.id === s.id), result: detection.results[i] }))
    .filter((t) => t.set && t.result)
    .map(({ set, result }) => ({ set, finds: (set.kind === 'line' ? result.lines : result.points) || [] }));
}

const findLabel = (set, k) => `${set.kind === 'line' ? 'Line' : 'Point'} ${k + 1}`;
const findNote = (set, f) => (set.kind === 'line'
  ? `${f.teeth ? 'teeth' : f.dashed ? 'dashed' : 'solid'} · ${Math.round(f.length)} px`
  : f.shape.replace('_', ' '));

/** The finds drawn over the figure (figure pixels); a click accepts or rejects one. */
export function MarksOverlay({ detection, marks, review, zoom, onToggle }) {
  const s = detection.scale;
  return findsBySet(detection, marks).map(({ set, finds }) => finds.map((f, k) => {
    const st = review[f.id] || 'pending';
    const colour = STATUS_COLOUR[st];
    const dash = st === 'rejected' ? `${5 / zoom} ${4 / zoom}` : undefined;
    const common = {
      key: f.id,
      role: 'button',
      'aria-label': `${findLabel(set, k)} of ${set.name || KIND_LABEL[set.kind]}: ${STATUS_LABEL[st]}`,
      'data-find': f.id,
      'data-status': st,
      className: 'fig-find',
      onClick: (e) => { e.stopPropagation(); onToggle(f.id); },
    };
    if (set.kind === 'line') {
      const pts = f.points.map(([x, y]) => `${(x * s).toFixed(1)},${(y * s).toFixed(1)}`).join(' ');
      return (
        <g {...common}>
          <polyline points={pts} fill="none" stroke="transparent" strokeWidth={14 / zoom} />
          <polyline points={pts} fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth={6 / zoom} strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts} fill="none" stroke={colour} strokeWidth={3 / zoom} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }
    return (
      <g {...common}>
        <circle cx={f.x * s} cy={f.y * s} r={(f.size * s) / 2 + 5 / zoom} fill="transparent" stroke="#ffffff" strokeOpacity="0.8" strokeWidth={5 / zoom} />
        <circle cx={f.x * s} cy={f.y * s} r={(f.size * s) / 2 + 5 / zoom} fill="transparent" stroke={colour} strokeWidth={2.5 / zoom} strokeDasharray={dash} />
      </g>
    );
  }));
}

export function MarksControls({
  marks, setMarks, activeMark, setActiveMark, newKind, setNewKind, opts, setOpts, detection, review, setReview,
  detecting, onDetect, area, areaPick, setAreaPick, setArea, error,
}) {
  const bySet = new Map(findsBySet(detection, marks).map((t) => [t.set.id, t.finds]));
  const update = (id, patch) => setMarks((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const setAll = (finds, status) => setReview((rv) => ({ ...rv, ...Object.fromEntries(finds.map((f) => [f.id, status])) }));
  return (
    <>
      <p className="small-note">
        Pick a colour: &ldquo;+ Lines&rdquo; or &ldquo;+ Points&rdquo;, then click a fault, a trend or a symbol on the figure (add samples where it looks different).
        Detect, then review each find: click it on the figure, or below, to accept or reject it. Only accepted finds are added to the map.
        Lettering and other colours are left out; &ldquo;Limit to an area&rdquo; leaves out the legend and title too.
      </p>
      {marks.map((m) => {
        const finds = bySet.get(m.id);
        const styles = m.kind === 'line' ? LINE_STYLES : POINT_STYLES;
        const n = (st) => (finds || []).filter((f) => (review[f.id] || 'pending') === st).length;
        return (
          <div key={m.id} className={`fig-mark${activeMark === m.id ? ' is-active' : ''}`} data-testid="fig-mark">
            <div className="fig-unit">
              <input type="radio" name="fig-mark" aria-label="Sample this colour" checked={activeMark === m.id} onChange={() => { setActiveMark(m.id); setNewKind(null); }} />
              <span className="fig-kind">{KIND_LABEL[m.kind]}</span>
              <input type="color" className="fig-swatch" aria-label="Layer colour" value={m.colour} onChange={(e) => update(m.id, { colour: e.target.value })} />
              <input aria-label="Layer name" placeholder={m.kind === 'line' ? 'Name from the legend, e.g. Fault (inferred)' : 'Name from the legend, e.g. Discovery intersection'} value={m.name}
                onChange={(e) => update(m.id, { name: e.target.value })} />
              <select aria-label="Style" value={m.style} onChange={(e) => update(m.id, { style: e.target.value, styleAuto: false })}>
                {styles.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {m.kind === 'line' && m.style === 'thrust' && (
                <select aria-label="Teeth side" value={m.teeth || 'left'} onChange={(e) => update(m.id, { teeth: e.target.value })}>
                  <option value="left">Teeth left</option><option value="right">Teeth right</option>
                </select>
              )}
              <span className="small-note">{m.samples.length} sample{m.samples.length === 1 ? '' : 's'}</span>
              <label className="fig-tol">Tolerance
                <input type="range" min="4" max="40" value={m.tolerance} onChange={(e) => update(m.id, { tolerance: Number(e.target.value) })} />
              </label>
              <button type="button" className="fig-x" aria-label="Remove colour" onClick={() => setMarks((prev) => prev.filter((x) => x.id !== m.id))}>×</button>
            </div>
            {finds && (
              <div className="fig-row fig-review">
                <span className="fig-label" data-testid="fig-review-count">{finds.length} found · {n('accepted')} accepted · {n('rejected')} rejected</span>
                {finds.length > 0 && (
                  <>
                    <button type="button" className="fig-chip" onClick={() => setAll(finds, 'accepted')}>Accept all</button>
                    <button type="button" className="fig-chip" onClick={() => setAll(finds, 'rejected')}>Reject all</button>
                  </>
                )}
                {finds.map((f, k) => {
                  const st = review[f.id] || 'pending';
                  return (
                    <button key={f.id} type="button" className={`fig-chip fig-find-chip is-${st}`} aria-pressed={st === 'accepted'} title={findNote(m, f)}
                      onClick={() => setReview((rv) => ({ ...rv, [f.id]: st === 'accepted' ? 'rejected' : 'accepted' }))}>
                      {st === 'accepted' ? '✓ ' : st === 'rejected' ? '✕ ' : ''}{findLabel(m, k)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="fig-row">
        <button type="button" className={`fig-chip${newKind === 'line' ? ' is-active' : ''}`} onClick={() => { setNewKind(newKind === 'line' ? null : 'line'); setActiveMark(null); }}>
          {newKind === 'line' ? 'Click a line on the figure…' : '+ Lines of a colour'}
        </button>
        <button type="button" className={`fig-chip${newKind === 'point' ? ' is-active' : ''}`} onClick={() => { setNewKind(newKind === 'point' ? null : 'point'); setActiveMark(null); }}>
          {newKind === 'point' ? 'Click a symbol on the figure…' : '+ Points of a colour'}
        </button>
        <button type="button" className={`fig-chip${areaPick ? ' is-active' : ''}`} onClick={() => setAreaPick(areaPick ? null : 'first')}>{areaPick ? 'Click two corners…' : 'Limit to an area'}</button>
        {area && <button type="button" className="fig-chip" onClick={() => setArea(null)}>Whole figure</button>}
      </div>
      <div className="fig-row">
        <label htmlFor="fig-minlen">Shortest line</label>
        <input id="fig-minlen" type="range" min="10" max="300" step="5" value={opts.minLength} onChange={(e) => setOpts({ ...opts, minLength: Number(e.target.value) })} />
        <span className="range-value">{opts.minLength} px</span>
        <label htmlFor="fig-gapj">Join gaps up to</label>
        <input id="fig-gapj" type="range" min="0" max="40" value={opts.maxGap} onChange={(e) => setOpts({ ...opts, maxGap: Number(e.target.value) })} />
        <span className="range-value">{opts.maxGap} px</span>
        <label htmlFor="fig-minsym">Smallest symbol</label>
        <input id="fig-minsym" type="range" min="3" max="40" value={opts.minSize} onChange={(e) => setOpts({ ...opts, minSize: Number(e.target.value) })} />
        <span className="range-value">{opts.minSize} px</span>
        <button type="button" className="btn primary" disabled={detecting || !marks.some((m) => m.samples.length)} onClick={onDetect}>{detecting ? 'Detecting…' : 'Detect'}</button>
      </div>
      {error && <div className="export-hd-error" role="alert">{error}</div>}
    </>
  );
}
