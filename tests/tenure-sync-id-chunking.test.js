import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chunked } from '../scripts/tenure-sync/db.mjs';

// Bulk id lookups must not build a URL the edge will refuse.
//
// WHAT HAPPENED. loadOwnersFor() passed a whole BATCH_SIZE of tenure ids to a
// single PostgREST `.in()`. Those are UUIDs — 36 characters plus a separator —
// so 500 of them is an ~18 KB query string. The edge rejects the request
// before PostgREST sees it, so the failure arrives as `TypeError: fetch
// failed` with no status and no PostgREST message, which reads like a network
// blip rather than a request this code can never succeed at.
//
// It took the 2026-08-06 full sync down at records_processed = 0 and would
// have taken down every full sync after it.
//
// WHY IT HID. `existingIds` holds only tenures ALREADY in the mirror. On the
// first full run every record was new, the list was empty, and the function
// returned before issuing a request. The bug arrived the moment the run
// stopped being the first one — so "it worked yesterday" was true and
// meaningless.
//
// A behavioural test would need a live PostgREST to reject the URL, so this
// pins the property that actually matters — the size of what any bulk id
// query can send — and it reads the source, because the defect was a missing
// loop rather than a wrong value.

// Cloudflare and most edges cap the request line plus headers around 16 KB.
// 8 KB is the budget for the value list alone, leaving room for the base URL,
// the select list, the auth header and the rest.
const URL_BUDGET_BYTES = 8_192;
const UUID_WITH_SEPARATOR = 37; // 36 chars + one comma

function encodedSizeOf(count) {
  return count * UUID_WITH_SEPARATOR;
}

describe('bulk id lookups stay inside a servable URL', () => {
  it('demonstrates the size the unchunked version was sending', () => {
    // The regression, stated as arithmetic. BATCH_SIZE is 500.
    expect(encodedSizeOf(500)).toBeGreaterThan(URL_BUDGET_BYTES);
    expect(encodedSizeOf(500)).toBeGreaterThan(16_000);
  });

  it('keeps every chunk of the owner lookup inside the budget', () => {
    const ids = Array.from({ length: 5_000 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    for (const chunk of chunked(ids, 200)) {
      expect(encodedSizeOf(chunk.length)).toBeLessThan(URL_BUDGET_BYTES);
    }
  });

  it('chunks every .in() over a uuid list in the importer', () => {
    // Source-read rather than behavioural: the defect was an absent loop, and
    // the only way to catch the NEXT one is to notice a bare `.in()` that no
    // chunk feeds. Each `.in(` must be handed a variable named `chunk`.
    for (const file of ['scripts/tenure-sync/run.mjs', 'scripts/tenure-sync/db.mjs']) {
      const src = readFileSync(file, 'utf8');
      const calls = [...src.matchAll(/\.in\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const [, column, argument] of calls) {
        expect(
          argument,
          `${file}: .in('${column}', ${argument}) is not fed by a chunk — a full `
          + 'batch of UUIDs here builds a URL the edge refuses',
        ).toBe('chunk');
      }
    }
  });

  it('chunks the owner lookup no larger than the prune that mirrors it', () => {
    const src = readFileSync('scripts/tenure-sync/run.mjs', 'utf8');
    const size = Number(/OWNER_LOOKUP_CHUNK\s*=\s*(\d+)/.exec(src)?.[1]);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(200);
  });
});
