import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

// The content library's shape, enforced.
//
// This suite exists because the previous structure decayed silently. 56 of the
// 86 blog URLs were geographic permutations of two templates, the index
// advertised "86 guides published" by counting hub pages and itself alongside
// real articles, and sitemap-companies.xml held 35 URLs that robots.txt never
// referenced. None of that was visible from the code — you had to go and count.
//
// Everything here reads the GENERATED output, because generated output is what
// a crawler sees. It runs the generator first so the assertions can never pass
// against a stale public/ directory.

const SITE = 'https://www.explorationmaps.com';
const ROOT = process.cwd();

let pages;        // url -> html
let sitemapUrls;  // Set of paths
let redirects;    // vercel.json redirect list

function pagePaths() {
  return globSync('public/**/index.html', { cwd: ROOT })
    .map(f => '/' + f.slice('public/'.length, -'index.html'.length));
}

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/generate-blog.js'], { cwd: ROOT, stdio: 'pipe' });
  pages = new Map(pagePaths().map(p => [p, readFileSync(join(ROOT, 'public', p, 'index.html'), 'utf8')]));
  const sitemap = readFileSync(join(ROOT, 'public', 'sitemap.xml'), 'utf8');
  sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1].replace(SITE, '')));
  redirects = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).redirects || [];
}, 120_000);

const blogPages = () => [...pages.keys()].filter(p => p.startsWith('/blog/') && p !== '/blog/');

describe('the mass-generated region families are gone', () => {
  it('generates no [map type] — [region] pages', () => {
    const region = blogPages().filter(p =>
      /^\/blog\/(drill-results-map|mining-claims-map|location-map|target-generation-map|infrastructure-map)-/.test(p));
    expect(region).toEqual([]);
  });

  it('keeps them out of the sitemap', () => {
    const leaked = [...sitemapUrls].filter(u => /-(british-columbia|nevada|ontario|ghana|chile|peru)\/$/.test(u));
    expect(leaked).toEqual([]);
  });

  it('has no locations hub or its source data', () => {
    expect(pages.has('/blog/locations/')).toBe(false);
    expect(existsSync(join(ROOT, 'scripts/blog-data/locations.json'))).toBe(false);
  });
});

describe('retired URLs redirect somewhere specific', () => {
  const RETIRED_FAMILIES = [
    '/blog/drill-results-map-nevada',
    '/blog/drill-results-map-british-columbia',
    '/blog/mining-claims-map-ghana',
    '/blog/mining-claims-map-british-columbia',
    '/blog/mining-claims-map-ontario',
    '/blog/how-to-export-mining-map-pdf',
    '/blog/how-to-add-scale-bar-north-arrow',
    '/blog/what-to-include-on-a-mining-claim-map',
    '/blog/map-drill-results-for-junior-mining-news-release',
    '/blog/locations',
    '/mining-exploration-map-software',
  ];

  // Mirrors Vercel's first-match-wins ordering, so the assertions below reflect
  // what a request would actually receive rather than what any rule could match.
  const resolve = (path) => {
    for (const r of redirects) {
      const pattern = '^' + r.source
        .replace(/\{\/\}\?$/, '/?')
        .replace(/:[A-Za-z]+/g, '[^/]+') + '$';
      if (new RegExp(pattern).test(path)) return r;
    }
    return null;
  };

  it.each(RETIRED_FAMILIES)('%s has a permanent redirect', (path) => {
    const hit = resolve(path);
    expect(hit, `no redirect matches ${path}`).toBeTruthy();
    expect(hit.permanent).toBe(true);
  });

  it('never dumps a retired page on the blog index', () => {
    // A blanket redirect to /blog/ is a 404 with a nicer status code. The one
    // exception is the locations hub, whose replacement genuinely is the index.
    for (const path of RETIRED_FAMILIES) {
      const hit = resolve(path);
      if (path === '/blog/locations') continue;
      expect(hit.destination, `${path} was swept to the blog index`).not.toBe('/blog/');
    }
  });

  it('sends the supported jurisdictions to their own guide, not the generic one', () => {
    // The seven jurisdictions with real claim-search support each have a better
    // destination than "how to make a mining claims map". Getting this wrong is
    // invisible — the redirect still works, it just wastes the intent.
    expect(resolve('/blog/mining-claims-map-british-columbia').destination).toBe('/bc-mineral-claims-map/');
    expect(resolve('/blog/mining-claims-map-ontario').destination).toBe('/blog/how-to-search-ontario-mining-claims/');
    expect(resolve('/blog/mining-claims-map-quebec').destination).toBe('/blog/how-to-search-quebec-mining-claims/');
    // ...and an unsupported one falls through to the generic guide.
    expect(resolve('/blog/mining-claims-map-ghana').destination).toBe('/blog/how-to-make-a-mining-claims-map/');
  });

  it('points every redirect at a page that exists — no chains, no dead ends', () => {
    for (const r of redirects) {
      const dest = r.destination;
      expect(pages.has(dest), `${r.source} -> ${dest}, which is not a generated page`).toBe(true);
      const onward = resolve(dest.replace(/\/$/, ''));
      expect(onward, `${r.source} -> ${dest} -> ${onward?.destination}: redirect chain`).toBeNull();
    }
  });
});

describe('nothing links to a page that no longer exists', () => {
  it('has no internal link into a retired URL', () => {
    const offenders = [];
    for (const [path, html] of pages) {
      for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
        const href = m[1].endsWith('/') ? m[1] : `${m[1]}/`;
        for (const r of redirects) {
          const pattern = '^' + r.source.replace(/\{\/\}\?$/, '/?').replace(/:[A-Za-z]+/g, '[^/]+') + '$';
          if (new RegExp(pattern).test(href.replace(/\/$/, ''))) {
            offenders.push(`${path} -> ${m[1]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('sitemap and canonicals agree with what exists', () => {
  it('lists every generated page and nothing else', () => {
    // Only content pages. The SPA routes are rewrites, not files, and the
    // companies family has its own sitemap.
    const content = [...pages.keys()].filter(p => !p.startsWith('/companies'));
    for (const p of content) {
      if (['/privacy/', '/terms/', '/refunds/', '/about/', '/contact/'].includes(p)) continue;
      expect(sitemapUrls.has(p), `${p} exists but is not in the sitemap`).toBe(true);
    }
    for (const u of sitemapUrls) {
      if (['/', '/about/', '/contact/'].includes(u)) continue;
      expect(pages.has(u), `${u} is in the sitemap but generates no page`).toBe(true);
    }
  });

  it('gives every page a self-referential canonical', () => {
    for (const [path, html] of pages) {
      const c = /<link rel="canonical" href="([^"]+)"/.exec(html);
      expect(c, `${path} has no canonical`).toBeTruthy();
      expect(c[1]).toBe(`${SITE}${path}`);
    }
  });

  it('declares both sitemaps in robots.txt', () => {
    // sitemap-companies.xml held 35 real per-issuer claim maps that robots.txt
    // never mentioned, and nothing links to them except the landing page.
    const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap-companies.xml`);
  });

  it('has not noindexed anything that should rank', () => {
    for (const [path, html] of pages) {
      if (['/privacy/', '/terms/', '/refunds/'].includes(path)) continue;
      expect(html.includes('noindex'), `${path} carries noindex`).toBe(false);
    }
  });
});

describe('titles and headings are distinct', () => {
  it('gives no two pages the same title', () => {
    const byTitle = new Map();
    for (const [path, html] of pages) {
      const t = /<title>(.*?)<\/title>/s.exec(html)?.[1].trim();
      expect(t, `${path} has no title`).toBeTruthy();
      byTitle.set(t, [...(byTitle.get(t) || []), path]);
    }
    const dupes = [...byTitle.entries()].filter(([, v]) => v.length > 1);
    expect(dupes).toEqual([]);
  });

  it('gives every page exactly one h1', () => {
    for (const [path, html] of pages) {
      const count = (html.match(/<h1[\s>]/g) || []).length;
      expect(count, `${path} has ${count} h1 elements`).toBe(1);
    }
  });

  it('gives every page a meta description', () => {
    for (const [path, html] of pages) {
      const d = /<meta name="description" content="([^"]*)"/.exec(html);
      expect(d?.[1], `${path} has no meta description`).toBeTruthy();
    }
  });
});

describe('the blog index tells the truth about itself', () => {
  it('counts articles, not hub pages', () => {
    const html = pages.get('/blog/');
    const claimed = Number(/(\d+) guides/.exec(html)?.[1]);
    const actual = blogPages().filter(p => !['/blog/how-to/', '/blog/comparisons/'].includes(p)).length;
    expect(claimed).toBe(actual);
  });

  it('links to every article it counts', () => {
    const html = pages.get('/blog/');
    for (const p of blogPages()) {
      if (['/blog/how-to/', '/blog/comparisons/'].includes(p)) continue;
      expect(html.includes(`href="${p}"`), `${p} is not linked from the blog index`).toBe(true);
    }
  });
});

describe('structured data', () => {
  it('emits no FAQPage markup', () => {
    // Removed deliberately: Google restricted FAQ rich results to authoritative
    // government and health sites in August 2023, so on a commercial site the
    // markup earns nothing and is a second copy of the visible content to keep
    // in sync. The visible FAQ blocks remain.
    for (const [path, html] of pages) {
      expect(html.includes('"FAQPage"'), `${path} emits FAQPage markup`).toBe(false);
    }
  });

  it('gives every article a BreadcrumbList and an Article type', () => {
    for (const p of blogPages()) {
      if (['/blog/how-to/', '/blog/comparisons/'].includes(p)) continue;
      const html = pages.get(p);
      expect(html.includes('"BreadcrumbList"'), `${p} has no breadcrumb markup`).toBe(true);
      expect(/"@type":\s*"(Article|BlogPosting|TechArticle)"/.test(html), `${p} has no Article markup`).toBe(true);
    }
  });

  it('parses as valid JSON-LD everywhere', () => {
    for (const [path, html] of pages) {
      for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
        expect(() => JSON.parse(m[1]), `${path} has unparseable JSON-LD`).not.toThrow();
      }
    }
  });
});

describe('the redirect table is fully generated', () => {
  // vercel.json's redirects used to be MERGED with whatever the file already
  // held, using a source comparison to guess which rules were hand-written.
  // A rule whose entry had been deleted from redirects.json was no longer in
  // the generated set, so it looked hand-written and survived forever —
  // meaning a restored page would be added to the sitemap while Vercel kept
  // redirecting visitors away from it. assertNoRetiredCollisions could not
  // catch it either, because it reads redirects.json rather than the config.
  it('contains exactly what redirects.json describes, and nothing else', () => {
    const map = JSON.parse(readFileSync(join(ROOT, 'scripts/blog-data/redirects.json'), 'utf8'));
    const expected = new Set([
      ...Object.entries(map.exact)
        .filter(([k, v]) => !k.startsWith('_') && v)
        .map(([from]) => `${from}{/}?`),
      ...map.patterns.map(p => `${p.source}{/}?`),
    ]);
    const actual = new Set(redirects.map(r => r.source));
    expect([...actual].filter(s => !expected.has(s)),
      'vercel.json carries a redirect that redirects.json does not describe').toEqual([]);
    expect([...expected].filter(s => !actual.has(s)),
      'redirects.json describes a redirect that vercel.json does not carry').toEqual([]);
  });

  it('drops a rule when its entry is deleted from redirects.json', () => {
    // THE REGRESSION, exercised rather than asserted. The previous merge kept
    // any rule whose source was absent from the newly-generated set, which is
    // exactly what a deleted entry looks like — so removing an entry here left
    // the rule in vercel.json forever and a restored page would be live in the
    // sitemap while Vercel redirected visitors away from it.
    //
    // Comparing the two files after a normal run cannot catch this: the
    // generator rewrites vercel.json first, so they always agree. The only
    // honest test is to delete an entry, regenerate, and look.
    const mapPath = join(ROOT, 'scripts/blog-data/redirects.json');
    const cfgPath = join(ROOT, 'vercel.json');
    const mapBefore = readFileSync(mapPath, 'utf8');
    const cfgBefore = readFileSync(cfgPath, 'utf8');
    const VICTIM = '/blog/what-to-include-on-a-mining-claim-map';

    try {
      const map = JSON.parse(mapBefore);
      expect(map.exact[VICTIM], `${VICTIM} is not in redirects.json to begin with`).toBeTruthy();
      delete map.exact[VICTIM];
      writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
      execFileSync(process.execPath, ['scripts/generate-blog.js'], { cwd: ROOT, stdio: 'pipe' });

      const after = JSON.parse(readFileSync(cfgPath, 'utf8')).redirects;
      expect(after.some(r => r.source.startsWith(VICTIM)),
        'the rule survived its entry being deleted').toBe(false);
    } finally {
      writeFileSync(mapPath, mapBefore);
      writeFileSync(cfgPath, cfgBefore);
      execFileSync(process.execPath, ['scripts/generate-blog.js'], { cwd: ROOT, stdio: 'pipe' });
    }
  }, 60_000);

  it('keeps every rule in the source of truth, including the legacy ones', () => {
    // The five pre-existing rules were moved into redirects.json so there is
    // one place that decides what redirects exist. If they drift back out,
    // deleting them becomes impossible again.
    const map = JSON.parse(readFileSync(join(ROOT, 'scripts/blog-data/redirects.json'), 'utf8'));
    const all = JSON.stringify(map);
    for (const legacy of ['mineral-exploration-map-for-investor-deck',
      'turn-public-mineral-claim-data-into-project-map',
      'location-map-', 'target-generation-map-', 'infrastructure-map-']) {
      expect(all.includes(legacy), `${legacy} is not in redirects.json`).toBe(true);
    }
  });
});

describe('claims about jurisdiction support match the product', () => {
  // Read the product, not the copy. PROVINCES in RegistrySearch.jsx is what a
  // user actually gets, and any page promising more than it offers is sending
  // somebody to a workflow that does not exist.
  const provinces = () => {
    const src = readFileSync(join(ROOT, 'src/components/RegistrySearch.jsx'), 'utf8');
    const block = src.slice(src.indexOf('const PROVINCES = ['), src.indexOf('// U.S. federal (BLM MLRS)'));
    return [...block.matchAll(/value: '(\w+)', label: '([^']+)'[\s\S]*?modes: \[([^\]]*)\]/g)]
      .map(m => ({ value: m[1], label: m[2], modes: m[3] }));
  };

  it('does not advertise company search where the product offers none', () => {
    // Manitoba's public layer publishes no holder name, so RegistrySearch
    // gives it modes: ['number']. The company-search landing page advertised
    // "seven Canadian jurisdictions" in its meta description, which is the
    // snippet a Manitoba searcher would click.
    const withCompany = provinces().filter(p => p.modes.includes("'company'"));
    const withoutCompany = provinces().filter(p => !p.modes.includes("'company'"));
    expect(withCompany.length).toBe(6);
    expect(withoutCompany.map(p => p.label)).toEqual(['Manitoba']);

    const html = pages.get('/mining-claim-search-by-company-name/');
    const meta = /<meta name="description" content="([^"]*)"/.exec(html)[1];
    expect(/seven|all 7/i.test(meta),
      'the company-search snippet promises more jurisdictions than support company search').toBe(false);
    expect(meta).toMatch(/six/i);
    // And the page must name the exception where a reader will see it.
    expect(html).toMatch(/Manitoba/);
  });

  it('never promises tenure monitoring outside British Columbia', () => {
    // Tenure Monitor is BC-only. A table row or sentence promising it for
    // Ontario would be a support claim the application cannot honour.
    const hub = pages.get('/blog/canadian-mineral-claim-registries/');
    expect(hub).toBeTruthy();
    const rows = [...hub.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m => m[1]);
    for (const row of rows) {
      if (/British Columbia/.test(row)) continue;
      if (!/Ontario|Quebec|Saskatchewan|Manitoba|Newfoundland|Yukon/.test(row)) continue;
      expect(/Not yet/.test(row), `a non-BC row claims monitoring support: ${row}`).toBe(true);
    }
  });
});
