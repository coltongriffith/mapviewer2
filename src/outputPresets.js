export const OUTPUT_PRESETS = {
  press_release_map: 'Press Release Map',
  investor_presentation_map: 'Investor Presentation Map',
  regional_claims_map: 'Regional Claims Map',
  drill_results_highlight_map: 'Drill Results Highlight Map',
};

const commonSafeMargins = { top: 18, right: 18, bottom: 18, left: 18 };

export const OUTPUT_PRESET_CONFIG = {
  press_release_map: {
    titleBlockSizing: { width: 540, height: 94 },
    legendPlacement: { anchor: 'bottom-left', width: 300, height: 176, bottom: 92, left: 18 },
    insetDefaults: { insetMode: 'province_state', insetEnabled: true, insetSize: 'medium' },
    markerDefaults: { type: 'circle', color: '#d97706', size: 18, label: '' },
    zoneDefaults: { width: 90, height: 56, rotation: -18, color: '#dc2626', dashed: true, label: '' },
    exportFraming: { compositionPreset: 'balanced', zoomPercent: 100 },
    safeMargins: commonSafeMargins,
    fontHierarchy: { title: 'Inter', legend: 'Inter', label: 'Inter', callout: 'Inter', footer: 'Inter' },
    logoPlacement: { anchor: 'top-left', top: 116, left: 18, width: 180, height: 84 },
    northArrowPlacement: { anchor: 'bottom-right', bottom: 18, right: 18, width: 76, height: 104 },
  },
  investor_presentation_map: {
    titleBlockSizing: { width: 560, height: 98 },
    legendPlacement: { anchor: 'bottom-left', width: 320, height: 188, bottom: 92, left: 18 },
    insetDefaults: { insetMode: 'country', insetEnabled: true, insetSize: 'large' },
    markerDefaults: { type: 'square', color: '#0f766e', size: 18, label: '' },
    zoneDefaults: { width: 96, height: 60, rotation: -10, color: '#2563eb', dashed: true, label: '' },
    exportFraming: { compositionPreset: 'balanced', zoomPercent: 96 },
    safeMargins: commonSafeMargins,
    fontHierarchy: { title: 'Montserrat', legend: 'Inter', label: 'Open Sans', callout: 'Open Sans', footer: 'Inter' },
    logoPlacement: { anchor: 'top-left', top: 118, left: 18, width: 196, height: 86 },
    northArrowPlacement: { anchor: 'bottom-right', bottom: 18, right: 18, width: 76, height: 104 },
  },
  regional_claims_map: {
    titleBlockSizing: { width: 520, height: 92 },
    legendPlacement: { anchor: 'bottom-left', width: 292, height: 180, bottom: 92, left: 18 },
    insetDefaults: { insetMode: 'country', insetEnabled: true, insetSize: 'small' },
    markerDefaults: { type: 'triangle', color: '#b45309', size: 16, label: '' },
    zoneDefaults: { width: 98, height: 62, rotation: -14, color: '#7c2d12', dashed: true, label: '' },
    exportFraming: { compositionPreset: 'regional', zoomPercent: 100 },
    safeMargins: commonSafeMargins,
    fontHierarchy: { title: 'Inter', legend: 'Lato', label: 'Lato', callout: 'Inter', footer: 'Inter' },
    logoPlacement: { anchor: 'top-left', top: 112, left: 18, width: 170, height: 78 },
    northArrowPlacement: { anchor: 'bottom-right', bottom: 18, right: 18, width: 74, height: 102 },
  },
  drill_results_highlight_map: {
    titleBlockSizing: { width: 560, height: 100 },
    legendPlacement: { anchor: 'bottom-left', width: 320, height: 192, bottom: 92, left: 18 },
    insetDefaults: { insetMode: 'secondary_zoom', insetEnabled: true, insetSize: 'medium' },
    markerDefaults: { type: 'pickaxe', color: '#be123c', size: 20, label: '' },
    zoneDefaults: { width: 108, height: 66, rotation: -16, color: '#be123c', dashed: true, label: '' },
    exportFraming: { compositionPreset: 'tight', zoomPercent: 94 },
    safeMargins: commonSafeMargins,
    fontHierarchy: { title: 'Montserrat', legend: 'Inter', label: 'Inter', callout: 'Inter', footer: 'Inter' },
    logoPlacement: { anchor: 'top-left', top: 122, left: 18, width: 188, height: 84 },
    northArrowPlacement: { anchor: 'bottom-right', bottom: 18, right: 18, width: 80, height: 106 },
  },
};

export function getOutputPresetConfig(id) {
  return OUTPUT_PRESET_CONFIG[id] || OUTPUT_PRESET_CONFIG.press_release_map;
}
