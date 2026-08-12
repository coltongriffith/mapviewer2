import { test, expect } from '@playwright/test';

// A PageSpeed run scored the landing page 76, and one file explained most of
// it: /gallery/ba-after.png was 2,695 KiB — 78% of the whole 3,472 KiB page —
// and it was the LCP element, shipped at 1448px into an 870px box, as PNG,
// with no dimensions and no priority hint.
//
// These guard the delivery, not the score. A score moves for reasons outside
// this repo; "the hero is a right-sized WebP the browser can find early" is
// ours and is exactly what regresses when someone drops in a new screenshot.

test('the hero image is a right-sized WebP, not a multi-megabyte PNG', async ({ page }) => {
  const gallery = [];
  page.on('response', (r) => { if (/\/gallery\//.test(r.url())) gallery.push(r.url().split('/').pop()); });

  await page.goto('/', { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const hero = await page.evaluate(() => {
    const img = document.querySelector('.lm-mock-img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return {
      src: img.currentSrc.split('/').pop(),
      naturalW: img.naturalWidth,
      displayedW: Math.round(r.width),
      width: img.getAttribute('width'),
      height: img.getAttribute('height'),
      fetchPriority: img.getAttribute('fetchpriority'),
      loading: img.getAttribute('loading'),
    };
  });

  expect(hero, 'the hero image is gone').toBeTruthy();
  expect(hero.src, 'the browser did not choose the WebP').toMatch(/\.webp$/);
  expect(gallery.some((f) => f === 'ba-after.png'), 'the PNG fallback was downloaded as well').toBe(false);

  // Shipping twice the pixels it draws was 1,722 KiB of the waste. A little
  // headroom for 2x, but not 2x itself at 1x density.
  expect(hero.naturalW).toBeLessThanOrEqual(hero.displayedW * 1.5);

  // Dimensions reserve the space, so nothing below jumps when it lands — the
  // measured CLS culprit was the block directly beneath this image.
  expect(hero.width, 'no explicit width — the page will shift when it loads').toBeTruthy();
  expect(hero.height, 'no explicit height — the page will shift when it loads').toBeTruthy();

  // It is the LCP element: it must be prioritised and must never be lazy.
  expect(hero.fetchPriority).toBe('high');
  expect(hero.loading, 'the LCP element must not be lazy-loaded').not.toBe('lazy');
});

test('below-the-fold gallery images stay lazy and sized', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load', timeout: 60_000 });
  const shots = await page.evaluate(() => [...document.querySelectorAll('.lm-show-img img')].map((img) => ({
    lazy: img.getAttribute('loading'),
    width: img.getAttribute('width'),
  })));
  expect(shots.length).toBeGreaterThan(0);
  shots.forEach((s) => {
    expect(s.lazy, 'a below-the-fold screenshot is loading eagerly').toBe('lazy');
    expect(s.width, 'a screenshot has no reserved size').toBeTruthy();
  });
});

test('analytics config does not block the first paint', async ({ page }) => {
  // gtag-init.js was a plain <script> in <head>: 240 ms of blocked render and a
  // 72 ms long task, for code that only queues an analytics config.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const blocking = await page.evaluate(() => [...document.querySelectorAll('head script[src]')]
    // type="module" is deferred by definition, but its `defer` IDL property
    // still reads false — checking that alone reports the app bundle as
    // render-blocking when it is not.
    .filter((s) => s.type !== 'module' && !s.defer && !s.async)
    .map((s) => s.getAttribute('src')));
  expect(blocking, `render-blocking scripts in <head>: ${blocking.join(', ')}`).toEqual([]);
});
