import { technicalResultsTemplate } from "./technicalResultsTemplate";

export const templates = {
  technical_results_v2: technicalResultsTemplate,
};

export function getTemplate(templateId) {
  return templates[templateId] || technicalResultsTemplate;
}
