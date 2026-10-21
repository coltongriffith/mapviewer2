// Intercepts (pure), shared by Exploration Maps 3D's callouts (studio.js draws them) and the property page's
// results table (shared/drillResults.js), so a figure and a release table composite holes the same way.
// The run above the broad cut-off holding the most metal (internal dilution up to 6 m), then the longest
// stretch inside it at or above the "incl." cut-off.
// ints: one hole's assay intervals [{ from, to, vals }], sorted by from; samples without a value in col do
// not count (they are unsampled for that column).
//
// sampled (figure design version 2): only sampled metres count. A gap between samples (the next from beyond
// the last to by more than TOL) ends the run, so two zones 90 m apart are never one interval. An overlapping
// sample (from before the last to by more than TOL) is trimmed to start where the last ended, and dropped if
// nothing is left: the earlier-starting sample keeps its length, and no metre counts twice. Lengths are the
// sum of the sampled lengths in the run, grades are length-weighted, and "incl." stays inside the run.
// Not sampled (version 1, figures saved before): the earlier numbers, which span gaps and overlaps; the
// result then says what the reported interval spans (gap: the widest unsampled gap in m, overlap: true), so
// the page can warn and offer a recalculation.
export const TOL = 0.01;
// One column's samples, in depth order; sampled: overlaps trimmed or dropped as above.
export function samples(ints, col, sampled = true) {
  const seq = ints.map((it) => ({ from: it.from, to: it.to, v: it.vals[col] })).filter((it) => Number.isFinite(it.v));
  if (!sampled) return seq;
  const out = [];
  seq.sort((a, b) => a.from - b.from).forEach((it) => { const p = out[out.length - 1]; if (!p || it.from >= p.to - TOL) out.push(it); else if (it.to > p.to + TOL) out.push({ ...it, from: p.to }); });
  return out;
}
const lenOf = (run) => run.reduce((s, x) => s + (x.to - x.from), 0);
// Every run of samples at or above cut, in depth order, at least minLen long: { run, metal, L }. A run takes in
// samples below cut (internal dilution) until the waste after its last sample at or above cut is more than
// maxDil metres long, and (sampled) ends at a gap; it runs from its first to its last sample at or above cut.
// L: its sampled metres (or, not sampled, its span); metal: grade × length summed over the run.
export function runs(seq, cut, minLen, sampled = true, maxDil = 6) {
  const out = []; let start = -1, lastHit = -1;
  const close = () => {
    if (start < 0) return; const run = seq.slice(start, lastHit + 1), L = sampled ? lenOf(run) : run[run.length - 1].to - run[0].from;
    if (L >= minLen) out.push({ run, metal: run.reduce((s, x) => s + x.v * (x.to - x.from), 0), L }); start = -1;
  };
  seq.forEach((it, i) => {
    if (sampled && i && it.from > seq[i - 1].to + TOL) close();
    if (it.v >= cut) { if (start < 0) start = i; lastHit = i; }
    else if (start >= 0 && it.to - seq[lastHit].to > maxDil) close();
  });
  close();
  return out;
}
export function intercept(ints, col, cut, inclCut, minLen, sampled = true) {
  // The first run holding the most metal.
  const best = runs(samples(ints, col, sampled), cut, minLen, sampled).reduce((b, r) => (!b || r.metal > b.metal ? r : b), null);
  if (!best) return null;
  const run = best.run, len = best.L;
  const broad = { len, avg: best.metal / lenOf(run), from: run[0].from, mid: (run[0].from + run[run.length - 1].to) / 2 };
  let incl = null;
  for (let i = 0; i < run.length; i++) { let m = 0, l = 0;
    for (let j = i; j < run.length; j++) { m += run[j].v * (run[j].to - run[j].from); l += run[j].to - run[j].from; const span = sampled ? l : run[j].to - run[i].from;
      if (span >= Math.min(minLen / 2, 10) && span < len * 0.8 && m / l >= inclCut && (!incl || span > incl.len)) incl = { len: span, avg: m / l, from: run[i].from }; } }
  if (sampled) return { broad, incl };
  let gap = 0, overlap = false;
  for (let i = 1; i < run.length; i++) { const d = run[i].from - run[i - 1].to; if (d > TOL) gap = Math.max(gap, d); if (d < -TOL) overlap = true; }
  return { broad, incl, gap, overlap };
}

// Length-weighted average of another column over the same depths, for the second element in a callout;
// sampled: overlapping metres count once, as for the first.
export function avgOver(ints, col, from, to, sampled = true) {
  let m = 0, l = 0; samples(ints, col, sampled).forEach((it) => { const a = Math.max(from, it.from), b = Math.min(to, it.to); if (b > a) { m += it.v * (b - a); l += b - a; } });
  return l > 0 ? m / l : null;
}

// A grade as the callouts write it: whole numbers from 100, one decimal from 10, three below 0.01, else two
// (dp: a fixed number of decimals instead). label: "CuEq %", "Au g/t" → "0.61% CuEq", "0.21 g/t Au".
export const fmtGrade = (v, dp) => (dp != null ? v.toFixed(dp) : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2));
export const gradeText = (v, label, dp) => { const unit = (label.match(/(%|g\/t|ppm|ppb)$/) || [''])[0], el = label.replace(/\s*(%|g\/t|ppm|ppb)$/, ''); return `${fmtGrade(v, dp)}${unit === '%' ? '%' : ' ' + unit} ${el}`; };

// A callout's text lines: the automatic ones from the intercept (text(x) words an interval), unless reworded
// by hand (o: the hole's override; line1/line2 replace a line, incl: false drops the second).
export function calloutText(ic, o, text) {
  return { l1: o.line1 || text(ic.broad), l1b: o.line1 ? '' : ` from ${Math.round(ic.broad.from)} m`, l2: o.incl === false ? null : (o.line2 || (ic.incl ? `incl. ${text(ic.incl)}` : null)) };
}

// Ribbon pieces the callouts could need on either ribbon mesh: one per 8 m of every interval, reported and
// "incl.", plus one each (the page draws at most that many on each); the meshes are sized to hold them.
export const ribbonPieces = (callouts) => callouts.reduce((s, { ic }) => s + [ic.broad, ...(ic.incls || [ic.incl])].reduce((t, x) => t + (x ? Math.ceil(x.len / 8) + 1 : 0), 0), 0);
