import '@testing-library/jest-dom/vitest';
import { expect, vi } from 'vitest';

// localStorage is provided by jsdom, but some tests simulate quota errors by
// swapping the implementation; keep a pristine reference for restoration.
globalThis.__realLocalStorage = globalThis.localStorage;

// The *-sql tests boot PGlite and run whole migrations in their hooks, which
// under a full parallel run can pass the 10 s default.
if (/-sql\.test\.js$/.test(expect.getState().testPath || '')) vi.setConfig({ hookTimeout: 60000, testTimeout: 60000 });
