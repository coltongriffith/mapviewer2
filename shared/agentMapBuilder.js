import { createInitialProjectState, MAP_TYPES, FONT_OPTIONS } from './projectState.js';
import { applyRoleToLayer } from './mapPresets.js';
import { AGENT_OVERLAYS, AGENT_JURISDICTIONS } from './agentSchema.js';
import { claimCentroid, claimHolder } from './claimData.js';

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
  neighbours = null,
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
  const brand = input.branding || {};
  const primaryColor = brand.primary_color || '#2563eb';
  const onDark = Boolean(input.basemap?.startsWith('satellite') || input.basemap === 'dark');
  mappedLayer.style = { ...mappedLayer.style, stroke: primaryColor, fill: primaryColor, fillOpacity: input.basemap?.startsWith('satellite') ? 0.25 : 0.22, strokeWidth: 2.5 };
  const neighbourLayer = neighbours?.features?.length ? applyRoleToLayer({
    ...baseLayer,
    id: id(),
    name: 'Neighbouring claims',
    displayName: 'Neighbouring claims',
    geojson: neighbours,
    // Context, not subject: framing fits the project claims, not the neighbourhood.
    focus: false,
    legend: { enabled: true, label: 'Neighbouring claims' },
    style: { stroke: onDark ? '#ffffff' : '#8b95a3', fill: '#a9b0bb', fillOpacity: onDark ? 0 : 0.06, strokeWidth: 1, dashArray: '4 4' },
  }, 'claims', 1) : null;
  const anchor = claimCentroid(featureCollection.features[0]);
  const sourceLabel = source || input.data?.source_name || jurisdiction?.registry || 'Map data';
  const facts = input.facts_panel || {};
  const callout = input.claims_callout || { show: true };
  // Published facts ride in the project callout: callouts are drawn by the
  // editor, the share page and export alike, and stay editable. (A separate
  // layout.factsPanel existed only on the share page, clipped inside the legend.)
  const hectares = Number.isFinite(facts.hectares) ? `${Math.round(facts.hectares).toLocaleString('en-US')} ha` : null;
  const factLines = [
    facts.commodity && `Commodity: ${facts.commodity}`,
    Number.isInteger(facts.claims) ? `Claims: ${facts.claims}${hectares ? ` (${hectares})` : ''}` : hectares && `Area: ${hectares}`,
    facts.ownership && `Ownership: ${facts.ownership}`,
    facts.access && `Access: ${facts.access}`,
    facts.tickers?.length && facts.tickers.join(' · '),
  ].filter(Boolean);
  const fieldText = Object.values(callout.fields || {}).filter(Boolean).slice(0, 6).map(String);
  if (!fieldText.length && !factLines.length) fieldText.push(`${featureCollection.features.length} claims`, sourceLabel);
  const overlay = referenceOverlays(input.include);
  if (input.basemap === 'geology') overlay.geology = true;
  if (input.basemap === 'satellite_hybrid') overlay.labels = true;
  if (input.basemap?.startsWith('satellite') && !input.include.includes('geology')) overlay.geology = false;
  const holderGroups = new Map();
  if (input.neighbours?.label_holders) {
    for (const feature of neighbours?.features || []) {
      const holder = claimHolder(feature);
      if (!holder) continue;
      if (!holderGroups.has(holder)) holderGroups.set(holder, []);
      holderGroups.get(holder).push(feature);
    }
  }
  const neighbourLabels = [...holderGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, input.neighbours?.max_holders ?? 8)
    .map(([holder, features]) => ({
      id: id(), type: 'plain', priority: 3, text: holder,
      anchor: claimCentroid(features[0]), offset: { x: 8, y: -8 }, boxWidth: 160,
      style: { textColor: onDark ? '#ffffff' : '#4b5563', fontSize: 10 },
    })).filter((label) => label.anchor);

  return {
    ...project,
    layers: [...(neighbourLayer ? [neighbourLayer] : []), mappedLayer],
    callouts: [...(role === 'claims' && anchor && callout.show !== false ? [{
      id: id(), type: 'boxed', priority: 1,
      text: String(callout.fields?.project || facts.project || input.title),
      subtext: [...factLines, ...fieldText, callout.source_note].filter(Boolean).join('\n'),
      anchor, offset: { x: 28, y: -100 }, boxWidth: 250,
      style: { background: '#ffffff', border: callout.style === 'technical' ? '#111827' : primaryColor, textColor: '#17212f', fontSize: callout.style === 'minimal' ? 11 : 12 },
    }] : []), ...neighbourLabels],
    markers: (input.annotations || []).map((annotation) => ({ id: id(), lat: annotation.lat, lng: annotation.lng, type: 'pin', label: annotation.label, color: primaryColor, size: 18 })),
    layout: {
      ...project.layout,
      title: input.title,
      subtitle: input.subtitle || (input.company?.name ? `${input.company.name} — ${jurisdiction?.label || input.jurisdiction}` : 'Mineral exploration project'),
      templateId: type.templateId,
      mode: type.mode,
      themeId: input.style || type.themeId,
      basemap: input.basemap === 'white' ? 'white' : input.basemap,
      basemapOpacity: input.basemap_opacity,
      insetEnabled: input.inset?.show !== false,
      insetBasemap: input.inset?.basemap || input.basemap,
      // A tiled locator for any inset basemap except 'white', which is the
      // plain province/state locator. insetMode is what the editor, the share
      // page and export all key on.
      insetMode: (input.inset?.basemap || input.basemap) === 'white' ? 'province_state' : 'satellite_locator',
      logo: brand.logo_data_uri || null,
      accentColor: brand.accent_color || primaryColor,
      fonts: brand.font && FONT_OPTIONS[brand.font]
        ? { ...project.layout.fonts, title: brand.font, legend: brand.font, callout: brand.font, label: brand.font, footer: brand.font }
        : project.layout.fonts,
      mapDate: new Date().toISOString().slice(0, 10),
      footerText: `Data: ${sourceLabel} · ${new Date().toISOString().slice(0, 10)}${role === 'claims' ? ' · Informational map; verify title with the official registry.' : ''}`,
      primaryLayerId: layerId,
      frameVersion: 1,
      referenceOverlays: overlay,
      exportSettings: {
        ...project.layout.exportSettings,
        filename: safeFilename(input.title),
      },
    },
  };
}
