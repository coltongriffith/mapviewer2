import { fxScene, boxesOverlap } from './geoStyle.js';
import { claimKeyScene } from './claimKeyScene.js';
import { resolveClaimKeySnapshot } from './claimKeyCandidates.js';
import { resolveCalloutBoxes } from './calloutLayout.js';
import { resolveScoredBoxes } from './calloutScorer.js';

export function claimKeyObstacles(project, map, obstacles = []) {
  if (!project?.layout?.claimKey || !map) return obstacles;
  const layout = project.layout;
  const resolve = layout.layoutAlgorithm >= 2 ? resolveScoredBoxes : resolveCalloutBoxes;
  const cards = resolve(project.callouts || [], map, { obstacles, algorithm: layout.layoutAlgorithm, font: layout.fonts?.callout });
  return [...obstacles, ...cards.map(({ left, top, width, height }) => ({ left, top, width, height, key: 'a callout' }))];
}

/** One composition for editor/read-only/canvas/SVG consumers. Callers provide
 * ALL furniture and annotation obstacles in composition pixels. No key is
 * inferred: only an explicitly saved layout.claimKey can activate this path.
 */
export function claimKeyComposition(entries, view, project) {
  const snapshot = project?.layout?.claimKey;
  if (!snapshot) return fxScene(entries, view);
  const source = resolveClaimKeySnapshot(project, snapshot);
  const fail = (reason) => ({ ...fxScene(entries, view), claimKey: { ok: false, reason } });
  if (!source.ok) return fail(source.reason);
  const frame = view.frame || { left: 0, top: 0, right: view.W, bottom: view.H };
  const pad = 12, width = Math.min(280, (frame.right - frame.left) * .36);
  const height = Math.min(110 + source.total * 18, (frame.bottom - frame.top) * .65);
  if (width < 180 || height < 100) return fail('no-key-space');
  const x = [frame.right - pad - width, frame.left + pad];
  const y = [frame.bottom - pad - height, frame.top + pad];
  const boxes = x.flatMap((left) => y.map((top) => ({ left, top, width, height })));
  for (const box of boxes) {
    if (box.left < frame.left || box.top < frame.top || box.left + box.width > frame.right || box.top + box.height > frame.bottom
      || (view.obstacles || []).some((obstacle) => boxesOverlap(box, obstacle))) continue;
    // Preserve expert labels, reserving the key's box before their layout.
    const normal = fxScene(entries, { ...view, obstacles: [...(view.obstacles || []), { ...box, key: 'claim key' }] });
    // Expert labels may deliberately keep a known overlapping fallback. The
    // key must choose another box rather than cover that preserved label.
    if (normal.placed.some((item) => (item.boxes || [item.box]).some((rect) => boxesOverlap(box, rect)))) continue;
    const key = claimKeyScene(project, snapshot, { ...view, obstacles: [
      ...(view.obstacles || []), ...normal.placed.flatMap((item) => item.boxes || [item.box]).map((rect) => ({ ...rect, key: 'existing label' })),
    ] }, box);
    if (!key.ok) continue;
    return { ...normal, labels: [...normal.labels, ...key.labels, ...key.table],
      placed: [...normal.placed, ...key.placed], claimKey: key };
  }
  return fail('no-key-space');
}
