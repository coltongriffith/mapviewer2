import { describe, it, expect } from 'vitest';
import { THEME_TOKENS, getThemeTokens } from '../src/utils/themeTokens.js';
import { TEMPLATE_THEMES, createInitialProjectState } from '../shared/projectState.js';
import { studioOn, studioZoneSizes, studioTitleRows, studioScaleHome, STUDIO_PANEL } from '../src/utils/studioLayout.js';
import {
  studioCard, labelHalo, cardShell, titleCardPrims, scaleCardPrims, northCardPrims, insetCardPrims, insetArea,
  paintSvg, scaleStep, studioFontQuery, studioFontFamilies, studioNorthStyle,
} from '../src/utils/studioCards.js';
import { resolveTemplateZones, technicalResultsTemplate } from '../src/templates/technicalResultsTemplate.js';
import { renderLegendSvg, renderInsetSvg, studioPrims } from '../src/export/renderScene.js';

// The opt-in 2D Studio style: the /3d figure look (rounded cards, one accent, caps kicker, mono numerals,
// scale bar beside the north arrow, dark locator card, label halos). Every other theme is untouched.

const base = () => ({ ...createInitialProjectState().layout, legendItems: [] });
const studio = (extra = {}) => ({ ...base(), themeId: 'studio', title: 'Rabbit North · Geology & Gold Trends', subtitle: 'New Blue Sky holes 077 & 078', companyName: 'Tower Resources Ltd.', mapDate: 'October 2026', ...extra });
const inside = (b, x, y, pad = 0.5) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
// Every point a primitive puts ink on (text by its anchor), to check it stays in its card.
const points = (prims) => prims.flatMap((p) => {
  if (p.t === 'rect' || p.t === 'image' || p.t === 'slot') return [[p.x, p.y], [p.x + p.w, p.y + p.h]];
  if (p.t === 'text') return [[p.x, p.y], [p.x, p.y - p.size * 0.72]];
  if (p.t === 'line') return [[p.x1, p.y1], [p.x2, p.y2]];
  if (p.t === 'circle') return [[p.cx - p.r, p.cy - p.r], [p.cx + p.r, p.cy + p.r]];
  if (p.t === 'poly') return p.pts;
  return [];
});

describe('Studio theme tokens and picker', () => {
  it('is offered in the theme picker and the brand kit, and resolves its own tokens', () => {
    expect(TEMPLATE_THEMES.studio).toBe('Studio');
    expect(getThemeTokens('studio')).toBe(THEME_TOKENS.studio);
    expect(THEME_TOKENS.studio.panelRadius).toBe(8);
    expect(THEME_TOKENS.studio.titleAccentStyle).toBe('left');
    // Every token the other themes define, so nothing falls back to undefined.
    expect(Object.keys(THEME_TOKENS.studio).sort()).toEqual(Object.keys(THEME_TOKENS.investor_clean).sort());
  });

  it('leaves the existing themes and the new-map default as they were', () => {
    expect(createInitialProjectState().layout.themeId).toBe('investor_clean');
    expect(THEME_TOKENS.investor_clean.panelRadius).toBe(3);
    expect(THEME_TOKENS.investor_clean.titleFill).toBe('#0c1a35');
    expect(THEME_TOKENS.technical_sharp.panelRadius).toBe(0);
  });
});

describe('Studio layout (sizes the template reserves)', () => {
  it('is on only for the Studio theme on the standard template', () => {
    expect(studioOn(studio())).toBe(true);
    expect(studioOn(studio({ templateId: 'side_panel' }))).toBe(false);
    expect(studioOn(base())).toBe(false);
    expect(studioZoneSizes(base(), 520)).toBe(null);
  });

  it('sizes the title card to its rows: kicker, title (twice the body), subtitle and info line', () => {
    const { rows, height } = studioTitleRows(studio());
    expect(rows.map((r) => r.kind)).toEqual(['kicker', 'title', 'subtitle', 'info']);
    const title = rows.find((r) => r.kind === 'title');
    expect(title.size).toBeGreaterThanOrEqual(2 * 13);
    expect(studioTitleRows(studio({ companyName: '', subtitle: '', mapDate: '' })).height).toBeLessThan(height);
    expect(studioZoneSizes(studio(), 520).title).toEqual([520, height]);
  });

  it('puts the scale bar beside the north arrow in one card by default, in the title card when asked, or apart', () => {
    expect(studioScaleHome(studio())).toBe('panel');
    expect(studioZoneSizes(studio(), 520)).toMatchObject({ scaleBar: [STUDIO_PANEL.w, STUDIO_PANEL.h], northArrow: [0, 0] });
    const inTitle = studio({ studio: { titleScale: true } });
    expect(studioScaleHome(inTitle)).toBe('title');
    expect(studioZoneSizes(inTitle, 520)).toMatchObject({ scaleBar: [0, 0], northArrow: [0, 0] });
    expect(studioTitleRows(inTitle).rows.map((r) => r.kind)).toContain('scale');
    expect(studioScaleHome(studio({ studio: { scaleNorth: false } }))).toBe('apart');
    // Without a title the title card cannot hold them.
    expect(studioScaleHome(studio({ showTitle: false, studio: { titleScale: true } }))).toBe('panel');
  });

  it('gives the template its zones: the combined card in the scale bar corner, no separate north arrow', () => {
    const zones = resolveTemplateZones(technicalResultsTemplate, studio(), { width: 1600, height: 1000 }, []);
    expect(zones.northArrow).toMatchObject({ width: 0, height: 0 });
    expect(zones.scaleBar).toMatchObject({ width: STUDIO_PANEL.w, height: STUDIO_PANEL.h });
    const plain = resolveTemplateZones(technicalResultsTemplate, base(), { width: 1600, height: 1000 }, []);
    expect(plain.northArrow.width).toBeGreaterThan(0);
    expect(plain.title.height).toBe(92);
  });
});

describe('Studio card style', () => {
  it('has a look per card: light title with a left accent bar, dark locator', () => {
    expect(studioCard(studio(), 'title')).toMatchObject({ tone: 'light', accent: 'left', radius: 8, shadow: true });
    expect(studioCard(studio(), 'inset')).toMatchObject({ tone: 'dark', accent: 'none', ink: '#ffffff' });
  });

  it('takes per-card overrides: radius, shadow, accent bar, opacity, dark or light', () => {
    const c = studioCard(studio({ studio: { cards: { legend: { tone: 'dark', accent: 'top', radius: 14, opacity: 0.8, shadow: false } } } }), 'legend');
    expect(c).toMatchObject({ tone: 'dark', accent: 'top', radius: 14, opacity: 0.8, shadow: false, ink: '#ffffff' });
  });

  it('takes the radius, padding and shadow of the applied brand figure style', () => {
    const l = studio({ brandStyle: { style: { panel: { radius: 3, padding: 20, shadow: 'none' } } } });
    expect(studioCard(l, 'title')).toMatchObject({ radius: 3, pad: 20, shadow: false });
  });

  it('uses the brand accent and a dark brand primary for the dark cards', () => {
    const c = studioCard(studio({ accentColor: '#2e9e44', titleBgColor: '#123456' }), 'inset');
    expect(c.accentColor).toBe('#2e9e44');
    expect(c.fill).toBe('#123456');
  });

  it('keeps the accent bar inside the card corners', () => {
    for (const side of ['left', 'top']) {
      const [, bar] = cardShell({ ...studioCard(studio(), 'title'), accent: side }, 10, 20, 300, 100);
      const nums = bar.d.match(/-?\d+(\.\d+)?/g).map(Number);
      expect(bar.t).toBe('path');
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('label halo', () => {
  it('is on in Studio by default, configurable, and off in every other theme unless set', () => {
    expect(labelHalo(studio())).toEqual({ color: '#ffffff', width: 3, opacity: 0.9 });
    expect(labelHalo(studio({ labelHalo: { color: '#000000', width: 2, opacity: 0.5 } }))).toEqual({ color: '#000000', width: 2, opacity: 0.5 });
    expect(labelHalo(studio({ labelHalo: { enabled: false } }))).toBe(null);
    expect(labelHalo(base())).toBe(null);
    expect(labelHalo({ ...base(), labelHalo: { color: '#ffeeaa' } })).toMatchObject({ color: '#ffeeaa', width: 3 });
  });
});

describe('Studio cards as primitives', () => {
  const box = { x: 40, y: 30, w: 520, h: 140 };

  it('lays the title card out with its kicker in caps, inside the card', () => {
    const l = studio();
    const prims = titleCardPrims(l, { ...box, h: studioTitleRows(l).height });
    const byRole = Object.fromEntries(prims.filter((p) => p.role).map((p) => [p.role, p]));
    expect(byRole.kicker.s).toBe('TOWER RESOURCES LTD.');
    expect(byRole.kicker.weight).toBe(650);
    expect(byRole.title.weight).toBe(800);
    expect(byRole.subtitle.weight).toBe(600);
    expect(byRole.info.weight).toBe(300);
    expect(byRole.title.size).toBeGreaterThanOrEqual(2 * byRole.info.size);
    for (const [x, y] of points(prims)) expect(inside({ ...box, h: studioTitleRows(l).height }, x, y)).toBe(true);
  });

  it('uses the brand kit weights where its figure style sets them', () => {
    const l = studio({ brandStyle: { style: { type: { title: { weight: 700 } } } } });
    expect(titleCardPrims(l, box).find((p) => p.role === 'title').weight).toBe(700);
  });

  it('shrinks a long title to fit rather than running it out of the card', () => {
    const long = studio({ title: 'An extremely long project title that keeps on going well past any card width at all' });
    const t = titleCardPrims(long, { ...box, w: 360 }).find((p) => p.role === 'title');
    expect(t.size).toBeLessThan(26);
  });

  it('holds the scale bar, datum note and north arrow under a rule in the title card (Fig 2)', () => {
    const l = studio({ studio: { titleScale: true } });
    const h = studioTitleRows(l).height, card = { ...box, h };
    const prims = titleCardPrims(l, card, { metresPerPx: 2, datum: 'NAD83 / UTM Zone 10N' });
    expect(prims.some((p) => p.t === 'line')).toBe(true);
    expect(prims.some((p) => p.t === 'text' && p.s === 'NAD83 / UTM ZONE 10N')).toBe(true);
    expect(prims.some((p) => p.t === 'text' && p.s === 'N')).toBe(true);
    for (const [x, y] of points(prims)) expect(inside(card, x, y)).toBe(true);
  });

  it('draws the scale bar at its true length, labelled in mono, left of the north arrow', () => {
    const card = { x: 0, y: 0, w: STUDIO_PANEL.w, h: STUDIO_PANEL.h };
    const prims = scaleCardPrims(studio(), card, { metresPerPx: 2.5, datum: 'WGS84 / UTM Zone 10N' });
    const outline = prims.find((p) => p.t === 'rect' && !p.fill);
    const end = prims.filter((p) => p.t === 'text' && p.family === 'IBM Plex Mono').at(-1);
    const metres = Number(end.s.replace(/\D/g, '')) * (end.s.endsWith('km') ? 1000 : 1);
    expect(outline.w).toBeCloseTo(metres / 2.5, 5);
    const north = prims.find((p) => p.t === 'text' && p.s === 'N');
    expect(north.x).toBeGreaterThan(outline.x + outline.w);
    for (const [x, y] of points(prims)) expect(inside(card, x, y)).toBe(true);
  });

  it('picks the longest round length that fits', () => {
    expect(scaleStep(2, 150)).toMatchObject({ metres: 250, px: 125, label: '250 m', half: '125' });
    expect(scaleStep(null, 150)).toBe(null);
  });

  it('draws the north arrow alone, sized to its card', () => {
    const card = { x: 0, y: 0, w: 90, h: 100 };
    const prims = northCardPrims(studio({ studio: { scaleNorth: false } }), card);
    for (const [x, y] of points(prims)) expect(inside(card, x, y)).toBe(true);
    expect(studioNorthStyle(studio())).toBe('rose');
    expect(studioNorthStyle(studio({ northArrowStyle: 'split' }))).toBe('split');
  });

  it('draws the locator card dark, with its heading, pill, ringed marker, project name and caption', () => {
    const l = studio({ insetTitle: 'Project location', insetLabel: 'British Columbia, Canada', studio: { pill: 'TSXV: TWR', projectLabel: 'Rabbit North' } });
    const card = { x: 1300, y: 20, w: 260, h: 200 };
    const region = { name: 'British Columbia', bbox: [-139, 48.3, -114, 60], coordinates: [[[-139, 60], [-120, 60], [-114, 49], [-123, 48.3], [-133, 54], [-139, 60]]] };
    const prims = insetCardPrims(l, card, { mode: 'region', region, bounds: { minLng: -120.5, maxLng: -120.3, minLat: 50.6, maxLat: 50.7 } });
    const text = (role) => prims.find((p) => p.role === role)?.s;
    expect(text('heading')).toBe('PROJECT LOCATION');
    expect(text('pill')).toBe('TSXV: TWR');
    expect(text('project')).toBe('RABBIT NORTH');
    expect(text('caption')).toBe('British Columbia, Canada');
    expect(prims[0]).toMatchObject({ t: 'rect', fill: '#14262e' });
    expect(prims.filter((p) => p.t === 'circle')).toHaveLength(2);
    const area = insetArea(l, card);
    for (const p of prims.filter((q) => q.t === 'poly' || q.t === 'circle')) for (const [x, y] of points([p])) expect(inside(area, x, y, 11)).toBe(true);
    for (const [x, y] of points(prims)) expect(inside(card, x, y)).toBe(true);
  });

  it('leaves a slot for the satellite locator, with the jurisdiction as its fallback', () => {
    const prims = insetCardPrims(studio(), box, { mode: 'satellite', marker: { x: 50, y: 40 } });
    const slot = prims.find((p) => p.t === 'slot');
    expect(slot).toMatchObject(insetArea(studio(), box));
    expect(prims.find((p) => p.t === 'circle')).toMatchObject({ cx: slot.x + 50, cy: slot.y + 40 });
  });

  it('writes SVG with plain paints, a shared shadow filter and classed text', () => {
    const defs = [];
    const svg = paintSvg(titleCardPrims(studio(), box), 2, defs);
    expect(svg).toContain('class="em-studio-kicker"');
    expect(svg).toContain('TOWER RESOURCES LTD.');
    expect(svg).toContain('filter="url(#em-studio-shadow)"');
    expect(svg).not.toMatch(/="rgba\(/);
    expect(defs.filter((d) => d.includes('em-studio-shadow'))).toHaveLength(1);
    paintSvg(titleCardPrims(studio(), box), 2, defs);
    expect(defs.filter((d) => d.includes('em-studio-shadow'))).toHaveLength(1);
  });
});

describe('Studio fonts', () => {
  it('asks Google Fonts for every Studio weight, and keeps mono for numerals', () => {
    expect(studioFontFamilies({ fonts: { title: 'Montserrat' } })).toEqual(['Inter', 'Montserrat', 'IBM Plex Mono']);
    expect(studioFontQuery('Inter')).toBe('family=Inter:wght@300..800');
    expect(studioFontQuery('Open Sans')).toBe('family=Open+Sans:wght@300..800');
    expect(studioFontQuery('Lato')).toBe('family=Lato:wght@300;400;700;900');
    expect(studioFontQuery('IBM Plex Mono')).toBe('family=IBM+Plex+Mono:wght@400;600');
  });
});

describe('Studio in the exporters', () => {
  const scene = (layout) => ({ width: 1600, height: 1000, template: { id: 'technical_results_v2' }, project: { layout, layers: [] } });
  const items = [{ id: 'a', type: 'polygons', label: 'Claims', group: 'Property', style: { fill: '#93c5fd', stroke: '#2563eb' } }];

  it('draws the legend on a Studio card outside its clip, so the shadow is not cut off', () => {
    const svg = renderLegendSvg(scene(studio({ legendItems: items })), 1, []);
    expect(svg).toMatch(/^<g id="em-legend" class="em-panel"><rect[^>]*filter="url\(#em-studio-shadow\)"/);
    expect(svg).toContain('font-weight="650"');
  });

  it('leaves the other themes’ legend markup as it was', () => {
    const svg = renderLegendSvg(scene({ ...base(), legendItems: items }), 1, []);
    expect(svg).toMatch(/^<g id="em-legend" class="em-panel" clip-path="url\(#em-clip-0\)"><rect/);
    expect(svg).not.toContain('em-studio');
  });

  it('draws the locator as the dark Studio card', () => {
    const svg = renderInsetSvg(scene(studio({ insetTitle: 'Project location', studio: { pill: 'TSXV: TWR' } })), 1, []);
    expect(svg).toContain('id="em-studio-inset"');
    expect(svg).toContain('PROJECT LOCATION');
    expect(svg).toContain('TSXV: TWR');
  });

  it('has a title, combined scale card and no separate north arrow, each inside its zone', () => {
    const s = scene(studio());
    const zones = resolveTemplateZones(technicalResultsTemplate, s.project.layout, { width: 1600, height: 1000 });
    const title = studioPrims(s, 'title');
    expect(title.find((p) => p.role === 'kicker').s).toBe('TOWER RESOURCES LTD.');
    const zb = (z) => ({ x: z.left, y: z.top, w: z.width, h: z.height });
    for (const [x, y] of points(title)) expect(inside(zb(zones.title), x, y)).toBe(true);
    const scaleCard = studioPrims(s, 'scale');
    expect(scaleCard.length).toBeGreaterThan(0);
    for (const [x, y] of points(scaleCard)) expect(inside(zb(zones.scaleBar), x, y)).toBe(true);
    expect(studioPrims(s, 'north')).toEqual([]);
  });
});
