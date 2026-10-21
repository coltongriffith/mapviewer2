import { describe, expect, it } from 'vitest';
import { friendlySearchError, NETWORK_ERROR } from '../src/hooks/useClaims.js';

// "Failed to fetch" reached error_events from a claim search with nothing a reader could act on. A
// dropped connection now reads as one, with Try again beside it (RegistrySearch.jsx).
describe('friendlySearchError', () => {
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])('says a dropped connection (%s) plainly', (message) => {
    expect(friendlySearchError(new TypeError(message))).toBe(NETWORK_ERROR);
  });

  it('keeps what the registry said', () => {
    expect(friendlySearchError(new Error('Registry timeout: try again'))).toBe('Registry timeout: try again');
    expect(friendlySearchError(new Error('x'.repeat(300)))).toHaveLength(200);
    expect(friendlySearchError(null)).toBe('Search failed');
  });
});
