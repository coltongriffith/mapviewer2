import base from './playwright.config.js';

// Measured on CI run 40431963159. Keep costly software-rendered exports
// distributed without changing test content, worker count, or retry policy.
const groups = {
  2: ['three-d-round5f.spec.js', 'three-d-export-options.spec.js', 'three-d-round5h.spec.js', 'three-d-annotations-svg.spec.js'],
  3: ['three-d-round5e.spec.js', 'three-d-round5g.spec.js', 'three-d-round5d.spec.js', 'three-d-usage.spec.js', 'three-d-figure-style.spec.js', 'three-d-share.spec.js'],
};
const bucket = process.env.E2E_ANONYMOUS_BUCKET;
if (!['1', '2', '3'].includes(bucket)) {
  throw new Error('E2E_ANONYMOUS_BUCKET must be exactly 1, 2, or 3');
}

const files = bucket === '1' ? Object.values(groups).flat() : groups[bucket];
const alternatives = files.map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const selected = `[\\\\/](${alternatives})$`;
// Bucket 1 is the remainder, so future files are included automatically.
// Exclusions compose with base ignores; its testMatch and projects stay intact.
const exclusion = new RegExp(bucket === '1' ? selected : `^(?!.*${selected}).*$`);
export default {
  ...base,
  testIgnore: [...(Array.isArray(base.testIgnore) ? base.testIgnore : base.testIgnore ? [base.testIgnore] : []), exclusion],
};
