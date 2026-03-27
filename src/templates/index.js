import { technicalResultsTemplate } from "./technicalResultsTemplate";

export const templates = {
  technical_results_v1: technicalResultsTemplate,
  property_overview_v1: {
    ...technicalResultsTemplate,
    id: "property_overview_v1",
    label: "Property Overview (coming soon)",
  },
  presentation_panel_v1: {
    ...technicalResultsTemplate,
    id: "presentation_panel_v1",
    label: "Presentation Panel (coming soon)",
  },
};

export function getTemplate(templateId) {
  return templates[templateId] || technicalResultsTemplate;
}
