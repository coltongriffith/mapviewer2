import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const started = Date.now();
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
const bucketConfig = 'playwright.ci-anonymous.config.js';
const env = { ...process.env, CI: '1' };
delete env.E2E_ADMIN;
delete env.E2E_ANONYMOUS_BUCKET;

function invoke(config, bucket) {
  const result = spawnSync(process.execPath, [cli, 'test', '--config', config, '--list', '--reporter=json'], {
    cwd: root, env: { ...env, ...(bucket === undefined ? {} : { E2E_ANONYMOUS_BUCKET: bucket }) },
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
  });
  if (result.error) throw result.error;
  return result;
}

function discover(config, bucket) {
  const result = invoke(config, bucket);
  assert.equal(result.status, 0, `Discovery failed (${config}, bucket ${bucket}): ${result.stderr}\n${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errors.length, 0, 'Discovery reported errors');
  const entries = new Map();
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          const id = JSON.stringify([spec.id, test.projectId]);
          assert(!entries.has(id), `Duplicate discovered test: ${id}`);
          entries.set(id, { file: spec.file, status: test.expectedStatus });
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  assert(entries.size > 0, 'Discovery must not silently return an empty suite');
  return entries;
}

const original = discover('playwright.config.js');
for (const bucket of [undefined, '4']) {
  const result = invoke(bucketConfig, bucket);
  assert.notEqual(result.status, 0, `Invalid bucket ${JSON.stringify(bucket)} succeeded`);
  assert.match(result.stderr + result.stdout, /E2E_ANONYMOUS_BUCKET must be exactly 1, 2, or 3/);
}

// An exclusive, unique future file exercises both active and static-skip IDs.
// It is only listed, never executed, and is removed even if verification fails.
const futureName = `ci-bucket-future-${randomUUID()}.spec.js`;
const futurePath = join(root, 'e2e', futureName);
writeFileSync(futurePath, "import { test } from '@playwright/test';\ntest('future active', () => {});\ntest.skip('future skipped', () => {});\n", { flag: 'wx' });
try {
  const full = discover('playwright.config.js');
  const future = [...full].filter(([, value]) => value.file === futureName);
  assert.equal(future.length, 2, 'Synthetic future file must be discovered by the original config');
  assert.deepEqual(new Set(future.map(([, value]) => value.status)), new Set(['passed', 'skipped']));
  assert.deepEqual(new Map([...full].filter(([id]) => !future.some(([key]) => key === id))), original);
  const union = new Map();
  for (const bucket of ['1', '2', '3']) {
    const part = discover(bucketConfig, bucket);
    for (const [id, value] of part) {
      assert(!union.has(id), `Test appears in multiple buckets: ${id}`);
      assert.deepEqual(value, full.get(id), `Unexpected test or changed status: ${id}`);
      union.set(id, value);
    }
    for (const [id] of future) assert.equal(part.has(id), bucket === '1', 'Future tests belong only to the remainder');
    const skipped = [...part.values()].filter((value) => value.status === 'skipped').length;
    console.log(`Bucket ${bucket}: ${part.size} IDs (${skipped} static skips, including future fixture where applicable)`);
  }
  assert.deepEqual(union, full, 'Bucket union must exactly equal original discovery');
  console.log(`Verified ${original.size} existing IDs plus 2 future IDs; no omissions, extras, duplicates, or changed statuses. Invalid buckets fail.`);
} finally {
  unlinkSync(futurePath);
}
console.log(`Discovery verification completed in ${((Date.now() - started) / 1000).toFixed(1)}s (no browsers or builds).`);
