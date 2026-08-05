// What a claim result set has to declare, ranked so it can be read.
//
// THE PROBLEM THIS SOLVES
//   A US claim-name search could put five separate blocks on screen at once:
//   the auto-adopted-jurisdiction notice, the claim-name gate, a degraded
//   scoping warning, the generalized-geometry disclaimer, and a source credit.
//   Around 150 words of warning wrapped around a list of claims.
//
//   Every one of them is individually justified — these maps go into NI 43-101
//   filings, and a wrong-but-plausible claim set is the worst thing this
//   product can produce. But five warnings at once is not five times the
//   caution. It is banner blindness, and the one that actually blocks an action
//   ends up competing with boilerplate that is true on every single search.
//
// THE RULE
//   Say the thing that changes. Keep the thing that does not, one line and one
//   click away.
//
//     blocking    gates an action and needs a decision → always expanded
//     accuracy    true of THIS result set, not the next → expanded when
//                 nothing is blocking
//     provenance  true of every result set forever → collapsed to a summary
//
//   Nothing is deleted, and nothing is softened. `detail` is the same text it
//   always was, and the export path is untouched: sourceCredit() and the
//   layer's provenance still carry full wording onto the map and into the
//   exported image, which is where it has to survive being screenshotted out of
//   context. This module governs the search panel only.

export const SEVERITY = {
  BLOCKING: 'blocking',
  ACCURACY: 'accuracy',
  PROVENANCE: 'provenance',
};

const RANK = { blocking: 0, accuracy: 1, provenance: 2 };

// Tiebreak within a severity, so the expanded notice never depends on the
// order the caller happened to build the list in. Two accuracy notices can
// coexist — a degraded scope and an auto-adopted jurisdiction — and which one
// gets the reader's attention has to be a decision, not an accident of
// construction. The scope of the claim set outranks which jurisdiction we
// picked: one is about whether these are the right claims, the other about
// where we looked.
const ORDER = ['name-match', 'scoping', 'adoption', 'geometry'];
const orderOf = (id) => {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
};

/**
 * Rank and group the notices for one result set.
 *
 * @param {object[]} notices  { id, severity, short, detail? }
 * @returns {{expanded: object[], collapsed: object[], all: object[]}}
 */
export function rankNotices(notices) {
  const all = (notices || [])
    .filter((n) => n && n.short)
    .slice()
    .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9)
      || orderOf(a.id) - orderOf(b.id));

  const blocking = all.filter((n) => n.severity === SEVERITY.BLOCKING);
  // A blocking notice owns the reader's attention. When one is present nothing
  // else expands beside it, or the decision it is asking for gets crowded.
  const expanded = blocking.length
    ? blocking
    : all.filter((n) => n.severity === SEVERITY.ACCURACY).slice(0, 1);

  const expandedIds = new Set(expanded.map((n) => n.id));
  return { expanded, collapsed: all.filter((n) => !expandedIds.has(n.id)), all };
}

/**
 * Build the notice list for a claims response.
 *
 * Pure and free of React so the ordering rules can be tested directly rather
 * than through a rendered panel.
 */
export function claimNotices({ adoption, scoping, isUs, hasResults, nameMatched }) {
  if (!hasResults) return [];
  const out = [];

  if (nameMatched) {
    out.push({
      id: 'name-match',
      severity: SEVERITY.BLOCKING,
      short: 'Matched by claim name — ownership not established',
    });
  }

  if (scoping) {
    out.push({
      id: 'scoping',
      severity: SEVERITY.ACCURACY,
      short: scoping.short,
      detail: scoping.detail,
    });
  }

  if (adoption) {
    out.push({
      id: 'adoption',
      severity: SEVERITY.ACCURACY,
      short: adoption.message,
      detail: `${adoption.rankedBy === 'area'
        ? 'Chosen as the largest holding by area.'
        : 'Chosen by claim count — no area published for these registries.'
      } This attribution stays on the layer when you add it to the map.`,
    });
  }

  if (isUs) {
    // Standing truth, identical on every US search ever run. It earns a line,
    // not a paragraph — and it still travels in full on the exported map.
    out.push({
      id: 'geometry',
      severity: SEVERITY.PROVENANCE,
      short: 'Boundaries are generalized, not legal surveys',
    });
  }

  return out;
}
