import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'public', 'blog-img');
const outputState = () => existsSync(output)
  ? readdirSync(output).sort().map((name) => [name, statSync(path.join(output, name)).mtimeMs])
  : null;

function checkRuntime(browserPath) {
  const env = { ...process.env };
  if (browserPath) env.PLAYWRIGHT_CHROMIUM_PATH = browserPath;
  else delete env.PLAYWRIGHT_CHROMIUM_PATH;
  return JSON.parse(execFileSync(process.execPath, ['scripts/capture-blog-shots.mjs', '--check-runtime'], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  }));
}

describe('blog capture runtime resolution', () => {
  it('resolves installed tools using the current Node without starting capture or writing assets', () => {
    const before = outputState();
    const runtime = checkRuntime();
    expect(runtime.previewCommand).toBe(process.execPath);
    expect(existsSync(runtime.previewArgs[0])).toBe(true);
    expect(runtime.previewArgs.slice(1)).toEqual(['preview', '--port', '4188', '--strictPort']);
    expect(runtime.launchOptions).toEqual({});
    expect(runtime.browserType).toBe('chromium');
    expect(outputState()).toEqual(before);
  });

  it('preserves the configured browser path, including Windows paths with spaces', () => {
    const browserPath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    expect(checkRuntime(browserPath).launchOptions).toEqual({ executablePath: browserPath });
  });
});
