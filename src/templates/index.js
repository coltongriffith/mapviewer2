import { technicalResultsTemplate } from "./technicalResultsTemplate";
import { technicalReportTemplate } from "./technicalReportTemplate";

export const templates = {
  technical_results_v2: technicalResultsTemplate,
  ni_43101_technical: technicalReportTemplate,
};

export function getTemplate(templateId) {
  return templates[templateId] || technicalResultsTemplate;
}
