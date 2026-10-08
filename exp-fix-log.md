# ExplorationMaps MCP fix log

Goal: error rate < 3%, p95 < 20s (directory, 30 days). Baseline Oct 8: 72 calls, 9.7% errors, p95 51.6s.

| Date | Cause | Fix | Before | After |
|---|---|---|---|---|
| 2026-10-08 | Preview with `claim_numbers` + `search.query` re-ran the holder's whole company search to filter a few claims; ON holders take 14-20s per search (Wesdome 2,270 records), stacking toward the 60s function limit. | Look up to 24 requested claims by number first; company search only as fallback (PR #260). | Live resolve, old code: ON Wesdome 19.3s, ON Kirkland 15.5s, BC/SK ~1s. Directory: 9.7% err, p95 51.6s. | New code, same inputs: 1.2s, 3.4s, BC/SK 0.6-0.9s; identical primary/neighbour counts. Directory: pending (24h lag, after promotion). |
| 2026-10-08 | Company-wide previews of large holders failed `MAP_TOO_COMPLEX` at the 2 MiB share limit (BC Teck 1,318 claims: 2.22 MiB; ON Wesdome 2,270: 2.08 MiB). Registry records carry many empty fields and 15-digit coordinates; neighbours took a fixed 600 KB whatever the selection used. | Drop empty fields, round coordinates to 6 places, give neighbours only the room left, and refuse a still-too-large set before branding/saving with a clear next step (claim_numbers or location.bbox) (PR #261). | Teck: fails (2.22 MiB). Wesdome: fails after ~20s (2.08 MiB). | Teck fits 1.93 MiB; Wesdome fits 1.94 MiB with 120 neighbours; Kirkland/Cameco shrink 6-10%. |

Notes:
- Evidence limits: Vercel Hobby keeps 1h of runtime logs; `api/mcp.js` doesn't log tool errors in production; the directory's request-errors view needs the owner's claude.ai browser session.
- Preview deployments have no `SUPABASE_SERVICE_ROLE_KEY`, so preview MCP calls fail with "Server Supabase credentials are not configured"; verification ran the changed code locally against the live registries.
- Next suspects: Ontario registry latency on company-wide previews (Kirkland Lake 34-37s: company search + neighbour bbox); unsupported jurisdiction/company-search errors returned as `isError` (e.g. `mb` company search).
