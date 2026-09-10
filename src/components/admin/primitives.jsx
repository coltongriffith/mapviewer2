import React, { useState } from 'react';
import { fmtNum, formatDelta, STATUS_LABEL } from './metrics';

// Shared UI kit for the dashboard v2 tabs. Extends the existing .adm-* design
// tokens (see styles.css) — new classes are prefixed .admx-. All components
// degrade gracefully at zero/low data.

// ── InfoTip: CSS-only hover/focus tooltip for metric definitions ─────────────
export function InfoTip({ text, label }) {
  if (!text) return null;
  return (
    <span className="admx-info" tabIndex={0} role="img" aria-label={label ? `${label}: ${text}` : text}>
      <span aria-hidden="true">ⓘ</span>
      <span className="admx-info-pop" role="tooltip">{text}</span>
    </span>
  );
}

// ── DeltaChip: implements the F4 small-number rules via formatDelta ──────────
export function DeltaChip({ cur, prior, goodDirection = 'up' }) {
  const d = formatDelta(cur, prior, goodDirection);
  if (!d) return null;
  return <span className={`admx-delta admx-delta-${d.tone}`} title={d.title}>{d.text}</span>;
}

// ── Sparkline: up to 14 points, no axes; hidden when <3 nonzero points ───────
export function Sparkline({ points = [], accent = '#142126' }) {
  const vals = points.map((p) => (typeof p === 'number' ? p : Number(p?.value) || 0));
  const nonzero = vals.filter((v) => v > 0).length;
  if (nonzero < 3) return <span className="admx-spark-empty" aria-hidden="true" />;
  const w = 64, h = 22, pad = 2;
  const max = Math.max(...vals, 1);
  const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const dpath = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="admx-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={dpath} fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <circle cx={lx} cy={ly} r="2.4" fill={accent} stroke="#fff" strokeWidth="1" />
    </svg>
  );
}

// ── StatTile: label+InfoTip · value · DeltaChip · Sparkline · detail ─────────
export function StatTile({ label, tip, value, loading, delta, spark, detail, accent = '#142126' }) {
  return (
    <div className="admx-tile" style={{ '--admx-accent': accent }}>
      <div className="admx-tile-head">
        <span className="admx-tile-label">{label}</span>
        <InfoTip text={tip} label={label} />
      </div>
      {loading ? (
        <span className="adm-skeleton" style={{ width: 64, height: 30, display: 'inline-block' }} />
      ) : (
        <div className="admx-tile-value">{value}</div>
      )}
      <div className="admx-tile-foot">
        {!loading && delta}
        {!loading && spark}
      </div>
      {detail && <div className="admx-tile-detail">{detail}</div>}
    </div>
  );
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  return <span className={`admx-badge admx-badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

// ── ActivityDots: 14-day strip, filled=value day, light=active-only ──────────
export function ActivityDots({ dots = [] }) {
  return (
    <span className="admx-dots" aria-hidden="true">
      {dots.map((lvl, i) => (
        <span key={i} className={`admx-dot admx-dot-${Number(lvl) || 0}`} />
      ))}
    </span>
  );
}

// ── EmptyHint: one muted sentence explaining what will appear + trigger ──────
export function EmptyHint({ children, since }) {
  return (
    <div className="admx-empty">
      <span>{children}</span>
      {since && <span className="admx-empty-since">tracking began {since}</span>}
    </div>
  );
}

// ── Skeleton rows for tables/cards ───────────────────────────────────────────
// ── ColumnChart: integer y-axis columns + optional context/overlay lines ─────
// series: [{ d, active_users, sessions, signups }]. Click a column → onPick(d).
// Bars and line are configurable so the same chart serves the Activity tab
// (bars = signed-in active users, line = page views) and the Growth landing
// tab (bars = visitor tabs, line = signed-in users), where a signed-in-only
// chart on a young product is flat zero and reads as missing data.
export function ColumnChart({
  series = [], onPick,
  barKey = 'active_users', barLabel = 'active users',
  lineKey = 'sessions', lineLabel = 'page views',
  ariaLabel = 'Daily active users',
  empty = 'No signed-in activity in this window yet. Anonymous traffic is on the Acquisition tab.',
}) {
  const [hover, setHover] = useState(null);
  if (!series.length) return <EmptyHint>{empty}</EmptyHint>;
  const W = 720, H = 200, padL = 28, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxA = Math.max(...series.map((s) => Number(s[barKey]) || 0), 2);
  // integer y ticks: 0..maxA stepped to ~4 lines
  const step = Math.max(1, Math.ceil(maxA / 4));
  const top = Math.ceil(maxA / step) * step;
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const n = series.length;
  const bw = Math.min(24, (iw / n) * 0.62);
  const x = (i) => padL + (iw / n) * (i + 0.5);
  const y = (v) => padT + ih - (v / top) * ih;
  const maxSess = Math.max(...series.map((s) => Number(s[lineKey]) || 0), 1);
  const ys = (v) => padT + ih - (v / maxSess) * ih;
  const hasSignups = series.some((s) => Number(s.signups) > 0);
  const sessPath = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${ys(Number(s[lineKey]) || 0).toFixed(1)}`).join(' ');
  return (
    <div className="admx-col-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="admx-col" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--em-slate-100, #edf1f0)" />
            <text x={0} y={y(t) + 3} className="admx-col-tick">{t}</text>
          </g>
        ))}
        {series.map((s, i) => {
          const v = Number(s[barKey]) || 0;
          const bh = top ? (v / top) * ih : 0;
          return (
            <rect key={i} x={x(i) - bw / 2} y={padT + ih - bh} width={bw} height={bh}
              rx="2" className={`admx-col-bar${s.dashed ? ' admx-col-bar-est' : ''}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(String(s.d).slice(0, 10))} style={{ cursor: onPick ? 'pointer' : 'default' }} />
          );
        })}
        <path d={sessPath} fill="none" stroke="var(--em-slate-300, #c6cecf)" strokeWidth="1.5" />
        {hasSignups && series.map((s, i) => (Number(s.signups) > 0
          ? <circle key={i} cx={x(i)} cy={y(Number(s[barKey]) || 0)} r="2" fill="#176b87" /> : null))}
      </svg>
      {hover != null && (
        <div className="admx-col-tip">
          <strong>{new Date(`${String(series[hover].d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          {' · '}{fmtNum(series[hover][barKey])} {barLabel}{' · '}{fmtNum(series[hover][lineKey])} {lineLabel}
          {Number(series[hover].signups) > 0 ? ` · ${series[hover].signups} signup` : ''}
        </div>
      )}
      <div className="admx-col-legend">
        <span><i className="admx-lg-bar" /> {barLabel}</span>
        <span><i className="admx-lg-line" /> {lineLabel}</span>
        {hasSignups && <span><i className="admx-lg-dot" /> signups</span>}
      </div>
    </div>
  );
}

// ── RetentionLadder: one stacked bar of all accounts by recency bucket ───────
// One recency ramp, dark = most recent, with only the lapsed tail warmed so
// the eye lands on it. A five-hue rainbow implied five unrelated categories.
//
// Each step carries its own ink: the count sits inside the segment, and white
// on the two pale steps is unreadable.
const LADDER_STEPS = [
  { fill: '#142126', ink: '#ffffff' },
  { fill: '#435459', ink: '#ffffff' },
  { fill: '#7c898c', ink: '#ffffff' },
  { fill: '#c6cecf', ink: '#142126' },
  { fill: '#e5c3b2', ink: '#142126' },
];
const LADDER_FALLBACK = { fill: '#dde3e3', ink: '#142126' };
export function RetentionLadder({ buckets = [], onPick }) {
  const total = buckets.reduce((s, b) => s + (Number(b.count) || 0), 0);
  if (!total) return <EmptyHint>No registered users yet. Signups will bucket here by how recently they did meaningful work.</EmptyHint>;
  return (
    <div className="admx-ladder-wrap">
      <div className="admx-ladder" role="group" aria-label="Users by recency">
        {buckets.map((b, i) => {
          const c = Number(b.count) || 0;
          if (!c) return null;
          const pct = (c / total) * 100;
          return (
            <button type="button" aria-label={`${b.bucket}: ${c} accounts`} key={b.bucket} className="admx-ladder-seg" title={`${b.bucket}: ${c}`}
              style={{
                width: `${pct}%`,
                background: (LADDER_STEPS[i] || LADDER_FALLBACK).fill,
                color: (LADDER_STEPS[i] || LADDER_FALLBACK).ink,
                cursor: onPick ? 'pointer' : 'default',
              }}
              onClick={() => onPick?.(b.bucket)}>
              {pct > 9 ? c : ''}
            </button>
          );
        })}
      </div>
      <div className="admx-ladder-legend">
        {buckets.map((b, i) => (
          <span key={b.bucket} className="admx-ladder-key">
            <i style={{ background: (LADDER_STEPS[i] || LADDER_FALLBACK).fill }} />{b.bucket} <strong>{fmtNum(b.count)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Funnel: X-of-N stage rows with % suppressed below SMALL_N ────────────────
export function FunnelV2({ steps = [], unit = 'users', onPickStage, sequential = false }) {
  const top = Math.max(...steps.map((s) => Number(s.count) || 0), 0);
  if (!steps.length || top === 0) return <EmptyHint>Not enough activity to draw this funnel yet.</EmptyHint>;
  return (
    <div className="admx-funnel">
      {steps.map((s, i) => {
        const c = Number(s.count) || 0;
        const w = (c / top) * 100;
        const prev = i > 0 ? Number(steps[i - 1].count) || 0 : null;
        const conv = prev && prev > 0 ? Math.round((c / prev) * 100) : null;
        return (
          <div key={i} className={`admx-funnel-row${s.stuck?.length ? ' admx-funnel-clickable' : ''}`}
            role="button" tabIndex={s.stuck?.length ? 0 : -1} aria-disabled={!s.stuck?.length}
            onKeyDown={e => { if (s.stuck?.length && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPickStage?.(s); } }}
            onClick={() => s.stuck?.length && onPickStage?.(s)}>
            <div className="admx-funnel-label">{s.stage}</div>
            <div className="admx-funnel-track"><div className="admx-funnel-fill" style={{ width: `${Math.max(w, 2)}%` }} /></div>
            <div className="admx-funnel-val">
              {fmtNum(c)} <span className="admx-funnel-unit">{unit}</span>
              {sequential && conv != null && prev >= 8 && <span className="admx-funnel-conv">{conv}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── HBars: horizontal bars with "n · by k users" secondary ───────────────────
export function HBarsV2({ rows = [], color = '#142126', empty }) {
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  if (!rows.length) return empty || <EmptyHint>No data in this window yet.</EmptyHint>;
  return (
    <div className="admx-hbars">
      {rows.map((r, i) => (
        <div key={i} className="admx-hbar-row">
          <span className="admx-hbar-label" title={r.label}>{r.label}</span>
          <span className="admx-hbar-track"><span className="admx-hbar-fill" style={{ width: `${((Number(r.value) || 0) / max) * 100}%`, background: color }} /></span>
          <span className="admx-hbar-val">{fmtNum(r.value)}{r.sub ? <em> · {r.sub}</em> : null}</span>
        </div>
      ))}
    </div>
  );
}

// Shared report shell keeps spacing, headings and help consistent across tabs.
export function Card({ title, tip, eyebrow, action, count, children, full, className = '' }) {
  return <section className={`adm-card${full ? ' adm-card-full' : ''} ${className}`}>
    <div className="adm-card-head"><div>
      {eyebrow && <div className="admx-eyebrow">{eyebrow}</div>}
      <h3 className="adm-card-title">{title}{tip && <InfoTip text={tip} label={title} />}</h3>
    </div>{action}{count != null && <span className="adm-pill">{count}</span>}</div>
    {children}
  </section>;
}
