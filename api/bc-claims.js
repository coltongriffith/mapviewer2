export default async function handler(req, res) {
  const { q, company, type, schema, bbox } = req.query;
  // Accept either `q` (new) or `company` (legacy) as the search term
  const term = q || company;

  // BBOX mode: fetch all tenures within a lng/lat bounding box (nearby claims overlay)
  if (bbox) {
    const parts = String(bbox).split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'bbox must be minLng,minLat,maxLng,maxLat' });
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    // Use CQL BBOX() — lon,lat order, unambiguous across WFS versions
    const cql = `BBOX(SHAPE,${minLng},${minLat},${maxLng},${maxLat})`;
    const bboxUrl = [
      'https://openmaps.gov.bc.ca/geo/pub/wfs',
      '?SERVICE=WFS',
      '&VERSION=2.0.0',
      '&REQUEST=GetFeature',
      '&outputFormat=application/json',
      '&typeNames=pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
      '&SRSNAME=EPSG:4326',
      `&CQL_FILTER=${encodeURIComponent(cql)}`,
      '&count=2000',
    ].join('');
    try {
      const r = await fetch(bboxUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0; +https://explorationmaps.com)',
          'Referer': 'https://explorationmaps.com/',
          'Origin': 'https://explorationmaps.com',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) {
        const b = await r.text().catch(() => '');
        return res.status(502).json({ error: `WFS returned ${r.status}`, detail: b.slice(0, 2000) });
      }
      const data = await r.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ error: e.message || 'Failed to reach BC WFS' });
    }
  }

  // Schema discovery mode: return field names from a sample feature
  if (schema === '1') {
    const schemaUrl = [
      'https://openmaps.gov.bc.ca/geo/pub/wfs',
      '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature',
      '&outputFormat=application/json',
      '&typeNames=pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
      '&count=1',
    ].join('');
    try {
      const r = await fetch(schemaUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        const b = await r.text().catch(() => '');
        return res.status(502).json({ error: `WFS ${r.status}`, detail: b.slice(0, 2000) });
      }
      const data = await r.json();
      const fields = Object.keys(data?.features?.[0]?.properties || {});
      return res.status(200).json({ fields, sample: data?.features?.[0]?.properties });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  if (!term || term.trim().length < 2) {
    return res.status(400).json({ error: 'q param required (min 2 chars)' });
  }

  const safeTerm = term.trim().replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');

  let cqlFilter;
  if (type === 'number') {
    cqlFilter = `TAG_NUMBER = '${safeTerm}'`;
  } else if (type === 'map') {
    cqlFilter = `MAP_UNIT_NO ILIKE '${safeTerm}%'`;
  } else {
    cqlFilter = `OWNER_NAME ILIKE '%${safeTerm}%'`;
  }
  const wfsUrl = [
    'https://openmaps.gov.bc.ca/geo/pub/wfs',
    '?SERVICE=WFS',
    '&VERSION=2.0.0',
    '&REQUEST=GetFeature',
    '&outputFormat=application/json',
    '&typeNames=pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
    '&SRSNAME=EPSG:4326',
    `&CQL_FILTER=${encodeURIComponent(cqlFilter)}`,
    '&count=500',
  ].join('');

  try {
    const response = await fetch(wfsUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; ExplorationMaps/1.0; +https://explorationmaps.com)',
        'Referer': 'https://explorationmaps.com/',
        'Origin': 'https://explorationmaps.com',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return res.status(502).json({ error: `WFS returned ${response.status}`, detail: body.slice(0, 2000) });
    }
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed to reach BC WFS' });
  }
}
