import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Can Node actually load the modules Node actually runs?
//
// THE GAP THIS CLOSES. Vite and Vitest complete extensionless relative
// specifiers; Node's ESM resolver does not, and package.json sets
// type: "module". So a `from './tenureDisclaimer'` inside a src/utils module
// imported by a cron script passes the entire unit suite and then fails at
// runtime with ERR_MODULE_NOT_FOUND — which is exactly what happened when
// tenureKind.js was added and silently broke the alert job's ability to load
// its email templates.
//
// No test running under Vitest can catch that, because the resolver that
// papers over the bug is the one running the test. So this shells out to a
// real `node` and asks it to import each module the jobs import.
//
// Everything is spawned in ONE node process rather than one per module: 13
// spawns cost about a second each, and a test people are tempted to skip is a
// test that stops running.

const SCRIPT_DIRS = ['scripts/tenure-alerts', 'scripts/tenure-sync'];

// run.mjs modules call main() at import and would start a real job, so they
// are checked by parsing rather than by executing. Everything else is safe to
// import: the remaining modules are pure or export-only.
const RUNS_ON_IMPORT = new Set(['run.mjs']);

function scriptModules() {
  const out = [];
  for (const dir of SCRIPT_DIRS) {
    for (const f of readdirSync(join(process.cwd(), dir))) {
      if (f.endsWith('.mjs') && !RUNS_ON_IMPORT.has(f)) out.push(`./${dir}/${f}`);
    }
  }
  return out;
}

describe('the cron jobs resolve under Node, not just under Vite', () => {
  it('imports every script module in a real node process', () => {
    const modules = scriptModules();
    expect(modules.length).toBeGreaterThan(5);

    const program = `${modules.map((m) => `await import(${JSON.stringify(m)});`).join('\n')}
console.log('ok');`;

    let output;
    try {
      output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
    } catch (e) {
      // Surface Node's own message — ERR_MODULE_NOT_FOUND names the offending
      // specifier and the file that imported it, which is the whole diagnosis.
      throw new Error(`node could not load the tenure job modules:\n${e.stderr || e.message}`);
    }
    expect(output.trim()).toBe('ok');
  }, 60_000);

  it('parses the entry points that run on import', () => {
    // These cannot be imported without starting a job, so they get a syntax
    // and top-level-resolution check instead of an execution one.
    for (const entry of ['scripts/tenure-alerts/run.mjs', 'scripts/tenure-sync/run.mjs']) {
      expect(() => execFileSync(process.execPath, ['--check', entry], {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      })).not.toThrow();
    }
  });
});
