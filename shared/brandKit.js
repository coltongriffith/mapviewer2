// The layout keys a brand kit carries, and how a kit is applied to a layout.
// Used by the editor (src/utils/cloudStorage.js) and the MCP connector.

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
