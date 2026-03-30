// Demo data — fictional BC mineral property "Lightning Creek"
// Used by the "Try Demo Data" button on the landing page

export const DEMO_LAYERS = [
  {
    name: 'Lightning Creek Claims',
    role: 'claims',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Lightning Creek Block A', tenure: 'ML-123456', hectares: '2,048' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-120.55, 52.35], [-120.38, 52.35], [-120.25, 52.33],
              [-120.22, 52.28], [-120.25, 52.18], [-120.45, 52.16],
              [-120.58, 52.20], [-120.60, 52.28], [-120.55, 52.35],
            ]],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'Lightning Creek Block B', tenure: 'ML-123457', hectares: '512' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-120.22, 52.28], [-120.10, 52.28], [-120.10, 52.20],
              [-120.22, 52.20], [-120.25, 52.23], [-120.22, 52.28],
            ]],
          },
        },
      ],
    },
  },
  {
    name: 'Drillholes',
    role: 'drillholes',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'LC-001', depth: '250m', gold: '2.1 g/t' },
          geometry: { type: 'Point', coordinates: [-120.47, 52.30] },
        },
        {
          type: 'Feature',
          properties: { name: 'LC-002', depth: '310m', gold: '3.8 g/t' },
          geometry: { type: 'Point', coordinates: [-120.42, 52.28] },
        },
        {
          type: 'Feature',
          properties: { name: 'LC-003', depth: '185m', gold: '1.4 g/t' },
          geometry: { type: 'Point', coordinates: [-120.38, 52.31] },
        },
        {
          type: 'Feature',
          properties: { name: 'LC-004', depth: '420m', gold: '5.2 g/t' },
          geometry: { type: 'Point', coordinates: [-120.44, 52.25] },
        },
        {
          type: 'Feature',
          properties: { name: 'LC-005', depth: '290m', gold: '1.9 g/t' },
          geometry: { type: 'Point', coordinates: [-120.35, 52.27] },
        },
        {
          type: 'Feature',
          properties: { name: 'LC-006', depth: '340m', gold: '4.1 g/t' },
          geometry: { type: 'Point', coordinates: [-120.50, 52.24] },
        },
      ],
    },
  },
  {
    name: 'Main Zone Target',
    role: 'target_areas',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Main Zone', type: 'Gold Target', priority: 'High' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [-120.52, 52.32], [-120.38, 52.32], [-120.34, 52.28],
              [-120.36, 52.23], [-120.52, 52.23], [-120.55, 52.27],
              [-120.52, 52.32],
            ]],
          },
        },
      ],
    },
  },
  {
    name: 'Access Roads',
    role: 'roads_access',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Lightning FSR', surface: 'Gravel' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-120.68, 52.18], [-120.60, 52.20], [-120.52, 52.22],
              [-120.45, 52.24], [-120.38, 52.26], [-120.28, 52.27],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'Block B Spur', surface: 'Gravel' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-120.38, 52.26], [-120.25, 52.26], [-120.15, 52.24],
            ],
          },
        },
      ],
    },
  },
];
