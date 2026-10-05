import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Ahrefs Web Analytics only counts pages that carry its tag, and the CSP
// blocks it unless analytics.ahrefs.com is allowed. Every page the site
// serves, and the two generators that write pages, must carry it once.
const AHREFS_TAG = '<script src="https://analytics.ahrefs.com/analytics.js" data-key="Nj1JOEhHV5bRKYBBoUJVVg" async></script>';
// The app page holds back the automatic first pageview (see below).
const AHREFS_APP_TAG = '<script src="https://analytics.ahrefs.com/analytics.js" data-key="Nj1JOEhHV5bRKYBBoUJVVg" data-no-pageview-on-load async></script>';

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
      const tag = file === 'index.html' ? AHREFS_APP_TAG : AHREFS_TAG;
      expect(html.split('analytics.ahrefs.com/analytics.js').length - 1, `${file} carries the tag once`).toBe(1);
      expect(head, `${file} has the tag in <head>`).toContain(tag);
    }
  });

  it('sends the app\'s first pageview only for an address without one-time codes', async () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<script defer src="/ahrefs-pageview.js"></script>');
    const source = readFileSync('public/ahrefs-pageview.js', 'utf8');
    const sent = (url) => {
      window.history.replaceState({}, '', url);
      const sendEvent = vi.fn();
      window.AhrefsAnalytics = { sendEvent };
      new Function(source)();
      delete window.AhrefsAnalytics;
      return sendEvent.mock.calls.length > 0;
    };
    expect(sent('/')).toBe(true);
    expect(sent('/app?company=star%20copper&utm_source=linkedin')).toBe(true);
    expect(sent('/map/abc123?download=png')).toBe(true);
    // Stripe's checkout return, the connector consent page, sign-in links.
    expect(sent('/?billing=success&session_id=cs_live_abc')).toBe(false);
    expect(sent('/oauth/consent?authorization_id=diof6bw3skq5')).toBe(false);
    expect(sent('/#access_token=eyJ.x.y&refresh_token=r&type=magiclink')).toBe(false);
    expect(sent('/?code=pkce-code')).toBe(false);
    window.history.replaceState({}, '', '/');
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
