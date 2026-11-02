import { describe, it, expect } from 'vitest';
import { claimKeyTable } from '../src/utils/claimKeyTable.js';
import { paintFxSvg } from '../src/utils/geoStyle.js';

const box = { left: 10, top: 10, width: 300, height: 500 };
const row = (label, i = 1) => ({ label, reference: `K${i}` });
const renderedText = (primitives) => primitives.filter((p) => p.t === 'glyphs').map((p) => p.glyphs.map((g) => g.ch).join(''));
describe('bounded shared claim-key table', () => {
  it('preserves full supplied identifiers across wrapped lines and reports omitted locations', () => {
    const identifier = '0000123456789'.repeat(4);
    const result = claimKeyTable([row(identifier)], 'TENURE_NUMBER_ID', box, { omitted: 3, hidden: 2 });
    expect(result.ok).toBe(true);
    const lines = renderedText(result.primitives);
    expect(lines.join('')).toContain(identifier);
    expect(result.notice).toBe('1 located · 3 not located in this view · 2 hidden');
    expect(result.primitives.filter((p) => p.t === 'glyphs').every((p) => p.glyphs.every((g) => g.y < box.top + box.height))).toBe(true);
  });
  it('returns no partial table when all rows cannot fit', () => {
    const result = claimKeyTable(Array.from({ length: 40 }, (_, i) => row(`ID${i}`, i + 1)), 'ID', box);
    expect(result).toMatchObject({ ok: false, reason: 'key-table-overflow', primitives: [] });
    expect(result.requiredHeight).toBeGreaterThan(box.height);
  });
  it('escapes source text using the existing SVG painter', () => {
    const result = claimKeyTable([row('<script>&"')], 'ID', box);
    const svg = paintFxSvg(result.primitives);
    expect(svg).toContain('&lt;script&gt;&amp;');
    expect(svg).not.toContain('<script>');
  });
  it('requires a readable box and honest all-omitted notice', () => {
    expect(claimKeyTable([], 'ID', { ...box, width: 100 }).ok).toBe(false);
    const result = claimKeyTable([], 'ID', box, { omitted: 12 });
    expect(result.ok).toBe(true); expect(result.notice).toBe('0 located · 12 not located in this view');
  });
});
