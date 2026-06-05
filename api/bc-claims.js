export default async function handler(req, res) {
  const { company } = req.query;
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
