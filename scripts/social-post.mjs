/**
 * social-post.mjs
 *
 * Generates and publishes a post to Twitter/X and LinkedIn.
 * Picks a topic from post-topics.json based on the day of the year
 * so the rotation advances automatically each run.
 *
 * Required environment variables (set as GitHub Secrets):
 *   ANTHROPIC_API_KEY
 *   TWITTER_API_KEY, TWITTER_API_SECRET
 *   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
 *   LINKEDIN_ACCESS_TOKEN
 *   LINKEDIN_AUTHOR_URN  — e.g. "urn:li:person:XXXXXX" (personal) or
 *                          "urn:li:organization:XXXXXX" (company page)
 */

import { readFileSync } from 'fs';
import { createHmac } from 'crypto';
import { URL } from 'url';

const ANTHROPIC_API_KEY     = process.env.ANTHROPIC_API_KEY;
const TWITTER_API_KEY       = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET    = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN  = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_TOKEN_SECRET  = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const LINKEDIN_ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
const LINKEDIN_AUTHOR_URN   = process.env.LINKEDIN_AUTHOR_URN;

// ── Topic rotation ────────────────────────────────────────────────────────────

const topics = JSON.parse(readFileSync(new URL('./post-topics.json', import.meta.url)));
const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
const topic = topics[dayOfYear % topics.length];

console.log(`Topic: ${topic.id} (${topic.theme})`);

// ── Claude: generate Twitter + LinkedIn copy ──────────────────────────────────

async function generatePosts(topic) {
  const systemPrompt = `You are a social media writer for Exploration Maps (explorationmaps.com), a free browser-based tool for creating professional mining and exploration maps. The audience is Canadian junior mining companies, exploration geologists, investor relations teams, and qualified persons.

Voice: direct, knowledgeable, zero fluff. No corporate-speak. No exclamation marks. Speak like someone who has been in the field and knows the pain of bad maps before an investor call.`;

  const userPrompt = `Write two versions of a social media post using this topic brief:

HOOK: ${topic.hook}
DETAIL: ${topic.detail}
CTA: ${topic.cta}

VERSION 1 — Twitter/X:
- Max 240 characters (leave room for hashtags we'll add separately)
- Lead with the hook, compressed
- No hashtags, no emojis
- End with the CTA naturally woven in, or just the URL

VERSION 2 — LinkedIn:
- 120–200 words
- Open with a one-line hook (no "I" opener)
- 2–3 short paragraphs expanding on the detail
- Close with the CTA
- No hashtags in the body (we add them separately)
- No emojis

Respond with valid JSON only:
{
  "twitter": "...",
  "linkedin": "..."
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.content[0].text.trim();
  return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
}

// ── Twitter/X posting (OAuth 1.0a) ───────────────────────────────────────────

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sorted = Object.keys(params).sort().map(
    k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key  = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return createHmac('sha1', key).update(base).digest('base64');
}

async function postTweet(text) {
  const HASHTAGS = '#MiningMaps #JuniorMining #Exploration';
  const full = `${text}\n\n${HASHTAGS}`.slice(0, 280);

  const url    = 'https://api.twitter.com/2/tweets';
  const ts     = Math.floor(Date.now() / 1000).toString();
  const nonce  = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const oauthParams = {
    oauth_consumer_key:     TWITTER_API_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_token:            TWITTER_ACCESS_TOKEN,
    oauth_version:          '1.0',
  };

  const sig = oauthSign('POST', url, oauthParams, TWITTER_API_SECRET, TWITTER_TOKEN_SECRET);
  oauthParams.oauth_signature = sig;

  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort().map(
    k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`
  ).join(', ');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: full }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Twitter error: ${JSON.stringify(body)}`);
  console.log(`✓ Twitter posted: ${body.data.id}`);
  return body.data.id;
}

// ── LinkedIn posting (OAuth 2.0) ─────────────────────────────────────────────

async function postLinkedIn(text) {
  const HASHTAGS = '\n\n#MiningMaps #JuniorMining #ExplorationGeology #MineralExploration #CanadaMining';
  const full = text + HASHTAGS;

  const body = {
    author: LINKEDIN_AUTHOR_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: full },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn error: ${JSON.stringify(data)}`);
  console.log(`✓ LinkedIn posted: ${data.id}`);
  return data.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const missing = [
  ['ANTHROPIC_API_KEY', ANTHROPIC_API_KEY],
  ['TWITTER_API_KEY', TWITTER_API_KEY],
  ['TWITTER_API_SECRET', TWITTER_API_SECRET],
  ['TWITTER_ACCESS_TOKEN', TWITTER_ACCESS_TOKEN],
  ['TWITTER_ACCESS_TOKEN_SECRET', TWITTER_TOKEN_SECRET],
  ['LINKEDIN_ACCESS_TOKEN', LINKEDIN_ACCESS_TOKEN],
  ['LINKEDIN_AUTHOR_URN', LINKEDIN_AUTHOR_URN],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error(`Missing secrets: ${missing.join(', ')}`);
  process.exit(1);
}

try {
  console.log('Generating posts with Claude...');
  const { twitter, linkedin } = await generatePosts(topic);

  console.log('\n── Twitter ──');
  console.log(twitter);
  console.log('\n── LinkedIn ──');
  console.log(linkedin);
  console.log('');

  await postTweet(twitter);
  await postLinkedIn(linkedin);

  console.log('\n✓ All done');
} catch (err) {
  console.error(err);
  process.exit(1);
}
