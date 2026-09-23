import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

const cache = new Map();
const logoCache = new Map();
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 100;

// Warm instances live for hours; bound both caches so arbitrary caller URLs
// cannot grow them without limit.
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE_ENTRIES) map.delete(map.keys().next().value);
}

function privateAddress(address) {
  if (address.includes(':')) return /^(::|fc|fd|fe[89ab]|64:ff9b:|2001:db8:|2002:)/i.test(address);
  const [a, b, c] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

async function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) || !url.hostname.includes('.')) throw new Error('Branding URL must be a public HTTPS domain.');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((record) => privateAddress(record.address))) throw new Error('Branding URL resolves to a private address.');
  return { url, address: addresses[0].address, family: addresses[0].family };
}

async function fetchPublic(value, maxBytes, contentTypes) {
  let current = value;
  for (let redirects = 0; redirects < 4; redirects++) {
    const result = await fetchPublicOnce(current, maxBytes, contentTypes);
    if (!result.redirect) return result;
    current = result.redirect;
  }
  throw new Error('Too many branding redirects.');
}

async function fetchPublicOnce(value, maxBytes, contentTypes) {
  const { url, address, family } = await publicUrl(value);
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: 'GET', timeout: 5000,
      headers: { Accept: contentTypes.join(', ') },
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address, family }])
        : callback(null, address, family),
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.destroy();
        resolve({ redirect: new URL(response.headers.location, url).href });
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); reject(new Error('Branding asset unavailable.')); return; }
      const type = response.headers['content-type']?.split(';')[0]?.toLowerCase();
      if (!contentTypes.includes(type)) { response.destroy(); reject(new Error('Unsupported branding asset type.')); return; }
      if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); reject(new Error('Branding asset too large.')); return; }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new Error('Branding asset too large.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ type, data: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('Branding fetch timed out.')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] || null;
}

function firstLogo(html, website) {
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  const ranked = tags.map((tag) => ({ tag, src: htmlAttribute(tag, 'src'), score: (/logo/i.test(tag) ? 10 : 0) + (/header|nav/i.test(tag) ? 2 : 0) }))
    .filter((item) => item.src && item.score > 0)
    .sort((a, b) => b.score - a.score);
  const candidate = ranked[0]?.src || html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
  return candidate ? new URL(candidate.replace(/&amp;/g, '&'), website).href : null;
}

function themeColor(html) {
  const tag = html.match(/<meta\b[^>]*name=["']theme-color["'][^>]*>/i)?.[0];
  const color = tag && htmlAttribute(tag, 'content');
  return color && /^#[0-9a-f]{6}$/i.test(color) && !/^#(?:000000|ffffff|f{3}f{3})$/i.test(color) ? color : null;
}

function googleFont(html) {
  const match = html.match(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^&"']+)/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]).replace(/\+/g, ' ').split(':')[0].trim(); } catch { return null; }
}

function isNeutralColor(hex) {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return Math.max(...rgb) - Math.min(...rgb) < 12;
}

export async function resolveBranding(input) {
  const brand = input || {};
  const result = { ...brand, source: null, logo_data_uri: null };
  let site = null;
  if (brand.website) {
    let key;
    try { key = new URL(brand.website).hostname; } catch { key = null; }
    if (!key) return result;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < THIRTY_DAYS) {
      site = hit.site;
    } else {
      try {
        const page = await fetchPublic(brand.website, 512 * 1024, ['text/html']);
        const html = page.data.toString('utf8');
        let logoUrl = null;
        try { logoUrl = firstLogo(html, brand.website); } catch { /* malformed src */ }
        site = { logoUrl, font: googleFont(html), color: themeColor(html) };
        remember(cache, key, { site, time: Date.now() });
      } catch { /* A brand website is optional; keep the map usable. */ }
    }
    if (site) {
      result.source = key;
      result.logo_url ||= site.logoUrl;
      result.font ||= site.font;
    }
  }
  if (result.logo_url) {
    try {
      const cachedLogo = logoCache.get(result.logo_url);
      const logo = cachedLogo && Date.now() - cachedLogo.time < THIRTY_DAYS
        ? cachedLogo.asset
        : await fetchPublic(result.logo_url, MAX_IMAGE_BYTES, ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
      if (logo.type === 'image/svg+xml') {
        const svg = logo.data.toString('utf8');
        if (!/<svg\b/i.test(svg) || /<(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|\b(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)|@import|url\s*\(/i.test(svg)) throw new Error('Unsafe SVG logo.');
        result.primary_color ||= [...svg.matchAll(/\bfill\s*(?:=\s*["']|:\s*)(#[0-9a-fA-F]{6})/g)]
          .map((match) => match[1]).find((color) => !isNeutralColor(color)) || null;
      }
      result.logo_data_uri = `data:${logo.type};base64,${logo.data.toString('base64')}`;
      if (!cachedLogo || Date.now() - cachedLogo.time >= THIRTY_DAYS) remember(logoCache, result.logo_url, { asset: logo, time: Date.now() });
      result.source ||= new URL(result.logo_url).hostname;
    } catch { /* An invalid external logo must not prevent map creation. */ }
  }
  result.primary_color ||= site?.color || null;
  return result;
}
