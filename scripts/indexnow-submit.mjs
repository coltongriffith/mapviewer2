#!/usr/bin/env node
// Tell IndexNow (Bing, Yandex, Seznam, Naver and the other participating
// engines) about new and changed pages after a production deploy.
//
//   node scripts/indexnow-submit.mjs                 # changed since HEAD^
//   node scripts/indexnow-submit.mjs --since <sha>   # changed since a commit
//   node scripts/indexnow-submit.mjs --all           # every sitemap URL
//   node scripts/indexnow-submit.mjs --dry-run       # print, do not POST
//   node scripts/indexnow-submit.mjs --no-wait       # skip the deploy check
//
// "Changed" means a <loc> that is new in the committed sitemap, or whose
// <lastmod> differs from the sitemap at the base commit. The sitemaps are
// generated (scripts/generate-blog.js, scripts/pseo/07_generate_pages.mjs) and
// committed, so the diff between two commits is exactly what changed.
//
// Before submitting, it waits until the live sitemap carries those same
// entries, which means the Vercel production deployment of this commit is
// serving, and then drops any URL that does not answer 200. Submitting before
// the deploy would send crawlers to the old page or a 404.
//
// Google does not use IndexNow and no longer accepts sitemap pings; submit
// sitemap.xml in Search Console instead.
//
// Never fatal: every problem is a warning (a GitHub Actions ::warning:: when
// run in Actions) and the exit code is 0, unless --strict is passed.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'www.explorationmaps.com';
const SITE = `https://${HOST}`;
const KEY = '6d5bb92fcd17d7914e6fd6a69b364a1f';
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const SITEMAPS = ['public/sitemap.xml', 'public/sitemap-companies.xml'];
const MAX_URLS = 10_000; // IndexNow's limit per request

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const ALL = flag('--all');
const DRY = flag('--dry-run');
const STRICT = flag('--strict');
const WAIT = !flag('--no-wait');
const SINCE = option('--since', process.env.INDEXNOW_SINCE || 'HEAD^');
const WAIT_MINUTES = Number(option('--wait-minutes', process.env.INDEXNOW_WAIT_MINUTES || 20));
const POLL_SECONDS = Number(option('--poll-seconds', 20));
const IN_ACTIONS = Boolean(process.env.GITHUB_ACTIONS);

let warnings = 0;
function warn(message) {
  warnings += 1;
  console.log(IN_ACTIONS ? `::warning title=IndexNow::${message}` : `warning: ${message}`);
}
function done(code = 0) {
  process.exit(STRICT && warnings ? 1 : code);
}

// <url><loc>…</loc><lastmod>…</lastmod></url> → Map(loc → lastmod|'')
function parseSitemap(xml) {
  const out = new Map();
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1]?.trim();
    if (!loc) continue;
    out.set(loc.replaceAll('&amp;', '&'), /<lastmod>([^<]+)<\/lastmod>/.exec(body)?.[1]?.trim() || '');
  }
  return out;
}

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeoutMs = 20_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // A cache-busting query keeps an edge cache from answering with the old file.
    const bust = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${bust}indexnow=${Date.now()}`, { signal: ctrl.signal, redirect: 'manual', headers: { 'user-agent': 'explorationmaps-indexnow/1.0' } });
    return { status: res.status, text: res.status === 200 ? await res.text() : '' };
  } catch (err) {
    return { status: 0, text: '', error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// 1. What changed?
const changed = new Map(); // loc -> lastmod, from the local (committed) sitemaps
for (const file of SITEMAPS) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) continue;
  const now = parseSitemap(readFileSync(abs, 'utf8'));
  if (ALL) { for (const [loc, mod] of now) changed.set(loc, mod); continue; }
  const before = gitShow(SINCE, file);
  if (before === null) {
    // No base to diff against (shallow clone, first commit, new file). Fall
    // back to entries revised in the last week rather than the whole site.
    warn(`Could not read ${file} at ${SINCE}; submitting only entries with a lastmod in the last 7 days.`);
    const cutoff = Date.now() - 7 * 86_400_000;
    for (const [loc, mod] of now) if (mod && Date.parse(mod) >= cutoff) changed.set(loc, mod);
    continue;
  }
  const old = parseSitemap(before);
  for (const [loc, mod] of now) if (!old.has(loc) || old.get(loc) !== mod) changed.set(loc, mod);
}

const urls = [...changed.keys()].filter((u) => {
  try { return new URL(u).host === HOST; } catch { return false; }
});
if (!urls.length) {
  console.log(`IndexNow: no new or changed sitemap URLs${ALL ? '' : ` since ${SINCE}`}; nothing to submit.`);
  done();
}
console.log(`IndexNow: ${urls.length} new or changed URL(s):\n  ${urls.join('\n  ')}`);

// 2. Wait until production serves this commit's sitemap entries.
if (WAIT && !DRY) {
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  let live = false;
  while (Date.now() < deadline) {
    const maps = await Promise.all(SITEMAPS.filter((f) => existsSync(join(ROOT, f)))
      .map((f) => get(`${SITE}/${f.replace(/^public\//, '')}`)));
    const remote = new Map(maps.flatMap((m) => [...parseSitemap(m.text)]));
    const missing = urls.filter((u) => !remote.has(u) || remote.get(u) !== changed.get(u));
    if (!missing.length) { live = true; break; }
    console.log(`  waiting for the production deploy: ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} not live yet`);
    await sleep(POLL_SECONDS * 1000);
  }
  if (!live) {
    warn(`The live sitemap did not show this commit's entries within ${WAIT_MINUTES} min (deploy slow or failed?). Nothing submitted; rerun the workflow once the deploy is live.`);
    done();
  }
  const key = await get(KEY_LOCATION);
  if (key.status !== 200 || key.text.trim() !== KEY) {
    warn(`Key file ${KEY_LOCATION} is not being served (HTTP ${key.status}); IndexNow would reject the submission. Nothing submitted.`);
    done();
  }
}

// 3. Only submit pages that actually answer 200 (no redirects, no 404s).
let submit = urls;
if (!DRY) {
  const checks = await Promise.all(urls.map(async (u) => [u, (await get(u)).status]));
  for (const [u, status] of checks) if (status !== 200) warn(`${u} returned HTTP ${status}; left out.`);
  submit = checks.filter(([, s]) => s === 200).map(([u]) => u);
}
if (!submit.length) { warn('No URL answered 200; nothing submitted.'); done(); }

// 4. Submit.
const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: submit.slice(0, MAX_URLS) };
if (submit.length > MAX_URLS) warn(`${submit.length} URLs; only the first ${MAX_URLS} were submitted.`);
if (DRY) {
  console.log(`Dry run, would POST to ${ENDPOINT}:\n${JSON.stringify(body, null, 2)}`);
  done();
}
try {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  // 200 OK and 202 Accepted are both success (202: key validation pending).
  if (res.status === 200 || res.status === 202) console.log(`IndexNow: submitted ${body.urlList.length} URL(s), HTTP ${res.status}.`);
  else warn(`IndexNow answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
} catch (err) {
  warn(`IndexNow request failed: ${err.message}`);
}
done();
