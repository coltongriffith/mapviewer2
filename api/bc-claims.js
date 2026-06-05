export default async function handler(req, res) {
  const { company } = req.query;
  if (!company || company.trim().length < 2) {
    return res.status(400).json({ error: 'company param required (min 2 chars)' });
  }

  const url = new URL('https://openmaps.gov.bc.ca/geo/pub/wfs');
  url.searchParams.set('SERVICE', 'WFS');
  url.searchParams.set('VERSION', '2.0.0');
  url.searchParams.set('REQUEST', 'GetFeature');
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('typeNames', 'pub:WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW');
  url.searchParams.set('SRSNAME', 'EPSG:4326');
  url.searchParams.set('CQL_FILTER', `TENURE_HOLDER ILIKE '%${company.trim().replace(/'/g, "''")}%'`);
  url.searchParams.set('count', '2000');

  try {
    const response = await fetch(url.toString(), {
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
      return res.status(502).json({ error: `WFS returned ${response.status}`, detail: body.slice(0, 400) });
    }
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed to reach BC WFS' });
  }
}
