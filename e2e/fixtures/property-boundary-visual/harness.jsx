// Local-only renderer proof. Not a production input, route or entitlement path.
import React from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../../../src/styles.css';
import ReadOnlyMapStage from '../../../src/components/ReadOnlyMapStage.jsx';
import { createInitialProjectState } from '../../../shared/projectState.js';
import { applyPropertyNeighbours } from '../../../src/utils/propertyNeighbours.js';
import { buildScene } from '../../../src/export/buildScene.js';
import { renderSceneToSvg } from '../../../src/export/renderScene.js';
import { buildLegendItems } from '../../../src/templates/technicalResultsTemplate.js';
import { getTemplate } from '../../../src/templates/index.js';

const ring = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const fixture = createInitialProjectState();
fixture.layers = [{ id: 'qa-boundary', role: 'claims', type: 'geojson', visible: true,
  name: 'Synthetic claims', displayName: 'Synthetic claims', focus: true,
  geojson: { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'QA-A', properties: { TENURE_NUMBER_ID: 'QA-A', PROJECT_NAME: 'Synthetic boundary QA', Cu_ppm: 10 }, geometry: { type: 'Polygon', coordinates: [ring(-120,50,.01,.02),ring(-119.997,50.006,.003,.004)] } },
    { type: 'Feature', id: 'QA-B', properties: { TENURE_NUMBER_ID: 'QA-B', PROJECT_NAME: 'Synthetic boundary QA', Cu_ppm: 20 }, geometry: { type: 'Polygon', coordinates: [ring(-119.99,50,.01,.02)] } },
    { type: 'Feature', id: 'QA-C', properties: { TENURE_NUMBER_ID: 'QA-C', PROJECT_NAME: 'Synthetic boundary QA', Cu_ppm: 30 }, geometry: { type: 'Polygon', coordinates: [ring(-119.975,50,.008,.02)] } },
  ] }, style: {}, legend: { enabled: true, label: 'Synthetic claims' } }];
fixture.layout.primaryLayerId = 'qa-boundary';
let project = applyPropertyNeighbours(fixture);
project = { ...project, layout: { ...project.layout, propertyBoundaryOutline: true,
  basemap: 'blank', insetEnabled: false, showScaleBar: false, showNorthArrow: false,
  footerText: 'SYNTHETIC QA ONLY — not real claims, ownership or assay evidence.', footerEnabled: true } };
project.layout.legendItems = buildLegendItems(getTemplate(project.layout.templateId), project.layers, project.layout);
const original = JSON.stringify(project);
// Explicit fixture instrumentation captures only the map created in this page.
L.Map.addInitHook(function () { window.boundaryQaMap = this; });
window.boundaryQa = {
  project,
  async svg() {
    const stage = document.querySelector('.map-stage');
    const scene = buildScene(stage, project, window.boundaryQaMap);
    const svg = await renderSceneToSvg(scene, { pixelRatio: 1, embedFonts: false, noWatermark: true });
    if (JSON.stringify(project) !== original) throw new Error('Renderer mutated fixture source');
    return svg;
  },
};
const style = document.createElement('style');
style.textContent = 'html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}header{flex:none;padding:8px;background:#fff;color:#233b43;font:12px Arial}main{flex:1;min-height:0;background:#e9eef0;display:flex}.readonly-stage-fit{width:100%;height:100%}';
document.head.appendChild(style);
createRoot(document.getElementById('root')).render(<><header>SYNTHETIC QA — actual ReadOnlyMapStage and shared SVG renderer; no account or entitlement changes</header><main><React.Suspense fallback={<p>Loading renderer…</p>}><ReadOnlyMapStage project={project} onExportReady={() => { window.boundaryQa.ready = true; }} /></React.Suspense></main></>);
