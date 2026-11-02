import { propertySubject, propertyTitle } from './propertyNeighbours.js';

const genericTitle = (title) => !title || ['Project Map', 'Untitled Map', 'Untitled map'].includes(title.trim());

/** Apply only after an explicit Technical Report card selection. Metadata is
 * supplied, not inferred: the existing strip renderer owns missing-field/date,
 * scale and projection fallbacks. No QP or report approval is manufactured.
 */
export function applyTechnicalReport(project) {
  const original = project.layout || {};
  const subject = propertySubject(project);
  const title = subject ? propertyTitle(subject, original.title)
    : genericTitle(original.title) ? 'Technical Report' : original.title;
  return {
    ...project,
    // Keep uploaded visibility, classification, IDs, styles and result pins.
    layers: project.layers,
    layout: {
      ...original,
      technicalReportVersion: 1,
      title,
      subtitle: ['Technical Results', 'Claims Map', 'Investor Map'].includes(original.subtitle) ? '' : original.subtitle,
      showLegend: true,
      legendFit: true,
      legendGrouped: original.legendGrouped !== false,
      compositionPreset: 'balanced',
      insetMode: original.insetMode === 'custom_image' ? original.insetMode : 'province_state',
      exportRatio: original.exportRatio || (original.exportSettings?.customWidth > 0
        && original.exportSettings?.customHeight > 0 ? null : 'landscape'),
    },
  };
}
