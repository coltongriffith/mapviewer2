# 3D Tour integration

The first integration from the supplied ExplorationMaps 3D Tour kit adds
**Export â†’ 3D Tour** to the existing 3D maker. Open an existing saved figure,
or use its existing property-data and claims loaders, then preview and download
an interactive HTML tour. No example project or claimed Star drilling positions
are installed in the app.

## Included

- Title, exact assay-column selection, unit label, increasing grade bins and target.
- Optional labels by hole ID and an explicitly enabled generalized footprint.
- Preview in a sandbox without same-origin privileges; one downloadable HTML file.
- Existing mapped project tables and project-claim overlays, including uploaded overlays.
- Actual figure desurvey paths, with display-only surface shifts removed and measured
  collar elevations retained. The tour uses equal scale.
- All loaded holes and claims, including hidden figure items; the panel states this.

The supplied builder was corrected for geographic-to-UTM code construction,
horizontal zero dips, duplicate/invalid intervals and gaps, and bounds on work.
Unit suffixes remain intact: Cu in percent and ppm are separate columns.
Censored values are excluded from grade colouring instead of being interpreted
as measured grades. Missing positions are never fabricated; missing required
CRS, claims or mapped tables produces an actionable message.

The footprint is disabled by default. When requested, both the panel and viewer
describe it as a generalized illustration, not a geological boundary or resource.
Terrain is a reference visualization, not a site survey. DEM and imagery require
network access; the file contains its viewer and project geometry, with a labelled
approximate surface fallback. Attribution remains visible.

## Dependencies and security

The integration uses the app's existing Three 0.147 global build as export text
and existing proj4. No dependency or application-renderer upgrade is included.
The raw Three payload has its own lazy chunk and separate measured budget;
opening the maker does not load it.

Only the two fixed, trusted viewer script bodies receive CSP hashes, scoped to
the maker's three entry URLs. Project strings enter an escaped JSON data block
and are displayed with textContent. General routes keep their existing policy;
no unsafe-inline or unsafe-eval script permission is added.

After changing the template or Three source, run node scripts/tour-csp.mjs --write
from the repository root. Tests verify the resulting hashes. A browser test checks
the preview under the real site's headers and opens the actual downloaded HTML.

## Hosted publishing is a separate integration

The archive's example hosting/tours.sql and service-role HTML-serving endpoint
are **not installed or exposed**. Their ownership, project access, storage paths,
revocation/deletion and public-data boundaries need the same controls as existing
live maps. In particular, an authenticated user's storage write permission must
not apply to arbitrary tour paths. Public HTML must be generated from validated
packages and a trusted template, not arbitrary uploaded executable HTML.

A future hosted integration needs owner/current-editor authorization, atomic
republish and revocation, safe optional-schema fallback, and local SQL/API tests
before a separately authorized production migration. The existing 3D maker, share
and embed routes remain available. This PR makes no production database,
storage, environment, billing or plan changes.

Review follow-up: tours reuse the maker's CRS definitions (including NAD27, MGA and custom proj4). Complete supplied survey paths do not require redundant collar orientation; incomplete paths still fail validation. Playback stays above the measured navigation height when labels wrap in narrow previews.

Setup choices now populate independently of strict geographic validation. Missing
CRS produces a prominent explanation and a route back to Data instead of blank
dropdowns and a blank iframe. The user must supply the source coordinate system;
no location is guessed. Claims are optional: drilling/terrain-only tours show a
notice and omit the claim outline and legend, with the camera fitted to the
project extent. Existing claim overlays are retained when supplied.



## Hosted package boundary (preparation)

The future hosted API must receive JSON packages, not executable HTML. `package.ts`
provides the first independent boundary: an 3 MiB UTF-8 limit before JSON parsing,
version/shape checks, finite bounded geometry, valid hole/bin references, bounded
terrain mesh and tile work, and an imagery source allowlist. It preserves the
positions and text supplied by the builder; escaping still belongs to the trusted
renderer. Hosted colours currently accept hexadecimal values only. These extra
hosted limits do not change existing local preview or HTML download behaviour.

This validator is not yet wired to a public route or publish UI. The next step
is owner/current-editor publishing with atomic republish/revocation/deletion and
optional-schema fallback. Auth and database tests must cover removed editors,
revoked links and missing schema. No production activation is included here.

The server-only `api/_lib/tour-render.ts` now reads the repository template and
installed Three source itself, revalidates JSON, and returns HTML with hashes of
only those two executable scripts. A sandbox without same-origin access, fixed
image origins, disabled connections/forms and no-store responses are supplied
for a future endpoint. That endpoint must authorize before rendering and include
the template/Three assets in its deployment bundle. No route is exposed yet.

Resource checks match the viewer's bilinear detail-region projection, reject
degenerate transforms and off-extent collars, and bound fallback DEM work and
imagery canvas dimensions. These checks prevent compact hostile packages from
expanding into unbounded tile/image/mesh work. Browser verification of the final
endpoint and its deployed header rules is still required before publication.

## Optional persistence migration (not activated)

`20261104120000_hosted_3d_tours.sql` stores data packages in a private RLS table
with no anonymous/authenticated table grants. Only current personal owners or
company editors may publish, inspect link metadata or revoke. Public reads expose
only an explicitly published package through its random identifier. The renderer
must validate every read: the SQL shape check is intentionally not a replacement
for the complete package boundary.

Publish/revoke lock the saved figure row, updates require the expected revision,
and rapid republishes are throttled. Revocation clears the package; republishing
after revocation creates a new link. Soft deletion or ownership-scope changes
withdraw all links, restoration does not revive them, and permanent deletion
cascades. No extra storage bucket or account assignments are needed.

The migration is source-only and requires explicit approval before production.
It depends on the workspace schema. The source-only `api/tour.ts` boundary uses
the anonymous key for public package reads and a server-verified current-user
JWT for management; it never uses a service-role client. Publishing validates
both package JSON and final escaped HTML before writing. Public rendering
revalidates stored packages, and every response disables caching. Missing RPCs
report sharing unavailable while ordinary preview/download remains usable.
The source UI requires an explicit availability check and public-data consent,
then publishes the current valid preview or revokes its existing link. Context
changes clear sharing controls. `/tour/:id` rewrites to this endpoint; only that
route and `/api/tour` bypass the site's global framing denial. Valid viewers use
the renderer's exact script hashes and sandbox; management/errors use an inert
CSP. Trusted template and pinned Three assets are explicitly included in the
Function and tested from an isolated relocated server bundle. Real browser
header checks and final release validation remain pending; this endpoint has
not been published or activated. Rollback first disables that
UI/endpoint, then drops the project trigger, five tour functions and private
`three_d_tours` table; exported local HTML files are unaffected.

## Model appearance and envelopes

Tour export now reuses the maker's five scientific grade colours, selected field,
bins and display cutoff, including its already-calculated equivalent values.
Equivalent assumptions and existing display-placement adjustments are disclosed
in data notes. Controls use the model's brand colours and claim outlines retain
their source colours. Geometry remains in physical metres without copying visual
vertical exaggeration.

Visible supplied OBJ shapes and ready exploratory grade-envelope surfaces can be
included using the model's existing vertices, indices, colours and opacity. The
tour never estimates a new envelope. If none exists, return to Layout to enable
one or load a source shape. Oversized or invalid geometry fails explicitly.
Exploratory surfaces retain the caution that they are not mineral resources.

The exported viewer has Claims and Envelopes toggles. Claims are redrawn on the
terrain without refetching tiles; the envelope toggle controls the actual mesh
group. These controls are available in preview and downloaded HTML. Showing or
hiding either layer does not edit the source project or its scientific settings.

