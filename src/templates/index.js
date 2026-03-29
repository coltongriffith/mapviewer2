import { technicalResultsTemplate } from "./technicalResultsTemplate";

export const templates = {
  technical_results_v2: technicalResultsTemplate,
};

export function getTemplate(templateId) {
  return templates[templateId] || technicalResultsTemplate;
}

export const TEMPLATE_PRESETS = {
  investor: {
    id: 'investor',
    label: 'Investor Map',
    themeId: 'investor_clean',
    basemap: 'light',
    mode: 'regional_claims',
    referenceOverlays: { context: true, labels: true, rail: false },
    referenceOpacity: 0.35,
  },
  technical: {
    id: 'technical',
    label: 'Technical Map',
    themeId: 'technical_sharp',
    basemap: 'topo',
    mode: 'access_location',
    referenceOverlays: { context: true, labels: true, rail: true },
    referenceOpacity: 0.45,
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite Map',
    themeId: 'modern_rounded',
    basemap: 'satellite',
    mode: 'project_overview',
    referenceOverlays: { context: false, labels: true, rail: false },
    referenceOpacity: 0.5,
  },
};
