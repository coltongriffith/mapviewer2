import { SNAP_THRESHOLD } from '../constants';

export function computeSnap(x, y, w, h, elements, containerW, containerH, selfId) {
  let sx = x;
  let sy = y;
  const guides = [];
  let bestDx = SNAP_THRESHOLD + 1;
  let bestDy = SNAP_THRESHOLD + 1;

  const selfEdges = { xl: x, xc: x + w / 2, xr: x + w, yt: y, yc: y + h / 2, yb: y + h };
  const offX = [0, w / 2, w];
  const offY = [0, h / 2, h];

  const candidates = [
    ...elements
      .filter((el) => el.id !== selfId)
      .flatMap((el) => [
        { type: 'v', pos: el.x },
        { type: 'v', pos: el.x + el.w / 2 },
        { type: 'v', pos: el.x + el.w },
        { type: 'h', pos: el.y },
        { type: 'h', pos: el.y + el.h / 2 },
        { type: 'h', pos: el.y + el.h },
      ]),
    { type: 'v', pos: 0 },
    { type: 'v', pos: containerW / 2 },
    { type: 'v', pos: containerW },
    { type: 'h', pos: 0 },
    { type: 'h', pos: containerH / 2 },
    { type: 'h', pos: containerH },
  ];

  candidates.filter((c) => c.type === 'v').forEach((c) => {
    [selfEdges.xl, selfEdges.xc, selfEdges.xr].forEach((edge, i) => {
      const d = Math.abs(edge - c.pos);
      if (d < SNAP_THRESHOLD && d < bestDx) {
        bestDx = d;
        sx = c.pos - offX[i];
        guides.push({ type: 'v', pos: c.pos });
      }
    });
  });

  candidates.filter((c) => c.type === 'h').forEach((c) => {
    [selfEdges.yt, selfEdges.yc, selfEdges.yb].forEach((edge, i) => {
      const d = Math.abs(edge - c.pos);
      if (d < SNAP_THRESHOLD && d < bestDy) {
        bestDy = d;
        sy = c.pos - offY[i];
        guides.push({ type: 'h', pos: c.pos });
      }
    });
  });

  return { x: sx, y: sy, guides };
}
