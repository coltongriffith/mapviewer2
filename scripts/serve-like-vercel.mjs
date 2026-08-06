// Static server that applies vercel.json's rewrites, headers and 404 handling
// to the built dist/ directory.
//
// `vite preview` ignores vercel.json entirely, so E2E run against it cannot
// tell whether the SPA rewrites, the real-404 behaviour (audit P1-15) or the
// security headers are configured correctly — exactly the things that are
// invisible to the unit suite. Serving through this script means the smoke
// tests validate vercel.json itself, not just the bundle.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Translate a vercel source pattern (/map/:id, /admin/:path*) into a RegExp.
function toRegExp(source) {
  // Order matters: pull the wildcard groups out BEFORE regex-escaping, then
  // restore them. Escaping first turns `(.*)` into `\(\.*\)`, which no
  // longer matches the placeholder and silently produces a pattern that
  // matches nothing — which is how the header rules ended up never applying.
  const WILDCARD = '\u0000WILDCARD\u0000';
  const SEGMENT = '\u0000SEGMENT\u0000';
  const REST = '\u0000REST\u0000';

  const pattern = source
    // `{/}?` is path-to-regexp's optional-trailing-slash group. The final
    // `/?$` below already allows it, but leaving it in the source means the
    // escape pass turns it into a literal `\{\/\}\?` that matches nothing —
    // which is why every redirect in vercel.json silently 404'd against this
    // server, including the ones written long before it was noticed.
    .replace(/\{\/\}\?/g, '')
    .replace(/\(\.\*\)/g, WILDCARD)
    .replace(/\/:(\w+)\*/g, REST)
    .replace(/:(\w+)/g, SEGMENT)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split(WILDCARD).join('.*')
    .split(REST).join('(?:/.*)?')
    .split(SEGMENT).join('[^/]+');
  return new RegExp(`^${pattern}/?$`);
}

const rewrites = (config.rewrites || []).map((r) => ({ re: toRegExp(r.source), dest: r.destination }));
const redirects = (config.redirects || []).map((r) => ({ re: toRegExp(r.source), dest: r.destination, permanent: r.permanent }));
const headerRules = (config.headers || []).map((h) => ({ re: toRegExp(h.source), headers: h.headers }));

function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) {
    if (rule.re.test(pathname)) {
      for (const { key, value } of rule.headers) out[key] = value;
    }
  }
  return out;
}

async function tryFile(pathname) {
  // Directory-style URLs resolve to index.html, matching Vercel's behaviour.
  const candidates = pathname.endsWith('/')
    ? [join(DIST, pathname, 'index.html')]
    : [join(DIST, pathname), join(DIST, `${pathname}.html`), join(DIST, pathname, 'index.html')];
  for (const c of candidates) {
    // Refuse anything that escapes dist/.
    if (!normalize(c).startsWith(DIST)) continue;
    try {
      const s = await stat(c);
      if (s.isFile()) return c;
    } catch { /* next candidate */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const base = headersFor(pathname);

  for (const r of redirects) {
    if (r.re.test(pathname)) {
      res.writeHead(r.permanent ? 308 : 307, { ...base, Location: r.dest });
      return res.end();
    }
  }

  // Real files win over rewrites.
  let file = await tryFile(pathname);

  if (!file) {
    for (const r of rewrites) {
      if (r.re.test(pathname)) {
        file = await tryFile(r.dest);
        break;
      }
    }
  }

  if (!file) {
    // A REAL 404 — not the app shell with status 200.
    const notFound = await tryFile('/404.html');
    const body = notFound ? await readFile(notFound) : 'Not found';
    res.writeHead(404, { ...base, 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(body);
  }

  const body = await readFile(file);
  res.writeHead(200, { ...base, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  return res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving dist/ with vercel.json semantics on http://127.0.0.1:${PORT}`);
});
