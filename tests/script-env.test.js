import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { credential, supabaseCredentials } from '../scripts/lib/env.mjs';

// The first production sync failed like this:
//
//   [tenure-sync] failed: Could not read the last successful run:
//   TypeError: Headers.set: "***
//   ***" is an invalid header value.
//
// SUPABASE_SERVICE_ROLE_KEY had been saved with a newline in it. supabase-js
// puts the key in an Authorization header, headers cannot contain line breaks,
// and the error surfaced several frames from anything that named the cause.
// GitHub masks each LINE of a secret separately, which is the only reason the
// two `***` on separate lines gave it away at all.
//
// Discover mode passed the same day because it returns before building a
// Supabase client — so the misconfiguration was invisible until the first run
// that actually touched the database.

const KEY = 'SUPABASE_SERVICE_ROLE_KEY';
const URL_ = 'SUPABASE_URL';
const saved = {};

beforeEach(() => {
  for (const k of [KEY, URL_, 'VITE_SUPABASE_URL', 'TEST_CRED']) saved[k] = process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('credential', () => {
  it('strips the trailing newline that broke the first sync', () => {
    process.env.TEST_CRED = 'eyJhbGciOiJIUzI1NiJ9.payload.sig\n';
    expect(credential('TEST_CRED')).toBe('eyJhbGciOiJIUzI1NiJ9.payload.sig');
  });

  it('strips surrounding whitespace of every shape', () => {
    process.env.TEST_CRED = '  \t key \r\n ';
    expect(credential('TEST_CRED')).toBe('key');
  });

  it('names the variable when a line break sits INSIDE the value', () => {
    // Trimming cannot repair this one — it is a value pasted with a hard wrap.
    // The old failure mode was a TypeError from library internals quoting the
    // masked secret back at you; this one says which variable and what to do.
    process.env.TEST_CRED = 'eyJhbGciOiJI\nUzI1NiJ9.payload.sig';
    expect(() => credential('TEST_CRED')).toThrow(/TEST_CRED contains a line break/);
    expect(() => credential('TEST_CRED')).toThrow(/single unbroken line/);
  });

  it('rejects other control characters too', () => {
    process.env.TEST_CRED = 'abc\u0007def';
    expect(() => credential('TEST_CRED')).toThrow(/line break or control character/);
  });

  it('returns null for an unset optional credential', () => {
    delete process.env.TEST_CRED;
    expect(credential('TEST_CRED')).toBeNull();
  });

  it('treats whitespace-only as unset rather than as a value', () => {
    // A secret field submitted with a stray space is not a configured secret,
    // and " " reaching an Authorization header is its own confusing failure.
    process.env.TEST_CRED = '   ';
    expect(credential('TEST_CRED')).toBeNull();
  });

  it('explains where a required credential comes from', () => {
    delete process.env.TEST_CRED;
    expect(() => credential('TEST_CRED', { required: true }))
      .toThrow(/Secrets and variables/);
  });

  it('falls through to a fallback name only when the first is empty', () => {
    process.env.TEST_CRED = '';
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    expect(credential('TEST_CRED', { fallbacks: ['VITE_SUPABASE_URL'] }))
      .toBe('https://x.supabase.co');
  });
});

describe('supabaseCredentials', () => {
  it('survives the exact shape that failed in production', () => {
    process.env[URL_] = 'https://ibuzjzoqnkwjfecftzxn.supabase.co\n';
    process.env[KEY] = 'eyJhbGciOiJIUzI1NiJ9.payload.sig\n';
    expect(supabaseCredentials()).toEqual({
      url: 'https://ibuzjzoqnkwjfecftzxn.supabase.co',
      key: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
    });
  });

  it('drops a trailing slash on the URL', () => {
    process.env[URL_] = 'https://x.supabase.co/';
    process.env[KEY] = 'k';
    expect(supabaseCredentials().url).toBe('https://x.supabase.co');
  });

  it('fails by name when the key is missing entirely', () => {
    process.env[URL_] = 'https://x.supabase.co';
    delete process.env[KEY];
    expect(() => supabaseCredentials()).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
  });

  it('produces a value that is legal in an HTTP header', () => {
    // The property the original failure violated, asserted directly against the
    // platform rather than against our own regex.
    process.env[URL_] = 'https://x.supabase.co';
    process.env[KEY] = 'eyJhbGciOiJIUzI1NiJ9.payload.sig\n';
    const { key } = supabaseCredentials();
    expect(() => new Headers({ Authorization: `Bearer ${key}` })).not.toThrow();
  });
});
