import '@testing-library/jest-dom/vitest';

// localStorage is provided by jsdom, but some tests simulate quota errors by
// swapping the implementation; keep a pristine reference for restoration.
globalThis.__realLocalStorage = globalThis.localStorage;
