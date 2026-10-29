import { describe, it, expect, vi } from 'vitest';
import {
  FIGURE_STYLE_VERSION, STYLE_COLOURS, STYLE_TYPE_ROLES, validateFigureStyle, normaliseFigureStyle,
  isEmptyFigureStyle, styleSnapshot, normHex, normAssetRef,
} from '../shared/figureStyle.js';
import {
  BRAND_KIT_SAVEABLE_KEYS, BRAND_KIT_STYLE_KEYS, STYLE_2D_KEYS, applyBrandKitConfig, applyBrandKitStyle,
  applyBrandKitTemplate, to2DLayout, to3DSettings, styleFromKitConfig, brandStyleRecord, EDITOR_FONTS,
} from '../shared/brandKit.js';
import { createInitialProjectState, FONT_OPTIONS } from '../shared/projectState.js';
import * as type from '../src/three-d/typography.js';
import { init as initGeology, labelFont } from '../src/three-d/geology.js';

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FULL_STYLE = {
  version: 1,
  colours: { primary: '#0A4268', accent: '#ae4b0a', ink: '#1e1d26', muted: '#9a9a9a', panel: '#ffffff', panelBorder: '#ccc' },
  type: {
    title: { family: 'Montserrat', weight: 700, size: 1.2 },
    subtitle: { family: 'Montserrat', weight: 500, size: 1 },
    label: { family: 'Inter', weight: 400, size: 0.9 },
    note: { family: 'Lato', weight: 400, size: 0.8 },
  },
  logo: { assetRef: LOGO, placement: 'tr' },
  panel: { radius: 4, padding: 12, shadow: 'none' },
  spacing: { margin: 3, gap: 10 },
  sourceNote: { position: 'footer', italic: true, prefix: 'Source:' },
};

// The function as it was before the figure style existed, copied verbatim: old kits must apply exactly so.
function legacyApplyBrandKitConfig(config, currentLayout) {
  if (!config) return currentLayout;
  const patch = {};
  for (const key of BRAND_KIT_SAVEABLE_KEYS) {
    if (config[key] !== undefined) patch[key] = config[key];
  }
  if (config.fonts) patch.fonts = { ...currentLayout.fonts, ...config.fonts };
  return { ...currentLayout, ...patch };
}
const LEGACY_KEYS = ['themeId', 'accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'templateId',
  'logo', 'logoScale', 'logoCorner', 'logoWidthPx', 'logoHeightPx', 'logoTransparent', 'logoOpacity',
  'titleCorner', 'titleWidthPx', 'titleHeightPx', 'titleTransparent', 'titleSize', 'titleWidth',
  'legendMode', 'legendTitle', 'legendCorner', 'legendWidthPx', 'legendHeightPx', 'legendTransparent', 'legendWidth',
  'insetEnabled', 'insetSize', 'insetMode', 'insetCorner', 'insetTitle', 'insetWidthPx', 'insetHeightPx',
  'showNorthArrow', 'northArrowCorner', 'northArrowHeightPx', 'northArrowTransparent', 'showScaleBar', 'scaleBarCorner', 'scaleBarTransparent',
  'cornerLayout', 'cornerOrder', 'footerEnabled', 'footerText', 'mode', 'compositionPreset', 'referenceOverlays', 'referenceOpacity', 'safeMargins',
  'exportSettings', 'titleStripPosition', 'stripFontScale', 'qpName', 'qpCredentials', 'companyName', 'projectionName', 'markerDefaults', 'zoneDefaults'];

// A kit saved by the studio's "Capture current settings" before this change: template, composition and all.
const OLD_KIT = {
  id: 'kit-1', name: 'Rift', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  config: {
    themeId: 'technical_sharp', accentColor: '#ae4b0a', titleBgColor: '#0a4268', titleFgColor: '#ffffff', panelBgColor: null, panelFgColor: '#1e1d26',
    templateId: 'side_panel', mode: 'drill_plan', compositionPreset: 'tight', logo: LOGO, logoCorner: 'tr', logoScale: 1.4, logoWidthPx: 200,
    titleCorner: 'tr', titleWidthPx: 640, legendCorner: 'br', legendTitle: 'Rift legend', legendWidthPx: 280, insetEnabled: false, insetMode: 'country',
    footerEnabled: true, footerText: 'Rift Resources', referenceOverlays: { geology: true }, safeMargins: { top: 40, right: 40, bottom: 40, left: 40 },
    exportSettings: { pixelRatio: 3, filename: 'rift' }, qpName: 'J. Doe', markerDefaults: { type: 'square', color: '#000', size: 10, label: '' },
    fonts: { title: 'Montserrat', legend: 'Lato' },
  },
};

// A figure with data: the extent, layers with grade breaks and geology categories, callouts and result text.
function dataProject() {
  const p = createInitialProjectState();
  return {
    ...p,
    mapView: { center: [49.1, -122.3], zoom: 11 },
    layout: { ...p.layout, title: 'Rift Drill Plan', subtitle: 'Hole RF-24-07', zoomPercent: 140, frameVersion: 3, legendItems: [{ id: 'a', label: 'Au g/t' }] },
    layers: [
      { id: 'assays', role: 'drillholes', style: { classify: { field: 'au', breaks: [0.1, 0.5, 1, 5], colors: ['#2c7bb6', '#abd9e9', '#fdae61', '#d7191c'] } } },
      { id: 'geology', role: 'other', style: { categories: { Basalt: '#4d9221', Granite: '#f1b6da' } } },
    ],
    callouts: [{ id: 'c1', text: '12.0m @ 5.2 g/t Au', anchor: [49.11, -122.31] }],
  };
}

describe('figure style validation', () => {
  it('reads nothing as the full version-1 shape with every value null (the figure keeps its own)', () => {
    const { ok, errors, style } = validateFigureStyle(undefined);
    expect(ok).toBe(true); expect(errors).toEqual([]);
    expect(style.version).toBe(FIGURE_STYLE_VERSION);
    expect(Object.keys(style.colours)).toEqual(STYLE_COLOURS);
    expect(Object.keys(style.type)).toEqual(STYLE_TYPE_ROLES);
    expect(Object.values(style.colours).every((v) => v === null)).toBe(true);
    expect(style.type.title).toEqual({ family: null, weight: null, size: null });
    expect(isEmptyFigureStyle(style)).toBe(true);
  });
  it('accepts a complete style, lower-casing and expanding hex colours', () => {
    const { ok, errors, style } = validateFigureStyle(FULL_STYLE);
    expect(errors).toEqual([]); expect(ok).toBe(true);
    expect(style.colours.primary).toBe('#0a4268');
    expect(style.colours.panelBorder).toBe('#cccccc');
    expect(style.type.title).toEqual({ family: 'Montserrat', weight: 700, size: 1.2 });
    expect(style.logo).toEqual({ assetRef: LOGO, placement: 'tr' });
    expect(style.sourceNote).toEqual({ position: 'footer', italic: true, prefix: 'Source:' });
    expect(isEmptyFigureStyle(style)).toBe(false);
  });
  it('drops each invalid field to null and says why, never throwing', () => {
    const { ok, errors, style } = validateFigureStyle({
      colours: { primary: 'navy', accent: '#12345', ink: '#000' },
      type: { title: { family: 'Comic Sans MS', weight: 750, size: 9 }, label: 'Inter' },
      logo: { assetRef: 'javascript:alert(1)', placement: 'middle' },
      panel: { radius: -2, shadow: 'huge' }, spacing: { margin: 50 }, sourceNote: { italic: 'yes', prefix: 'x'.repeat(40) },
    });
    expect(ok).toBe(false);
    expect(style.colours).toMatchObject({ primary: null, accent: null, ink: '#000000' });
    expect(style.type.title).toEqual({ family: null, weight: null, size: null });
    expect(style.type.label).toEqual({ family: null, weight: null, size: null });
    expect(style.logo).toEqual({ assetRef: null, placement: null });
    expect(style.panel).toEqual({ radius: null, padding: null, shadow: null });
    expect(style.spacing.margin).toBeNull();
    expect(style.sourceNote).toEqual({ position: null, italic: null, prefix: null });
    expect(errors.join(' ')).toMatch(/colours\.primary.*colours\.accent.*type\.title\.family.*type\.title\.weight.*type\.title\.size.*type\.label must be an object.*logo\.assetRef.*logo\.placement.*panel\.radius.*panel\.shadow.*spacing\.margin.*sourceNote\.italic.*sourceNote\.prefix/);
  });
  it('reads the known fields of a newer version and reports it', () => {
    const { ok, errors, style } = validateFigureStyle({ version: 2, colours: { accent: '#ff0000' }, future: { glow: true } });
    expect(ok).toBe(false);
    expect(errors[0]).toMatch(/version 2 is newer/);
    expect(style.version).toBe(1);
    expect(style.colours.accent).toBe('#ff0000');
    expect(style).not.toHaveProperty('future');
  });
  it('rejects a non-object outright but still returns a usable style', () => {
    expect(validateFigureStyle('blue').errors).toEqual(['style must be an object.']);
    expect(normaliseFigureStyle([1, 2]).colours.primary).toBeNull();
    expect(validateFigureStyle({ colours: 'red' }).errors).toEqual(['colours must be an object.']);
  });
  it('keeps data styling out: grade bins, geophysics units and geology categories are not style fields', () => {
    const style = normaliseFigureStyle({ ...FULL_STYLE, colours: { ...FULL_STYLE.colours, geology: '#4d9221' }, bins: [0.1, 1], geophys: { unit: 'mV/V' }, geology: { Basalt: '#000' } });
    expect(Object.keys(style)).toEqual(['version', 'colours', 'type', 'logo', 'panel', 'spacing', 'sourceNote']);
    expect(Object.keys(style.colours)).toEqual(STYLE_COLOURS);
  });
  it('accepts only image data URLs and https addresses as a logo', () => {
    expect(normAssetRef(LOGO)).toBe(LOGO);
    expect(normAssetRef('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
    for (const bad of ['http://x.test/l.png', 'data:text/html;base64,PHNjcmlwdD4=', 'javascript:1', '', 42]) expect(normAssetRef(bad)).toBeNull();
    expect(normHex(' #ABC ')).toBe('#aabbcc');
    expect(normHex('rgb(0,0,0)')).toBeNull();
  });
  it('snapshots a style without a second copy of an inline logo, and without sharing objects', () => {
    const src = structuredClone(FULL_STYLE), snap = styleSnapshot(src);
    expect(snap.logo.assetRef).toBe('figure:logo');
    src.colours.primary = '#ff00ff';
    expect(snap.colours.primary).toBe('#0a4268');
    expect(styleSnapshot({ logo: { assetRef: 'https://cdn.example.com/l.png' } }).logo.assetRef).toBe('https://cdn.example.com/l.png');
  });
});

describe('to2DLayout', () => {
  it('writes only stylistic layout keys', () => {
    const out = to2DLayout(FULL_STYLE);
    expect(Object.keys(out).every((k) => STYLE_2D_KEYS.includes(k))).toBe(true);
    expect(out).toEqual({
      accentColor: '#ae4b0a', titleBgColor: '#0a4268', titleFgColor: '#ffffff', panelBgColor: '#ffffff', panelFgColor: '#1e1d26',
      fonts: { title: 'Montserrat', legend: 'Inter', label: 'Inter', callout: 'Inter', footer: 'Lato' },
      titleFontScale: 1.2, legendFontScale: 0.9, logo: LOGO, logoCorner: 'tr',
    });
  });
  it('writes nothing for an empty style and only what a partial style names', () => {
    expect(to2DLayout({})).toEqual({});
    expect(to2DLayout(null)).toEqual({});
    expect(to2DLayout({ colours: { accent: '#ff6600' } })).toEqual({ accentColor: '#ff6600' });
  });
  it('gives a pale title block ink text, and a dark one white', () => {
    expect(to2DLayout({ colours: { primary: '#f4ead5' } }).titleFgColor).toBe('#0f172a');
    expect(to2DLayout({ colours: { primary: '#f4ead5', ink: '#222222' } }).titleFgColor).toBe('#222222');
    expect(to2DLayout({ colours: { primary: '#0c1a35' } }).titleFgColor).toBe('#ffffff');
  });
  it('leaves out families the editor cannot load and clamps sizes to its sliders', () => {
    const out = to2DLayout({ type: { title: { family: 'Poppins', size: 3 }, label: { family: 'Barlow', size: 0.5 } } });
    expect(out.fonts).toBeUndefined();
    expect(out.titleFontScale).toBe(1.5);
    expect(out.legendFontScale).toBe(0.6);
  });
  it('knows the same editor fonts as the font picker', () => {
    expect(EDITOR_FONTS).toEqual(Object.keys(FONT_OPTIONS));
  });
  it('keeps the figure\'s own logo for an https style logo (it would taint the PNG/PDF export canvas), and notes why', () => {
    const style = { colours: { accent: '#ff6600' }, logo: { assetRef: 'https://cdn.example.com/logo.png', placement: 'tr' } };
    expect(to2DLayout(style)).toEqual({ accentColor: '#ff6600', logoCorner: 'tr' });
    expect(to3DSettings(style)).toEqual({ accent: '#ff6600' });
    const { ok, errors, notes } = validateFigureStyle(style);
    expect(ok).toBe(true); expect(errors).toEqual([]);
    expect(notes).toEqual([expect.stringMatching(/logo\.assetRef is an https address.*keeps its own logo/)]);
    expect(validateFigureStyle({ logo: { assetRef: LOGO } }).notes).toEqual([]);
  });
  it('style only never copies an http(s) logo from an older kit either', () => {
    const before = { ...createInitialProjectState().layout, logo: LOGO };
    const next = applyBrandKitStyle({ id: 'k', config: { logo: 'https://cdn.example.com/logo.png', accentColor: '#ff6600' } }, before);
    expect(next.logo).toBe(LOGO);
    expect(next.accentColor).toBe('#ff6600');
  });
  it('never copies a logo reference that is only a snapshot marker', () => {
    expect(to2DLayout({ logo: { assetRef: 'figure:logo' } })).toEqual({});
  });
});

describe('to3DSettings', () => {
  it('maps the brand colours, the label family and an inline logo', () => {
    expect(to3DSettings(FULL_STYLE)).toEqual({ primary: '#0a4268', accent: '#ae4b0a', fonts: { sans: 'Inter' }, logo: LOGO });
  });
  it('falls back to the title family, and sets nothing it is not given', () => {
    expect(to3DSettings({ type: { title: { family: 'Poppins' } } })).toEqual({ fonts: { sans: 'Poppins' } });
    expect(to3DSettings({})).toEqual({});
  });
  it('never carries data styling into the 3D settings', () => {
    const keys = Object.keys(to3DSettings({ ...FULL_STYLE, bins: [1, 2], geology: { legend: [] } }));
    expect(keys.sort()).toEqual(['accent', 'fonts', 'logo', 'primary']);
  });
});

describe('old brand kits and MCP users', () => {
  const layout = createInitialProjectState().layout;
  it('keeps the saveable key list exactly as before', () => {
    expect(BRAND_KIT_SAVEABLE_KEYS).toEqual(LEGACY_KEYS);
  });
  it('applies an old kit exactly as the previous applyBrandKitConfig did', () => {
    expect(applyBrandKitConfig(OLD_KIT.config, layout)).toEqual(legacyApplyBrandKitConfig(OLD_KIT.config, layout));
    expect(applyBrandKitConfig(null, layout)).toBe(layout);
    expect(applyBrandKitConfig({}, layout)).toEqual(layout);
  });
  it('ignores a style field, so a kit with one applies the same through the old API (editor default kit, MCP)', () => {
    const withStyle = { ...OLD_KIT.config, style: FULL_STYLE };
    const out = applyBrandKitConfig(withStyle, layout);
    expect(out).toEqual(legacyApplyBrandKitConfig(OLD_KIT.config, layout));
    expect(out).not.toHaveProperty('style');
    expect(out).not.toHaveProperty('brandStyle');
  });
  it('a map style copied by the MCP connector (style_from_map) leaves the brand record behind', () => {
    const styled = applyBrandKitStyle(OLD_KIT, layout);
    const config = Object.fromEntries(BRAND_KIT_SAVEABLE_KEYS.filter((k) => styled[k] !== undefined).map((k) => [k, styled[k]]));
    expect(config).not.toHaveProperty('brandStyle');
  });
});

describe('style only', () => {
  it('copies only stylistic keys from an old kit, leaving template, composition and data defaults', () => {
    const before = dataProject(), next = applyBrandKitStyle(OLD_KIT, before.layout);
    const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before.layout[k]));
    expect(changed.every((k) => [...BRAND_KIT_STYLE_KEYS, 'fonts', 'brandStyle'].includes(k))).toBe(true);
    expect(next).toMatchObject({ themeId: 'technical_sharp', accentColor: '#ae4b0a', titleBgColor: '#0a4268', logo: LOGO, logoCorner: 'tr' });
    expect(next.fonts).toEqual({ ...before.layout.fonts, title: 'Montserrat', legend: 'Lato' });
    for (const k of ['templateId', 'mode', 'compositionPreset', 'titleCorner', 'titleWidthPx', 'legendCorner', 'legendTitle', 'insetEnabled',
      'insetMode', 'footerText', 'referenceOverlays', 'safeMargins', 'exportSettings', 'markerDefaults', 'logoScale', 'logoWidthPx',
      'title', 'subtitle', 'zoomPercent', 'frameVersion', 'legendItems', 'qpName']) {
      expect(next[k]).toEqual(before.layout[k]);
    }
  });
  it('does not touch the extent, layers, result text, grade breaks or geology colours', () => {
    const before = dataProject(), snapshot = structuredClone(before);
    const kit = { ...OLD_KIT, config: { ...OLD_KIT.config, style: FULL_STYLE } };
    const after = { ...before, layout: applyBrandKitStyle(kit, before.layout) };
    for (const k of ['mapView', 'layers', 'callouts', 'markers', 'polygons', 'areaClaims']) expect(after[k]).toEqual(snapshot[k]);
    expect(before).toEqual(snapshot); // nothing mutated in place
    for (const k of ['title', 'subtitle', 'zoomPercent', 'legendItems', 'templateId']) expect(after.layout[k]).toEqual(snapshot.layout[k]);
  });
  it('lets a kit null or absent value keep the map\'s own (a captured "no colour" never clears it)', () => {
    const before = { ...createInitialProjectState().layout, panelBgColor: '#fafafa', logo: LOGO };
    const next = applyBrandKitStyle({ id: 'k', config: { panelBgColor: null, logo: null } }, before);
    expect(next.panelBgColor).toBe('#fafafa');
    expect(next.logo).toBe(LOGO);
  });
  it('applies a kit style on top of its layout keys', () => {
    const kit = { ...OLD_KIT, config: { ...OLD_KIT.config, style: { colours: { accent: '#00cdd0' }, type: { label: { family: 'Roboto' } } } } };
    const next = applyBrandKitStyle(kit, createInitialProjectState().layout);
    expect(next.accentColor).toBe('#00cdd0');
    expect(next.fonts).toMatchObject({ title: 'Montserrat', legend: 'Roboto', label: 'Roboto', callout: 'Roboto' });
  });
});

describe('the brand record on a figure', () => {
  it('records the kit id, its revision and the resolved style', () => {
    const next = applyBrandKitStyle(OLD_KIT, createInitialProjectState().layout);
    expect(next.brandStyle).toMatchObject({ brandKitId: 'kit-1', brandRevision: '2026-10-01T10:00:00Z', mode: 'style' });
    expect(next.brandStyle.style.colours).toMatchObject({ primary: '#0a4268', accent: '#ae4b0a', ink: '#1e1d26', panel: null });
    expect(next.brandStyle.style.type.title.family).toBe('Montserrat');
    expect(next.brandStyle.style.logo).toEqual({ assetRef: 'figure:logo', placement: 'tr' });
  });
  it('keeps the applied style when the kit is edited afterwards', () => {
    const kit = structuredClone({ ...OLD_KIT, config: { ...OLD_KIT.config, style: FULL_STYLE } });
    const next = applyBrandKitStyle(kit, createInitialProjectState().layout), saved = structuredClone(next);
    kit.config.style.colours.accent = '#00ff00'; kit.config.accentColor = '#00ff00'; kit.config.fonts.title = 'Roboto'; kit.updated_at = '2026-11-01T00:00:00Z';
    expect(next).toEqual(saved);
  });
  it('falls back to created_at, and to null outside a saved kit', () => {
    expect(brandStyleRecord({ id: 'k', created_at: 'c' }, 'style', {}).brandRevision).toBe('c');
    expect(brandStyleRecord(null, 'full', {})).toMatchObject({ brandKitId: null, brandRevision: null, mode: 'full' });
  });
  it('reads a style from an old kit\'s layout keys', () => {
    const s = styleFromKitConfig(OLD_KIT.config);
    expect(s.colours).toMatchObject({ primary: '#0a4268', accent: '#ae4b0a', ink: '#1e1d26' });
    expect(s.type.label.family).toBe('Lato');
    expect(styleFromKitConfig({ style: FULL_STYLE }).type.label.family).toBe('Inter');
  });
});

describe('full template', () => {
  it('is the previous apply for an old kit, plus the brand record', () => {
    const layout = createInitialProjectState().layout;
    const { brandStyle, ...rest } = applyBrandKitTemplate(OLD_KIT, layout);
    expect(rest).toEqual(legacyApplyBrandKitConfig(OLD_KIT.config, layout));
    expect(brandStyle).toMatchObject({ brandKitId: 'kit-1', mode: 'full' });
  });
  it('lays a kit style over its template', () => {
    const kit = { ...OLD_KIT, config: { ...OLD_KIT.config, style: { colours: { accent: '#00cdd0' }, type: { title: { family: 'Roboto' } } } } };
    const next = applyBrandKitTemplate(kit, createInitialProjectState().layout);
    expect(next).toMatchObject({ templateId: 'side_panel', legendCorner: 'br', accentColor: '#00cdd0' });
    expect(next.fonts).toMatchObject({ title: 'Roboto', legend: 'Lato' });
  });
});

describe('3D typography adapter', () => {
  function fakeDoc({ linkOk = true, faces = 1, never = false } = {}) {
    const head = [];
    return {
      head: { appendChild: (el) => { head.push(el); queueMicrotask(() => (linkOk ? el.onload?.() : el.onerror?.())); } },
      getElementById: (id) => head.find((e) => e.id === id) || null,
      createElement: () => ({}),
      fonts: { load: vi.fn(() => (never ? new Promise(() => {}) : Promise.resolve(Array(faces).fill({})))) },
      links: head,
    };
  }
  function host(brandStyle = null) {
    const H = { S: { brandStyle }, sans: type.LEGACY.sans, statuses: [], rebuilt: 0, redrawn: 0 };
    Object.assign(H, {
      fonts(s) { if (s) H.sans = s; return H.sans; }, buildWallLabels: () => { H.rebuilt++; }, redraw: () => { H.redrawn++; }, status: (m) => H.statuses.push(m),
      project: {}, loadImg: vi.fn(async () => ({ staged: true })), commitLogo: vi.fn(),
    });
    return H;
  }
  it('keeps Source Sans 3 / IBM Plex Mono as the default, and Source Sans 3 as its usual stack', () => {
    expect(type.LEGACY).toEqual({ sans: '"Source Sans 3", "Segoe UI", sans-serif', mono: '"IBM Plex Mono", monospace' });
    expect(type.stackOf('Source Sans 3')).toBe(type.LEGACY.sans);
    expect(type.stackOf('Inter')).toBe('"Inter", "Segoe UI", sans-serif');
  });
  it('asks Google Fonts only for weights a family has', () => {
    expect(type.fontCssUrl('Barlow Semi Condensed')).toBe('https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;600;700&display=swap');
    expect(type.fontCssUrl('Lato')).toMatch(/wght@400;700&/);
  });
  it('loads only allowed families, and only once their faces are there', async () => {
    const doc = fakeDoc();
    expect(await type.loadFamily('Comic Sans MS', { doc })).toBe(false);
    expect(await type.loadFamily('Poppins', { doc })).toBe(true);
    expect(doc.links).toHaveLength(1);
    expect(doc.fonts.load).toHaveBeenCalledWith('700 16px "Poppins"');
    expect(await type.loadFamily('Poppins', { doc })).toBe(true);
    expect(doc.links).toHaveLength(1); // the stylesheet is linked once
    expect(await type.loadFamily('Source Sans 3', { doc })).toBe(true);
    expect(doc.links).toHaveLength(1); // the page links it already
    expect(await type.loadFamily('Inter', { doc: fakeDoc({ faces: 0 }) })).toBe(false);
    expect(await type.loadFamily('Inter', { doc: fakeDoc({ linkOk: false }) })).toBe(false);
  });
  it('gives up on a font host that never answers', async () => {
    expect(await type.loadFamily('Inter', { doc: fakeDoc({ never: true }), ms: 20 })).toBe(false);
  });
  it('leaves a figure without a brand style in its own fonts, and rebuilds nothing', async () => {
    const H = host(); type.init(H);
    await type.sync();
    expect(H.sans).toBe(type.LEGACY.sans);
    expect(H.rebuilt).toBe(0);
  });
  it('switches the figure text to a brand family after it loads, then rebuilds the painted labels', async () => {
    const realFonts = document.fonts, doc = globalThis.document;
    const H = host({ fonts: { sans: 'Source Sans 3' } }); type.init(H);
    await type.sync(); // Source Sans 3: the default stack, nothing to load or redraw
    expect(H.rebuilt).toBe(0);
    Object.defineProperty(doc, 'fonts', { configurable: true, value: { load: () => Promise.resolve([{}]) } });
    try {
      H.S.brandStyle = { fonts: { sans: 'IBM Plex Mono' } };
      await type.sync();
      expect(H.sans).toBe('"IBM Plex Mono", "Segoe UI", sans-serif');
      expect(H.rebuilt).toBe(1); expect(H.redrawn).toBe(1);
      H.S.brandStyle = null; await type.sync(); // the record removed: back to the default
      expect(H.sans).toBe(type.LEGACY.sans);
    } finally { Object.defineProperty(doc, 'fonts', { configurable: true, value: realFonts }); }
  });
  it('paints geology unit names in the figure\'s current sans (part of their cache key)', () => {
    let sans = type.LEGACY.sans;
    initGeology({ fonts: () => sans });
    expect(labelFont()).toBe(type.LEGACY.sans);
    sans = type.stackOf('Poppins');
    expect(labelFont()).toBe('"Poppins", "Segoe UI", sans-serif');
    initGeology({});
    expect(labelFont()).toBe(type.LEGACY.sans);
  });
  it('keeps the earlier fonts and says so when a brand family cannot load', async () => {
    const H = host({ fonts: { sans: 'Comic Sans MS' } }); type.init(H);
    await type.sync();
    expect(H.sans).toBe(type.LEGACY.sans);
    expect(H.statuses[0]).toMatch(/Comic Sans MS font could not be loaded/);
  });
  it('setFigureStyle applies the brand colours and records the style, kit and revision', async () => {
    const H = host(); type.init(H);
    const setBrand = vi.fn(), setLogo = vi.fn(async () => {});
    globalThis.EM3D = { setBrand, setLogo };
    try {
      await type.setFigureStyle({ colours: { primary: '#0a4268', accent: '#ae4b0a' }, logo: { assetRef: LOGO } }, { brandKitId: 'kit-1', brandRevision: 'r1' });
      expect(setBrand).toHaveBeenCalledWith({ primary: '#0a4268', accent: '#ae4b0a' });
      expect(H.commitLogo).toHaveBeenCalledWith({ staged: true }, LOGO);
      expect(setLogo).not.toHaveBeenCalled(); // staged logo commits without another async decode
      expect(H.S.brandStyle).toMatchObject({ brandKitId: 'kit-1', brandRevision: 'r1', mode: 'style', fonts: null });
      expect(H.S.brandStyle.style.logo.assetRef).toBe('figure:logo');
      await expect(type.setFigureStyle({ colours: { primary: 'navy' } })).rejects.toThrow(/colours\.primary/);
      await type.setFigureStyle({ logo: { assetRef: 'https://cdn.example.com/l.png' } });
      expect(H.commitLogo).toHaveBeenCalledTimes(1); // an https logo would taint the export canvas
      await type.setFigureStyle(null);
      expect(H.S.brandStyle).toBeNull();
    } finally { delete globalThis.EM3D; }
  });
  it('leaves colours, logo and metadata intact when staging a logo fails', async () => {
    const saved = { brandKitId: 'original' }, H = host(saved); type.init(H);
    H.loadImg.mockRejectedValue(new Error('bad logo'));
    const setBrand = vi.fn(); globalThis.EM3D = { setBrand };
    try {
      await expect(type.setFigureStyle({ colours: { accent: '#123456' }, logo: { assetRef: LOGO } })).rejects.toThrow('bad logo');
      expect(setBrand).not.toHaveBeenCalled(); expect(H.commitLogo).not.toHaveBeenCalled(); expect(H.S.brandStyle).toBe(saved);
    } finally { delete globalThis.EM3D; }
  });
  it.each(['figure', 'account'])('discards a staged logo after the %s context changes', async (kind) => {
    const H = host(); type.init(H); let finish, active = true;
    H.loadImg.mockImplementation(() => new Promise((r) => { finish = r; }));
    const setBrand = vi.fn(); globalThis.EM3D = { setBrand };
    try {
      const pending = type.setFigureStyle({ colours: { accent: '#123456' }, logo: { assetRef: LOGO } }, { isCurrent: () => active });
      if (kind === 'figure') H.project = {}; else active = false;
      finish({ staged: true }); await pending;
      expect(setBrand).not.toHaveBeenCalled(); expect(H.commitLogo).not.toHaveBeenCalled(); expect(H.S.brandStyle).toBeNull(); expect(H.redrawn).toBe(0);
    } finally { delete globalThis.EM3D; }
  });
  it('keeps the newer style when an earlier logo finishes later', async () => {
    const H = host(); type.init(H); let finish;
    H.loadImg.mockImplementation(() => new Promise((r) => { finish = r; }));
    const setBrand = vi.fn(); globalThis.EM3D = { setBrand };
    try {
      const pending = type.setFigureStyle({ colours: { accent: '#123456' }, logo: { assetRef: LOGO } }, { brandKitId: 'old' });
      await type.setFigureStyle({ colours: { accent: '#abcdef' } }, { brandKitId: 'new' });
      finish({ staged: true }); await pending;
      expect(setBrand).toHaveBeenCalledTimes(1); expect(setBrand).toHaveBeenCalledWith({ accent: '#abcdef' });
      expect(H.commitLogo).not.toHaveBeenCalled(); expect(H.S.brandStyle.brandKitId).toBe('new');
    } finally { delete globalThis.EM3D; }
  });
  it('does not repaint a replacement figure when an earlier font sync finishes', async () => {
    const realFonts = document.fonts, finish = [], H = host({ fonts: { sans: 'IBM Plex Mono' } }); type.init(H);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => new Promise((r) => finish.push(r)) } });
    try {
      const pending = type.sync(); H.project = {}; finish.forEach((r) => r([{}])); await pending;
      expect(H.sans).toBe(type.LEGACY.sans); expect(H.rebuilt).toBe(0); expect(H.redrawn).toBe(0);
    } finally { Object.defineProperty(document, 'fonts', { configurable: true, value: realFonts }); }
  });
});
