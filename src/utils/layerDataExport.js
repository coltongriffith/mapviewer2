// Export saved vector data without display filters, styles or rounding.
export function layerCollection(layer) {
  const data = layer?.geojson;
  if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) return data;
  if (data?.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
  return null;
}

const cell = (value) => {
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Protect textual cells, including headers, from spreadsheet formulas.
  // Real negative numbers remain numeric; GeoJSON retains original strings.
  // eslint-disable-next-line no-control-regex -- leading controls can disguise spreadsheet formulas.
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};

export function layerCsv(collection) {
  const features = collection.features;
  const keys = [...new Set(features.flatMap(f => Object.keys(f?.properties || {})))];
  const used = new Set(keys);
  const unique = (name) => {
    let candidate = name, n = 2;
    while (used.has(candidate)) candidate = name + '_' + n++;
    used.add(candidate);
    return candidate;
  };
  const headers = [unique('__feature_id'), unique('__geometry')];
  const points = features.some(f => f?.geometry?.type === 'Point');
  if (points) headers.push(unique('__longitude'), unique('__latitude'), unique('__elevation'));
  const rows = [headers.concat(keys).map(cell).join(',')];
  for (const feature of features) {
    const geometry = feature?.geometry ?? null;
    const values = [feature?.id, geometry];
    if (points) {
      const coords = geometry?.type === 'Point' ? geometry.coordinates : [];
      values.push(coords?.[0], coords?.[1], coords?.[2]);
    }
    values.push(...keys.map(k => feature?.properties?.[k]));
    rows.push(values.map(cell).join(','));
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

export function layerDataFile(layer, format, projectName = 'Map') {
  const collection = layerCollection(layer);
  if (!collection) throw new Error('This layer has no saved vector data.');
  if (!['csv', 'geojson'].includes(format)) throw new Error('Choose CSV or GeoJSON.');
  // eslint-disable-next-line no-control-regex -- filenames must exclude control characters.
  const clean = (s) => String(s || 'Layer').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'Layer';
  return {
    filename: clean(projectName) + '-' + clean(layer.name) + '.' + format,
    blob: new Blob([format === 'csv' ? layerCsv(collection) : JSON.stringify(collection, null, 2)],
      { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/geo+json' }),
  };
}
