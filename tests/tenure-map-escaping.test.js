import { describe, it, expect } from 'vitest';
import { tooltipHtml, popupHtml } from '../src/components/tenure/TenureMap.jsx';

// Leaflet's DivOverlay._updateContent assigns a STRING payload straight to
// node.innerHTML, so bindTooltip and bindPopup are HTML sinks. React's
// auto-escaping never sees these strings — they are built by hand and handed to
// a third-party library.
//
// The value that matters is `tenure_name`: the free-text CLAIM_NAME chosen by
// whoever staked the title in Mineral Titles Online, stored verbatim by the
// importer (scripts/tenure-sync/normalize.mjs) and served to anonymous callers
// by /api/tenure-search. Anyone willing to stake a B.C. claim can choose it.
//
// A regression here is an HTML-injection sink fed by attacker-influenced
// government data, so both builders are pinned.

const HOSTILE = '<img src=1 onerror=alert(document.domain)>';

const row = (over = {}) => ({
  tenure: {
    id: 't1',
    tenure_number: '1044501',
    tenure_name: 'Crystal Lake North',
    status: 'GOOD',
    good_to_date: '2027-03-14',
    area_hectares: 418.7,
    ...over.tenure,
  },
  owners: over.owners ?? [{ owner_name: 'GOLIATH RESOURCES LTD.' }],
});

const NOW = new Date('2026-08-01T18:00:00Z');

describe('map tooltip content', () => {
  it('renders the ordinary case', () => {
    expect(tooltipHtml(row())).toBe('1044501 — Crystal Lake North');
  });

  it('escapes a hostile claim name', () => {
    const out = tooltipHtml(row({ tenure: { tenure_name: HOSTILE } }));
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/&lt;img src=1 onerror=alert\(document\.domain\)&gt;/);
  });

  it('escapes a hostile tenure number', () => {
    const out = tooltipHtml(row({ tenure: { tenure_number: HOSTILE } }));
    expect(out).not.toMatch(/<img/);
  });

  it('escapes quotes, so an injected value cannot break out of an attribute', () => {
    const out = tooltipHtml(row({ tenure: { tenure_name: '" onmouseover="x' } }));
    expect(out).not.toMatch(/"/);
    expect(out).toMatch(/&quot;/);
  });

  it('falls back without emitting markup when the name is absent', () => {
    expect(tooltipHtml(row({ tenure: { tenure_name: null } }))).toBe('1044501 — Unnamed');
  });
});

describe('map popup content', () => {
  it('escapes a hostile claim name', () => {
    const out = popupHtml(row({ tenure: { tenure_name: HOSTILE } }), NOW);
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/&lt;img/);
  });

  it('escapes a hostile owner name', () => {
    const out = popupHtml(row({ owners: [{ owner_name: HOSTILE }] }), NOW);
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/&lt;img/);
  });

  it('still emits its own intended markup', () => {
    // Proves the assertions above are detecting escaping rather than the
    // absence of any HTML at all.
    const out = popupHtml(row(), NOW);
    expect(out).toMatch(/<div class="tm-popup">/);
    expect(out).toMatch(/Crystal Lake North/);
  });
});
