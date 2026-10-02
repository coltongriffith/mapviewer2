import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Ahrefs Web Analytics only counts pages that carry its tag, and the CSP
// blocks it unless analytics.ahrefs.com is allowed. Every page the site
// serves, and the two generators that write pages, must carry it once.
const AHREFS_TAG = '<script src="https://analytics.ahrefs.com/analytics.js" data-key="Nj1JOEhHV5bRKYBBoUJVVg" async></script>';

function htmlFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

describe('Ahrefs Web Analytics', () => {
  const pages = ['index.html', ...htmlFiles('public')];

  it('is on every page exactly once, inside <head>', () => {
    expect(pages.length).toBeGreaterThan(50);
    for (const file of pages) {
      const html = readFileSync(file, 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      expect(html.split(AHREFS_TAG).length - 1, `${file} carries the tag once`).toBe(1);
      expect(head, `${file} has the tag in <head>`).toContain(AHREFS_TAG);
    }
  });

  it('is written by the page generators, so regenerated pages keep it', () => {
    for (const file of ['scripts/generate-blog.js', 'scripts/pseo/07_generate_pages.mjs']) {
      expect(readFileSync(file, 'utf8'), file).toContain(AHREFS_TAG);
    }
  });

  it('is allowed by the Content-Security-Policy, to load and to send events', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
    const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)).split(/\s+/);
    expect(directive('script-src')).toContain('https://analytics.ahrefs.com');
    expect(directive('connect-src')).toContain('https://analytics.ahrefs.com');
  });
});
