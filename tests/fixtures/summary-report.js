// A small admin_get_summary response, shared by the unit and admin e2e tests.
export const summaryReport = {
  totals: { people: 12, engaged: 8, bounced: 4, made_map: 2, signups: 1, you: 30, bots: 140 },
  daily: [
    { d: '2026-09-03', engaged: 3, bounced: 1, signups: 0 },
    { d: '2026-09-04', engaged: 5, bounced: 3, signups: 1 },
  ],
  sources: [
    { channel: 'Google', people: 6, engaged: 4, made_map: 1, signups: 1, sites: ['google.com'] },
    { channel: 'Direct', people: 6, engaged: 4, made_map: 1, signups: 0, sites: [] },
  ],
  pages: [{ path: '/', people: 7, engaged: 4 }, { path: '/blog/bc-claims/', people: 5, engaged: 4 }],
  usage: {
    steps: [
      { key: 'visited', label: 'Visited', n: 12 },
      { key: 'engaged', label: 'Stayed or did something', n: 8 },
      { key: 'editor', label: 'Opened the map editor', n: 5 },
      { key: 'data', label: 'Added claims or data', n: 3 },
      { key: 'made', label: 'Exported or shared a map', n: 2 },
      { key: 'signup', label: 'Signed up', n: 1 },
    ],
    features: [{ label: 'Claim search', n: 4 }, { label: 'Tenure monitor', n: 1 }],
    ai: { maps: 9, chats: 3, signed_in: 1 },
  },
  problems: {
    errors: [{ message: 'Unable to preload CSS for /assets/App.css', path: '/app', times: 11, people: 11, last_seen: '2026-09-04T18:00:00Z' }],
    failed_searches: [{ query: 'juggernaut exploration', province: 'BC', kind: 'company', times: 2, errored: false, last_seen: '2026-09-04T17:00:00Z' }],
    stuck: [
      { key: 'no_data', label: 'Opened the editor but added no data', n: 2 },
      { key: 'phone', label: 'Opened the editor on a phone', n: 0 },
    ],
    feedback_open: 1,
  },
  signups: [{ user_id: '00000000-0000-4000-8000-000000000001', email: 'new@example.test', created_at: '2026-09-04T16:55:00Z', confirmed: true, landing: '/', source: 'google', session_id: 'tab-signup' }],
  recent: [{ session_id: 'tab-1', first_at: '2026-09-04T15:00:00Z', last_seen: '2026-09-04T15:20:00Z', pages: 3, city: 'Vancouver', country: 'CA', device: 'desktop', channel: 'Google', referrer: 'google.com', landing: '/', email: null, user_id: null, steps: ['Searched', 'Opened editor', 'Exported'] }],
};
