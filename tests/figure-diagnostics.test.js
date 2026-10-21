import { describe, it, expect } from 'vitest';
import {
  diagnostic, sortDiagnostics, mergeDiagnostics, countDiagnostics, needsReview, hasErrors, summaryLine, unionBounds,
} from '../shared/figureDiagnostics.js';

describe('figure diagnostics', () => {
  it('normalises a diagnostic to the six fields', () => {
    const d = diagnostic({ code: 'label-clipped', elementId: 7, bounds: { left: 1, top: 2, width: 3, height: 4 }, message: 'cut off', action: 'drag it' });
    expect(d).toEqual({ code: 'label-clipped', severity: 'warning', elementId: '7', bounds: { left: 1, top: 2, width: 3, height: 4 }, message: 'Cut off', action: 'Drag it' });
    expect(diagnostic({ code: 'x', severity: 'fatal', bounds: { left: NaN } })).toMatchObject({ severity: 'warning', bounds: null, elementId: null, message: 'X', action: '' });
  });

  it('sorts errors before warnings before notes, then by code', () => {
    const list = sortDiagnostics([
      diagnostic({ code: 'b', severity: 'info' }),
      diagnostic({ code: 'z', severity: 'warning' }),
      diagnostic({ code: 'a', severity: 'warning' }),
      diagnostic({ code: 'q', severity: 'error' }),
    ]);
    expect(list.map((d) => d.code)).toEqual(['q', 'a', 'z', 'b']);
  });

  it('merges lists, keeping the more severe copy of a finding', () => {
    const merged = mergeDiagnostics(
      [diagnostic({ code: 'label-clipped', elementId: 'c1', severity: 'warning' })],
      [diagnostic({ code: 'label-clipped', elementId: 'c1', severity: 'error' }), diagnostic({ code: 'label-clipped', elementId: 'c2' })],
      [{ code: 'imagery-missing', message: 'no imagery' }, { code: 'imagery-missing', message: 'no imagery' }, { code: 'imagery-missing', message: 'other' }],
    );
    expect(merged.filter((d) => d.elementId === 'c1')).toHaveLength(1);
    expect(merged[0]).toMatchObject({ elementId: 'c1', severity: 'error' });
    // Figure-wide findings are told apart by message.
    expect(merged.filter((d) => d.code === 'imagery-missing')).toHaveLength(2);
  });

  it('summarises in plain language', () => {
    expect(summaryLine([])).toBe('No problems found');
    const list = [diagnostic({ code: 'a', severity: 'error' }), diagnostic({ code: 'b' }), diagnostic({ code: 'c' }), diagnostic({ code: 'd', severity: 'info' })];
    expect(summaryLine(list)).toBe('1 problem, 2 warnings and 1 note');
    expect(countDiagnostics(list)).toEqual({ error: 1, warning: 2, info: 1 });
    expect(needsReview([diagnostic({ code: 'd', severity: 'info' })])).toBe(false);
    expect(needsReview(list)).toBe(true);
    expect(hasErrors(list)).toBe(true);
    expect(hasErrors(list.slice(1))).toBe(false);
  });

  it('unions boxes', () => {
    expect(unionBounds([{ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 5, width: 5, height: 10 }, null])).toEqual({ left: 0, top: 0, width: 25, height: 15 });
    expect(unionBounds([])).toBeNull();
  });
});
