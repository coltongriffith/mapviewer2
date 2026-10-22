import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The homepage's new figures (src/components/LandingNew.jsx) and the teams page (teams/index.html): every image the
// pages name exists in public/, stays under 200 kB, and carries alt text and its width and height.
const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pub = (src) => join(ROOT, 'public', src);
const KB = 1024;

describe('marketing images', () => {
  it('the homepage figures exist as 1x and 2x WebP and a JPG fallback, each under 200 kB', () => {
    const src = read('src/components/LandingNew.jsx');
    const items = [...src.matchAll(/img: '([\w-]+)', w: (\d+), h: (\d+), w2: (\d+),\s*alt: '([^']+)'/g)];
    expect(items.map((m) => m[1])).toEqual(['3d-block-section', 'studio-fig2', '3d-crew-hello']);
    for (const [, name, , , , alt] of items) {
      expect(alt.length).toBeGreaterThan(40);
      for (const f of [`${name}.webp`, `${name}@2x.webp`, `${name}.jpg`]) {
        expect(existsSync(pub(`/gallery/${f}`)), f).toBe(true);
        expect(statSync(pub(`/gallery/${f}`)).size, f).toBeLessThanOrEqual(200 * KB);
      }
    }
    expect(src).toContain('loading="lazy"');
  });

  it('every image on the teams page exists, has alt text and reserved dimensions', () => {
    const html = read('teams/index.html');
    const tags = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(10);
    for (const tag of tags) {
      const src = /\bsrc="([^"]+)"/.exec(tag)[1];
      expect(existsSync(pub(src)), src).toBe(true);
      expect(tag, src).toMatch(/\balt="[^"]{10,}"/);
      expect(tag, src).toMatch(/\bwidth="\d+"/);
      expect(tag, src).toMatch(/\bheight="\d+"/);
      for (const [, s] of (/\bsrcset="([^"]+)"/.exec(tag)?.[1] || '').matchAll(/(\S+) \d+w/g)) expect(existsSync(pub(s)), s).toBe(true);
    }
    // The new figures are on the page: workspace, block section, Studio and the crew.
    for (const name of ['3d-block-section', 'studio-fig2', '3d-drill-crew-claims', '3d-crew-hello']) expect(html).toContain(`/gallery/${name}.webp`);
    expect(html).toContain('id="workspace"');
  });

  it('the homepage structured data names the new features', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read('index.html'))[1]);
    const app = ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
    expect(app.featureList).toEqual(expect.arrayContaining(['3D drill hole figures and block sections', 'Company workspace for properties, maps, 3D figures and data']));
  });
});
