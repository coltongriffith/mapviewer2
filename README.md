# Exploration Maps

Browser-based map builder for mineral exploration: search provincial claim
registries, import drill/geology data, style investor-ready maps, and export
them as PNG/SVG/PDF. Live at [explorationmaps.com](https://www.explorationmaps.com).

## Stack

- **Frontend:** React 18 + Vite 5 single-page app (`src/`), Leaflet map engine
- **Backend:** Supabase (auth, Postgres, RLS) + Vercel serverless functions (`api/`)
- **Static marketing content:** generated blog + company pages under `public/`
  (see `scripts/generate-blog.js` and `scripts/pseo/`)

## Requirements

- Node 20+ (Vite 5 requirement; dev/CI verified on Node 20/22)
- npm (a `package-lock.json` is committed — use `npm ci` for reproducible installs)

## Development

```bash
npm ci                 # install exactly the locked dependencies
cp .env.example .env   # fill in the VITE_ variables (see below)
npm run dev            # Vite dev server on http://localhost:5173
```

The serverless functions under `api/` run on Vercel. For full-stack local
work use `vercel dev`; with plain `npm run dev` the claims search and
analytics endpoints are absent (the UI degrades gracefully).

## Commands

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                           |
| `npm run build`        | Generates the blog, builds to `dist/`, copies the admin shell |
| `npm test`             | Vitest run (CI mode)                                      |
| `npm run test:watch`   | Vitest watch mode                                         |
| `npm run pseo:fixture` | pSEO company-pages pipeline against fixture data          |

## Environment variables

Documented in `.env.example`. Summary:

**Public (`VITE_` — compiled into the client bundle, never secret):**

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase project + anon key
  (production-required; without them auth/cloud features disable themselves)
- `VITE_ADMIN_EMAIL` — controls admin dashboard **visibility only**; real
  authorization is server-side (`admin_users` table + `is_admin()`)

**Server-only secrets (set in Vercel, never referenced by client code):**

- `SUPABASE_SERVICE_ROLE_KEY` — used by `/api/track` for analytics ingestion.
  Production-required once migration `20260710000004` is applied.
- `ADMIN_API_SECRET` — optional; unlocks the claims-API diagnostic modes in
  production via the `x-admin-secret` header.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — optional server-side aliases; the
  `VITE_`-prefixed values are used as fallbacks by `api/claims.js` (Quebec)
  and `api/track.js`.

## Architecture notes

### Serverless APIs (`api/`)

- `api/claims.js` — multi-province claims search proxy (BC WFS, ArcGIS
  provinces ON/SK/MB/NL/YT, Quebec via a self-hosted Supabase table). Full
  pagination with honest `meta: { totalKnown, returned, truncated,
  pagesFetched, provider }`; rate-limited; CORS-restricted; sanitized errors.
- `api/bc-claims.js` — BC-only WFS proxy (nearby-claims bbox + legacy search).
- `api/track.js` — all analytics ingestion (page views, live-presence pings,
  product/search events, landing clicks, leads). Enforces an event-name
  allowlist, payload size/depth limits, and session-id shape; derives geo
  from edge headers (never the body); resolves user identity from a verified
  Supabase access token; writes with the service role; rate-limits per IP.
  Without `SUPABASE_SERVICE_ROLE_KEY` it accepts-and-drops so analytics can
  never break the app.
- `api/geo.js` — echoes Vercel edge geolocation headers.
- `api/_lib/` — shared helpers (pagination, request guards, esri→GeoJSON);
  the underscore path means Vercel does not expose them as endpoints.

### Shared maps

Share links are `/map/<id>` where `<id>` is a client-generated
`crypto.randomUUID()` (a 122-bit random token). Reads go through the
`get_shared_map(share_id)` RPC — table-level SELECT is revoked, so
`shared_maps` cannot be enumerated from the public client. Old links keep
working: the id remains the lookup key.

### Authentication & admin

Supabase auth (magic-link default, password fallback). Admin access is a row
in `public.admin_users` checked by `is_admin()` inside SECURITY DEFINER
reporting functions; all definer functions have a pinned `search_path` and
explicit execute grants. To add an admin:

```sql
insert into public.admin_users (user_id, note)
select id, 'added by <you>' from auth.users where email = '<email>';
```

### Local project storage

`src/utils/projectStorage.js`: projects + the working draft live in
localStorage, deflate-compressed (`gz1:` prefix), with a schema version and
deterministic migrations. Corrupted records are preserved under a
`.recovery` key (never auto-deleted) and surfaced with manual export/discard
helpers. Writes return structured results — the UI never claims success on a
failed write. On sign-in, local projects migrate to the cloud with
per-project status + retry (`src/utils/cloudMigration.js`).

### Import formats

CSV (RFC 4180 via Papa Parse; auto-detected lat/long columns), GeoJSON
(validated), zipped shapefiles, loose `.shp/.dbf/.prj/.shx` sets (the `.prj`
is honored — projected files are reprojected to WGS84 via proj4), KML, and
KMZ (bounded: entry count, uncompressed size, path traversal).

## Database migrations

Timestamped, additive migrations live in `supabase/migrations/`. The legacy
`supabase-*.sql` files in the repo root are the historical hand-run setup
scripts — they document existing production state; new changes go in
`supabase/migrations/` only.

Apply order matters — two migrations are deploy-coupled:

| Step | Action | When |
|------|--------|------|
| 1 | `20260710000001_shared_map_lookup_rpc.sql` | Any time (additive) |
| 2 | `20260710000003_live_pings_read_lockdown.sql` | Any time (the deployed app never reads live_pings) |
| 3 | `20260710000005_admin_authorization.sql` | Any time (additive; seeds the current admin) |
| 4 | Deploy the frontend (uses `get_shared_map` + `/api/track`) and set `SUPABASE_SERVICE_ROLE_KEY` in Vercel | — |
| 5 | `20260710000002_shared_maps_lockdown.sql` | Only after step 4 |
| 6 | `20260710000004_analytics_ingest_lockdown.sql` | Only after step 4 |

Each migration header includes rollback instructions. After applying, verify
RLS as an anonymous client, a normal authenticated user, and the admin —
verification queries are embedded in `...000005`.

## Deployment & rollback

Pushes to `main` deploy via Vercel (`npm run build` → `dist/`, plus `api/`
functions). Rollback = redeploy the previous Vercel deployment (instant);
if a deploy-coupled migration was applied after the deploy being rolled
back, also run the rollback SQL from that migration's header.

## Testing

Vitest + React Testing Library (`tests/`, config in `vitest.config.js`).
Coverage focuses on regression protection: save/autosave race conditions,
claims request ordering/cancellation, provider pagination, shapefile
projection + CSV/GeoJSON parsing, storage failure/corruption handling,
local→cloud migration retries, API hardening, ArcGIS geometry conversion,
and shared-map access.
