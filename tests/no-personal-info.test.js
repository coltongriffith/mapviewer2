import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The site should identify Exploration Maps, not a person.
//
// Personal contact details had accumulated in the places nobody re-reads:
// structured data in the page head, a contact page, two SQL migrations, a
// fallback in the sync script. Committed source is permanent — it survives in
// every clone and every fork, so "we changed it later" does not undo it.
//
// This runs over the files git actually tracks, which is the set that leaves
// the machine. Build output under dist/ is generated and ignored.

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // This test names the patterns it forbids, so it would flag itself.
    .filter((f) => f !== 'tests/no-personal-info.test.js');
}

// Split so the literals do not appear as searchable strings in this file.
const FORBIDDEN = [
  { label: 'personal mailbox', re: new RegExp(['colton', 'griffith', '@live\\.ca'].join('|'), 'i') },
];

describe('no personal information in tracked source', () => {
  const files = trackedFiles();

  it('tracks a plausible number of files', () => {
    // Guards the guard: a broken git call returning nothing would make every
    // assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(FORBIDDEN)('contains no $label', ({ re }) => {
    const hits = [];
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // binary or unreadable — nothing to match
      }
      if (re.test(text)) hits.push(file);
    }
    expect(hits, `personal information found in: ${hits.join(', ')}`).toEqual([]);
  });

  it('routes published contact points at the site, not a person', () => {
    // The pages a visitor or a crawler actually reads.
    ['public/contact/index.html', 'public/about/index.html', 'index.html'].forEach((file) => {
      const text = readFileSync(file, 'utf8');
      const addresses = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      addresses.forEach((addr) => {
        expect(addr.endsWith('@explorationmaps.com'), `${file} publishes ${addr}`).toBe(true);
      });
    });
  });

  it('keeps notification recipients out of SQL bodies', () => {
    // A migration is applied once but stored forever.
    const sql = readFileSync('supabase/migrations/20260812000001_signup_notification_recipient_from_vault.sql', 'utf8');
    expect(sql).toContain('signup_notification_to');
    // Comments are stripped first: the header documents the change with a
    // placeholder address, and a placeholder in prose is the opposite of a
    // recipient baked into the function.
    const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    const addresses = body.match(/'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'/g) || [];
    addresses.forEach((addr) => {
      expect(addr.includes('explorationmaps.com'), `SQL hardcodes ${addr}`).toBe(true);
    });
  });
});
