const STOP_WORDS = [
  'final','revised','revision','copy','draft','export','layer','geojson','json','shape','shapefile','shp','kml'
];

function titleCase(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function cleanLayerName(rawName = '', roleHint = '') {
  const original = String(rawName || '').replace(/\.[a-z0-9]+$/i, '');
  let name = original
    .replace(/[._-]+/g, ' ')
    .replace(/\b\d{4}[-_/]\d{2}[-_/]\d{2}\b/g, ' ')
    .replace(/\b\d{8}\b/g, ' ')
    .replace(/\bv\d+\b/gi, ' ')
    .replace(/\b(?:planned|updated)\b/gi, (m) => m.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();

  const lowered = name.toLowerCase();
  const tokens = lowered
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.includes(token));

  const has = (needle) => tokens.some((token) => token.includes(needle));
  const role = String(roleHint || '').toLowerCase();

  if (role === 'claims' || has('landholding') || has('claim') || has('tenure')) {
    if (has('rift')) return 'Rift Project Claims';
    if (has('project')) return titleCase(tokens.filter((t) => t !== 'claims' && t !== 'claim').join(' ')) + ' Claims';
    return 'Project Claims';
  }
  if (role === 'drillholes' || has('drill') || has('hole') || has('ddh')) return 'Planned Drillholes';
  if (role === 'target_areas' || has('target')) return 'Target Areas';
  if (role === 'anomalies' || has('anomaly') || has('mag')) return 'Anomalies';
  if (role === 'faults_structures' || has('fault') || has('structure')) return 'Faults / Structures';
  if (role === 'roads_access' || has('road') || has('access') || has('highway')) return 'Roads / Access';
  if (role === 'rivers_water' || has('river') || has('water') || has('creek')) return 'Rivers / Water';
  if (role === 'labels' || has('label') || has('town')) return 'Reference Labels';

  const cleaned = titleCase(tokens.join(' '));
  return cleaned || 'Map Layer';
}
