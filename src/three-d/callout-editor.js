// The intercept callout editor in the Layout step (Exploration Maps 3D), loaded when that step first shows.
// Calculated and manual mode: a row per hole (tick to show, two lines of wording). Published mode: a row per
// published result, "incl." ones indented under their parent, with one line of wording each and its flags.
// H (studio.js): { S, esc, PR, read, callouts, calc, shown, icText, gaps, setCallout, setStyle, status, redraw }.

import { icAt } from './published-results.js';

const m = (v) => `${+v.toFixed(2)}`;

export function render(el, H) {
  // The source of the callouts; the cut-offs do not apply to published results.
  document.getElementById('co-mode').value = H.S.calloutMode; document.querySelectorAll('[data-co-calc]').forEach((x) => { x.hidden = H.S.calloutMode === 'published'; });
  if (H.S.calloutMode === 'published') { if (H.PR) published(el, H); return; }
  // Published callouts left from before a switch with no holes to recompute them on are not listed here.
  const { S, esc } = H, manual = S.calloutMode === 'manual', list = H.callouts.filter((c) => !c.pub), shown = H.shown.filter((c) => !c.pub), shownIds = new Set(shown.map((c) => c.key));
  // Manual: the ticked holes, then every other calculated interval as a candidate.
  const cands = manual ? shown.concat(H.calc.filter((c) => !shownIds.has(c.key))) : list.slice(0, Math.max(6, S.coCount + 3));
  list.forEach((c) => { if (shownIds.has(c.key) && !cands.includes(c)) cands.push(c); });
  if (!cands.length) { el.innerHTML = `<p class="muted">${manual ? 'No hole has an interval to pick: lower the broad cut-off or the minimum length.' : 'No hole has an interval above the broad cut-off over the minimum length. Lower either one.'}</p>`; return; }
  // Wording typed for one interval while the calculation has since moved to another is said, never hidden.
  const moved = manual ? [] : cands.filter((c) => { const o = S.coOverrides[c.key]; return o?.at && (o.line1 || o.line2) && (Math.abs(o.at[0] - c.ic.broad.from) > 0.01 || Math.abs(o.at[1] - c.ic.broad.from - c.ic.broad.len) > 0.01); })
    .map((c) => { const a = S.coOverrides[c.key].at; return `${c.h.id}: your wording was written for ${m(a[0])}–${m(a[1])} m; the calculated interval is now ${m(c.ic.broad.from)}–${m(c.ic.broad.from + c.ic.broad.len)} m`; });
  const warn = (H.gaps.length ? `<p class="warn" role="status">${esc(H.gaps.join('; '))}. <button class="btn" type="button" id="co-recalc">Recalculate</button> to count sampled metres only.</p>` : '')
    + (moved.length ? `<p class="warn" role="status">${esc(moved.join('; '))}. Check the wording, or pick the holes by hand (Callouts from) to keep each at its depths.</p>` : '');
  el.innerHTML = `${warn}<p class="muted">${manual ? 'Tick the holes to show; each keeps the depths it had when ticked, whatever the cut-offs. ' : 'Tick to show. '}Type over a line to reword it; leave it blank for the automatic text.</p>` + cands.map((c) => {
    const id = esc(c.h.id), o = S.coOverrides[c.h.id] || {}, a1 = `${H.icText(c.ic.broad, c.h)} from ${Math.round(c.ic.broad.from)} m`, a2 = c.ic.incl ? `incl. ${H.icText(c.ic.incl, c.h)}` : '(no "incl." line)';
    return `<div class="callout-ed"><input type="checkbox" data-co="${id}" ${shownIds.has(c.h.id) ? 'checked' : ''} aria-label="Show callout for ${id}"><span class="id">${id}${manual && o.at ? ` · ${m(o.at[0])}–${m(o.at[1])} m` : ''}</span>`
      + `<input type="text" data-co1="${id}" value="${esc(o.line1 || '')}" placeholder="${esc(a1)}" aria-label="First line for ${id}">`
      + `<input type="text" data-co2="${id}" value="${esc(o.line2 || '')}" placeholder="${esc(a2)}" aria-label="Second line for ${id}"></div>`;
  }).join('');
  el.querySelector('#co-recalc')?.addEventListener('click', () => { H.setStyle({ designOptIn: [...S.designOptIn, 'sampledIntercepts'] }); H.status('Callouts recalculated on sampled metres only. Undo restores the earlier numbers.'); });
  el.querySelectorAll('[data-co]').forEach((cb) => cb.addEventListener('change', () => H.setCallout(cb.dataset.co, { show: cb.checked })));
  el.querySelectorAll('[data-co1],[data-co2]').forEach((inp) => inp.addEventListener('input', () => {
    const id = inp.dataset.co1 || inp.dataset.co2, key = inp.dataset.co1 ? 'line1' : 'line2';
    const o = S.coOverrides[id] || (S.coOverrides[id] = {}); if (inp.value) o[key] = inp.value; else delete o[key];
    // The depths this wording describes (a manual callout keeps the ones it was ticked at).
    if (!(manual && o.at)) { const at = icAt(H.calc.find((c) => c.key === id)?.ic); if (at) o.at = at; }
    H.redraw();
  }));
}

function published(el, H) {
  const { S, esc, PR } = H, { results, problems } = H.read(), ov = S.pubOverrides, byId = new Map(results.map((r) => [r.resultId, r]));
  if (!results.length) { el.innerHTML = `<p class="muted">No published results yet. Add the release table in step 1 and set its type to Published results.</p>${problems.map((p) => `<p class="warn">${esc(p.message)}</p>`).join('')}`; return; }
  const notes = PR.staleNotes(results, ov).concat(problems.filter((p) => !p.resultId).map((p) => p.message));
  el.innerHTML = `${notes.map((t) => `<p class="warn" role="status">${esc(t)}</p>`).join('')}<p class="muted">Each callout is a published result at its own depths, whatever the cut-offs. Type over a line to reword it; the wording stays with that result.</p>`
    + results.map((r) => {
      const id = esc(r.resultId), o = ov[r.resultId] || {}, t = PR.headline(r), kid = !!PR.parentOf(r, byId), ok = PR.isApproved(r), flags = problems.filter((p) => p.resultId === r.resultId);
      return `<div class="callout-ed"${kid ? ' style="margin-left:18px"' : ''}><input type="checkbox" data-pc="${id}" ${ok && o.show !== false ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Show ${id}">`
        + `<span class="id">${id} · ${esc(r.holeId)} ${m(r.fromM)}–${m(r.toM)} m${kid ? ' · incl.' : ''}</span>`
        + `<input type="text" data-pt="${id}" value="${esc(o.line1 && !PR.stale(o, r) ? o.line1 : '')}" placeholder="${esc(t.l1 + t.l1b)}" aria-label="Wording for ${id}">`
        + flags.map((p) => `<span class="warn" style="grid-column:2">${esc(p.message)}</span>`).join('') + '</div>';
    }).join('');
  el.querySelectorAll('[data-pc]').forEach((cb) => cb.addEventListener('change', () => H.setCallout(cb.dataset.pc, { show: cb.checked })));
  // Typing rewords that result only, for the depths it has now; the box redraws without rebuilding the panel.
  el.querySelectorAll('[data-pt]').forEach((inp) => inp.addEventListener('input', () => {
    const id = inp.dataset.pt, o = ov[id] || (ov[id] = {});
    if (inp.value) { o.line1 = inp.value; o.at = PR.atOf(results, id); } else delete o.line1;
    H.redraw();
  }));
}
