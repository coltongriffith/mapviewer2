import { createInitialProjectState, MAP_TYPES } from './projectState.js';
import { applyRoleToLayer } from './mapPresets.js';
import { AGENT_OVERLAYS, AGENT_JURISDICTIONS } from './agentSchema.js';

function id() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeFilename(value) {
  return String(value || 'exploration-maps-export')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 100) || 'exploration-maps-export';
}

function detectKind(featureCollection) {
  const first = featureCollection?.features?.find((f) => f?.geometry?.type);
  return first && ['Point', 'MultiPoint'].includes(first.geometry.type) ? 'points' : 'geojson';
}

function referenceOverlays(include = []) {
  const next = { geology: false, context: false, labels: false, rail: false };
  for (const requested of include) {
    const key = AGENT_OVERLAYS[requested];
    if (key) next[key] = true;
  }
  return next;
}

export function createAgentMapProject(input, {
  featureCollection,
  source = null,
  sourceMeta = null,
} = {}) {
  if (!input) throw new Error('Agent map input is required.');
  if (!featureCollection?.features?.length) throw new Error('At least one mapped feature is required.');

  const type = MAP_TYPES[input.map_type] || MAP_TYPES.claims;
  const project = createInitialProjectState();
  const layerId = id();
  const jurisdiction = AGENT_JURISDICTIONS[input.jurisdiction] || null;
  const layerName = input.company?.name || input.search?.query || jurisdiction?.label || 'Exploration Data';
  const kind = detectKind(featureCollection);
  const defaultRole = input.map_type === 'drill' ? 'drillholes' : 'claims';
  const role = input.data?.role || defaultRole;

  const baseLayer = {
    id: layerId,
    name: layerName,
    sourceName: `agent:${input.jurisdiction}`,
    dataSource: 'agent_registry',
    displayName: layerName,
    type: kind,
    visible: true,
    role,
    geojson: featureCollection,
    userStyled: false,
    legend: { enabled: true, label: layerName },
    provenance: {
      source: source || jurisdiction?.registry || 'Official mineral registry',
      jurisdiction: input.jurisdiction,
      generatedBy: 'ExplorationMaps Agent API',
      ...(jurisdiction?.caveat ? { caveat: jurisdiction.caveat } : {}),
      ...(sourceMeta ? { meta: sourceMeta } : {}),
    },
  };

  const mappedLayer = applyRoleToLayer(baseLayer, role, 0);

  return {
    ...project,
    layers: [mappedLayer],
    layout: {
      ...project.layout,
      title: input.title,
      subtitle: input.subtitle || (input.company?.name ? `${input.company.name} — ${jurisdiction?.label || input.jurisdiction}` : 'Mineral exploration project'),
      templateId: type.templateId,
      mode: type.mode,
      themeId: input.style || type.themeId,
      primaryLayerId: layerId,
      frameVersion: 1,
      referenceOverlays: referenceOverlays(input.include),
      exportSettings: {
        ...project.layout.exportSettings,
        filename: safeFilename(input.title),
      },
    },
  };
}
