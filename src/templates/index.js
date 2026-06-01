import { technicalResultsTemplate } from "./technicalResultsTemplate";
import { technicalReportTemplate } from "./technicalReportTemplate";
import { sidePanelTemplate } from "./sidePanelTemplate";

export const templates = {
  technical_results_v2: technicalResultsTemplate,
  ni_43101_technical: technicalReportTemplate,
  side_panel: sidePanelTemplate,
};

export function getTemplate(templateId) {
  return templates[templateId] || technicalResultsTemplate;
}
