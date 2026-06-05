export default async function handler(req, res) {
  const { company, schema } = req.query;

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

  if (!company || company.trim().length < 2) {
    return res.status(400).json({ error: 'company param required (min 2 chars)' });
  }

  const cqlFilter = `TENURE_HOLDER ILIKE '%${company.trim().replace(/'/g, "''")}%'`;
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
