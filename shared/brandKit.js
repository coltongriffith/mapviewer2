// The layout keys a brand kit carries, and how a kit is applied to a layout.
// Used by the editor (src/utils/cloudStorage.js) and the MCP connector.
import { normaliseFigureStyle, styleSnapshot } from './figureStyle.js';

export const BRAND_KIT_SAVEABLE_KEYS = [
  // Style & theme
  'themeId', 'accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'templateId',
  // Logo
  'logo', 'logoScale', 'logoCorner', 'logoWidthPx', 'logoHeightPx', 'logoTransparent', 'logoOpacity',
  // Title panel
  'titleCorner', 'titleWidthPx', 'titleHeightPx', 'titleTransparent', 'titleSize', 'titleWidth',
  // Legend
  'legendMode', 'legendTitle', 'legendCorner', 'legendWidthPx', 'legendHeightPx', 'legendTransparent', 'legendWidth',
  // Inset
  'insetEnabled', 'insetSize', 'insetMode', 'insetCorner', 'insetTitle', 'insetWidthPx', 'insetHeightPx',
  // Navigation elements
  'showNorthArrow', 'northArrowCorner', 'northArrowHeightPx', 'northArrowTransparent',
  'showScaleBar', 'scaleBarCorner', 'scaleBarTransparent',
  // Element layout & stacking order
  'cornerLayout', 'cornerOrder',
  // Footer
  'footerEnabled', 'footerText',
  // Display & composition
  'mode', 'compositionPreset', 'referenceOverlays', 'referenceOpacity', 'safeMargins',
  // Export defaults
  'exportSettings',
  // NI 43-101 fields
  'titleStripPosition', 'stripFontScale', 'qpName', 'qpCredentials', 'companyName', 'projectionName',
  // Marker/zone defaults
  'markerDefaults', 'zoneDefaults',
];

export function applyBrandKitConfig(config, currentLayout) {
  if (!config) return currentLayout;
  const patch = {};
  for (const key of BRAND_KIT_SAVEABLE_KEYS) {
    if (config[key] !== undefined) patch[key] = config[key];
  }
  // Merge fonts instead of overwriting so per-slot overrides are preserved
  if (config.fonts) patch.fonts = { ...currentLayout.fonts, ...config.fonts };
  return { ...currentLayout, ...patch };
}

// ── Figure style (opt-in, versioned: shared/figureStyle.js) ─────────────────
// A kit may carry config.style, a figure style. applyBrandKitConfig above never reads it, so old kits,
// the editor's default-kit path and the MCP connector apply exactly as before. The functions below are
// the new path: "style only" applies a kit's look and leaves the map's composition alone; "full template"
// is applyBrandKitConfig, with the kit's style on top when it has one. Both record what was applied.

// The layout keys a "style only" apply may copy from a kit without a style field: colours, the theme's
// panel treatment, the logo and how it sits, and fonts. Never template, extents, corners and sizes, inset,
// legend, footer text, overlays, export settings, QP fields or marker/zone data defaults.
export const BRAND_KIT_STYLE_KEYS = ['themeId', 'accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'logo', 'logoOpacity', 'logoTransparent', 'logoCorner'];
// Every key to2DLayout can write (fonts is merged slot by slot).
export const STYLE_2D_KEYS = ['accentColor', 'titleBgColor', 'titleFgColor', 'panelBgColor', 'panelFgColor', 'logo', 'logoCorner', 'titleFontScale', 'legendFontScale', 'fonts'];

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const clampScale = (v) => Math.round(Math.min(1.5, Math.max(0.6, v)) * 100) / 100; // the editor's slider range
// Only an inline (data URL) logo goes into a figure. An https logo is drawn without CORS, which taints the
// export canvas (PNG, PDF and the 3D export would throw), so the figure keeps its own logo; the style's
// validation notes it (figureStyle.js).
const inlineLogo = (ref) => !!ref && ref.startsWith('data:');
// The families the 2D editor loads and offers (FONT_OPTIONS in shared/projectState.js; a test keeps them in
// step). Listed here so /3d, which shares this module, does not also take the editor's project state.
export const EDITOR_FONTS = ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Lato'];

// The 2D layout keys a figure style sets: only the ones it names, so the map keeps everything else.
// The title block takes the primary colour, with white or ink text for contrast; panels take panel and
// ink. 2D sets type in the editor's fonts (title; legend, labels and callouts from the label role; footer
// from the note role) and sizes as the title and legend scales. muted, panelBorder, panel radius, padding
// and shadow, spacing and the source note have no 2D layout key yet: they travel in the snapshot only.
export function to2DLayout(style) {
  const s = normaliseFigureStyle(style), c = s.colours, out = {}, fonts = {};
  if (c.accent) out.accentColor = c.accent;
  if (c.primary) { out.titleBgColor = c.primary; out.titleFgColor = lum(c.primary) > 0.45 ? (c.ink || '#0f172a') : '#ffffff'; }
  if (c.panel) out.panelBgColor = c.panel;
  if (c.ink) out.panelFgColor = c.ink;
  const fam = (role) => (EDITOR_FONTS.includes(s.type[role].family) ? s.type[role].family : null);
  if (fam('title')) fonts.title = fam('title');
  if (fam('label')) Object.assign(fonts, { legend: fam('label'), label: fam('label'), callout: fam('label') });
  if (fam('note')) fonts.footer = fam('note');
  if (Object.keys(fonts).length) out.fonts = fonts;
  if (s.type.title.size !== null) out.titleFontScale = clampScale(s.type.title.size);
  if (s.type.label.size !== null) out.legendFontScale = clampScale(s.type.label.size);
  if (inlineLogo(s.logo.assetRef)) out.logo = s.logo.assetRef;
  if (s.logo.placement) out.logoCorner = s.logo.placement;
  return out;
}

// The /3d settings a figure style sets: EM3D.setBrand's primary and accent, the logo, and the fonts kept in
// S.brandStyle. 3D sets all text in one sans family, the label role's (else the title's), and keeps IBM
// Plex Mono for figures; weights, sizes and panels keep the 3D figure's own drawing.
export function to3DSettings(style) {
  const s = normaliseFigureStyle(style), out = {};
  if (s.colours.primary) out.primary = s.colours.primary;
  if (s.colours.accent) out.accent = s.colours.accent;
  const sans = s.type.label.family || s.type.title.family;
  if (sans) out.fonts = { sans };
  if (inlineLogo(s.logo.assetRef)) out.logo = s.logo.assetRef;
  return out;
}

// A figure style read from a kit: its style field, or its layout keys for a kit saved before one existed.
export function styleFromKitConfig(config = {}) {
  if (config.style) return normaliseFigureStyle(config.style);
  const f = config.fonts || {};
  return normaliseFigureStyle({
    colours: { primary: config.titleBgColor, accent: config.accentColor, ink: config.panelFgColor, panel: config.panelBgColor },
    type: { title: { family: f.title }, label: { family: f.label || f.legend }, note: { family: f.footer } },
    logo: { assetRef: config.logo, placement: config.logoCorner },
  });
}

// What a figure keeps of the kit applied to it, in layout.brandStyle (2D) or S.brandStyle (3D): the kit's
// id and revision (its updated_at), the mode and the resolved style. Kit values are copied into the
// figure, so a later edit to the kit never changes a saved, shared or exported figure; the record is what
// a later "kit changed" check compares against.
export function brandStyleRecord(kit, mode, style) {
  return { brandKitId: kit?.id ?? null, brandRevision: kit?.updated_at ?? kit?.created_at ?? null, mode, style: styleSnapshot(style) };
}

// "Style only": the kit's look on this map. Kit values that are null or absent leave the map's own.
export function applyBrandKitStyle(kit, currentLayout) {
  const config = kit?.config || {}, patch = {};
  for (const key of BRAND_KIT_STYLE_KEYS) if (config[key] !== undefined && config[key] !== null) patch[key] = config[key];
  if (/^https?:/i.test(patch.logo || '')) delete patch.logo; // another site's logo would taint the export: keep the map's own
  const fromStyle = config.style ? to2DLayout(config.style) : {};
  const fonts = { ...(config.fonts || {}), ...(fromStyle.fonts || {}) };
  Object.assign(patch, fromStyle);
  if (Object.keys(fonts).length) patch.fonts = { ...currentLayout.fonts, ...fonts };
  return { ...currentLayout, ...patch, brandStyle: brandStyleRecord(kit, 'style', styleFromKitConfig(config)) };
}

// "Full template": the kit's whole saved layout, as applyBrandKitConfig always has, then its style.
export function applyBrandKitTemplate(kit, currentLayout) {
  const config = kit?.config || {}, next = applyBrandKitConfig(config, currentLayout);
  const fromStyle = config.style ? to2DLayout(config.style) : {};
  if (fromStyle.fonts) fromStyle.fonts = { ...next.fonts, ...fromStyle.fonts };
  return { ...next, ...fromStyle, brandStyle: brandStyleRecord(kit, 'full', styleFromKitConfig(config)) };
}
