# ExplorationMaps MCP fix log

Goal: error rate < 3%, p95 < 20s (directory, 30 days). Baseline Oct 8: 72 calls, 9.7% errors, p95 51.6s.

| Date | Cause | Fix | Before | After |
|---|---|---|---|---|
| 2026-10-08 | Preview with `claim_numbers` + `search.query` re-ran the holder's whole company search to filter a few claims; ON holders take 14-20s per search (Wesdome 2,270 records), stacking toward the 60s function limit. | Look up to 24 requested claims by number first; company search only as fallback (PR #260). | Live resolve, old code: ON Wesdome 19.3s, ON Kirkland 15.5s, BC/SK ~1s. Directory: 9.7% err, p95 51.6s. | New code, same inputs: 1.2s, 3.4s, BC/SK 0.6-0.9s; identical primary/neighbour counts. Directory: pending (24h lag, after promotion). |

Notes:
- Evidence limits: Vercel Hobby keeps 1h of runtime logs; `api/mcp.js` doesn't log tool errors in production; the directory's request-errors view needs the owner's claude.ai browser session.
- Preview deployments have no `SUPABASE_SERVICE_ROLE_KEY`, so preview MCP calls fail with "Server Supabase credentials are not configured"; verification ran the changed code locally against the live registries.
- Next suspects: `MAP_TOO_COMPLEX` on company-wide previews (BC Teck, ON Wesdome reproduce it); unsupported jurisdiction/company-search errors returned as `isError` (e.g. `mb` company search).
