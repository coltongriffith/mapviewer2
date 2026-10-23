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

// Google Analytics 4 runs from public/gtag-init.js, beside the Google Ads config (one gtag.js serves both).
// GA4's pageview reports the page address, and some app addresses carry one-time codes: Stripe's checkout
// return (?session_id=), the connector consent page (?authorization_id=) and sign-in links (?code=,
// #access_token=). As public/ahrefs-pageview.js does for Ahrefs, those never leave the browser: on such an
// address the automatic pageview is off and one page_view is sent with the codes removed from the query and
// no fragment. It is per event, so later in-app pageviews (after the app clears the codes with replaceState)
// report their own address. The init file is served to every visitor, so it stays short.
describe('Google Analytics 4', () => {
  const pages = ['index.html', '3d/index.html', ...htmlFiles('public')];

  // Runs the init at an address; returns the GA4 config parameters and the address any pageview reports.
  const ga4 = (url) => {
    window.history.replaceState({}, '', url);
    window.dataLayer = [];
    new Function(readFileSync('public/gtag-init.js', 'utf8'))();
    const calls = window.dataLayer.map((args) => Array.from(args));
    delete window.dataLayer;
    window.history.replaceState({}, '', '/');
    expect(calls.some((c) => c[0] === 'config' && c[1] === 'AW-18358773663'), 'Google Ads config kept').toBe(true);
    const config = calls.find((c) => c[0] === 'config' && c[1] === 'G-6SR34P1CR7');
    expect(config, 'GA4 configured').toBeTruthy();
    const manual = calls.find((c) => c[0] === 'event' && c[1] === 'page_view');
    // Without parameters, GA4's own pageview reports the full current address.
    const reported = config[2]?.send_page_view === false ? manual?.[2]?.page_location : `${window.location.origin}${url}`;
    return { config: config[2], manual, reported };
  };

  it('is configured in the shared gtag init, beside Google Ads, with its own pageview', () => {
    const plain = ga4('/app?company=star%20copper&utm_source=linkedin');
    expect(plain.config).toBeUndefined();
    expect(plain.manual).toBeUndefined();
  });

  it('never sends one-time codes to Google Analytics', () => {
    const o = window.location.origin;
    const cases = [
      ['/?billing=success&session_id=cs_live_abc', `${o}/?billing=success`],
      ['/oauth/consent?authorization_id=diof6bw3skq5', `${o}/oauth/consent`],
      ['/#access_token=eyJ.x.y&refresh_token=r&type=magiclink', `${o}/`],
      ['/?code=pkce-code&utm_source=x', `${o}/?utm_source=x`],
      ['/?token_hash=abc&type=recovery', `${o}/?type=recovery`],
      ['/?%E0%A4%A=1&session_id=s', `${o}/?%E0%A4%A=1`],
    ];
    for (const [url, expected] of cases) {
      const r = ga4(url);
      expect(r.config, url).toEqual({ send_page_view: false });
      expect(r.manual[2], url).toEqual({ send_to: 'G-6SR34P1CR7', page_location: expected });
      expect(r.reported, url).not.toMatch(/session_id|authorization_id|code=|token/);
    }
  });

  it('runs on every page that loads gtag.js', () => {
    for (const file of pages) {
      const html = readFileSync(file, 'utf8');
      if (!html.includes('googletagmanager.com/gtag/js')) continue;
      expect(html, `${file} loads the gtag init`).toContain('/gtag-init.js');
    }
  });

  it('can send hits under the Content-Security-Policy', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    for (const csp of vercel.headers.flatMap((h) => h.headers).filter((h) => h.key === 'Content-Security-Policy').map((h) => h.value)) {
      const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src ')).split(/\s+/);
      expect(connect).toEqual(expect.arrayContaining(['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com']));
    }
  });
});
