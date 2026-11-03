# Property boundary overlay: implementation and acceptance contract

This is local, unpublished work based on released main `1a034f73`. Geometry
validation, shared native/read-only/PNG/SVG renderer bindings and an explicit
contextual control exist. Desktop native and PNG checks have passed on synthetic
QA data; mobile, read-only-route, SVG visual and final release checks remain
pending. This feature is not published or deployed.

## Intended result

Give an explicitly selected property a clearer exterior while retaining its
individual claim borders, source attributes, per-feature styles, classifications,
selection targets, manual annotations and compact-key references. The exterior
is a presentation overlay, not a new title, ownership assertion or replacement
for original claim geometry. Existing maps must not activate it automatically.

## What the proof establishes

Ten synthetic fixtures exercise the existing declared `@turf/dissolve` library
on copied, visible polygon geometry. Adjacent polygons lose only their shared
edge in the derived result. A positive gap of 0.00001 coordinate units remains
open; an interior hole and disconnected MultiPolygon parts remain. Hidden claims
are excluded before union, including a wholly hidden property. Overlap does not
remove either source identity. Mutating an output coordinate does not mutate the
input. Derived polygons have no copied scientific or identifying properties.

The existing `canDissolve` refusal for classified/per-feature-styled layers stays
in force. The proof does not call that refusal defective: keeping the original
features and drawing a separate overlay is the implemented approach. Existing
identity and trim-consumer regressions run alongside these fixtures.

## Runtime invariants and acceptance requirements

- Resolve only the explicitly selected, visible eligible Property & Neighbours
  subject. Stale, ambiguous, hidden, context or non-polygon selections produce
  no overlay; do not infer a replacement subject.
- Bound source count, polygon/ring/coordinate count and topology work before
  union, and bound derived output. Reject invalid/open/nonfinite/out-of-range or
  unsupported geometry. The runtime validator enforces the bounds described
  below; the ten initial feasibility fixtures alone do not establish arbitrary
  topology correctness.
- Preserve holes, disconnected pieces and gaps without snapping, buffering,
  convex hulls, smoothing or tolerance-based gap closing. Do not add a fallback
  outline around invalid data when derivation fails.
- Cache derived geometry by immutable geometry and visibility inputs, with
  collectable ownership. Style-only changes must not repeat polygon union.
- Feed one result to native, read-only, PNG and SVG, independently of original
  feature drawing and hit testing. Derived outlines must not intercept clicks,
  trim/style selection, or change the ordinary dissolve guard.
- Review stroke ordering, visibility, clipping, opacity and expert overrides
  visually on actual desktop/mobile output before release. The minimal opt-in
  control is implemented locally. Preserve saved maps, undo/redo, restore and
  export permissions.

No new dependency, database, entitlement or account change is proposed. A future
cohesive implementation PR needs tests, native visual/export evidence, measured
builds and review; merge requires separate human approval.

## Validated input

`propertyBoundaryInput` now requires an explicit enabled argument and one exact
selected Property-recipe claims layer. It does not select another eligible layer
when the saved selection is stale, duplicated, hidden or marked as context.
The shared geometry resolver calls this helper for both raw input and derived
output validation. The contextual control persists the opt-in boolean described
below; no default enables it.

Conservative overlay work limits are 256 source features, 128 polygon parts,
256 rings, 2,048 positions and 200,000 tested segment pairs. Hidden source data
counts toward those limits and is validated before identity filtering. Larger
inputs fail closed; these are overlay limits, not new restrictions on imports.

The helper rejects unsupported geometry, open/degenerate/self-crossing/touching
rings, hole-shell crossings, holes outside the shell, nested holes, nonfinite or
out-of-range positions, and antimeridian edges. It does not snap, repair or close
anything. Coordinates are copied to 2D without altering source elevations. Ring
orientation may vary; overlapping separate polygons remain valid union inputs.
This is planar WGS84-coordinate validation, not a general geodesic topology or
legal-boundary validator. Antimeridian support is deliberately deferred.

## Derived geometry and cache

`createPropertyBoundaryResolver` now produces a separate, frozen coordinate-only
FeatureCollection using the existing declared Turf dissolve library. It validates
all raw geometry before visibility-key generation, filters hidden claims before
union, and applies the same topology/count/work limits to derived output. Union
exceptions, invalid output or output expansion beyond limits return no geometry;
there is no fallback to original internal borders or a manufactured enclosure.

Each resolver uses weak immutable-geometry keys with at most four visibility
states per geometry. Changing fill, classification or per-feature stroke without
changing visibility reuses the exact geometry object. Hiding a claim recomputes
the outline; restoring a retained visibility state reuses its previous result.
Changing the source geometry object recomputes it. Disabled or invalid selections
are checked before cache access. This relies on the app's existing immutable
project-state contract; in-place source mutation is not supported.

## Shared presentation consumers

`propertyBoundaryScene` now builds one stroke plan for native/read-only map FX
and the PNG/SVG export pipeline, gated by the strict boolean
`layout.propertyBoundaryOutline === true`. No default sets this flag. Original
feature drawing and selection paths remain.

The native stroke uses a separate pane above data polygons and below labels,
with pointer events disabled. It is suppressed while directly trimming or
styling the selected source. Exports draw it after ordinary data polygons on
the map layer, not in annotation-only exports. Colour and opacity follow the
selected layer/template presentation; zero stroke or opacity remains hidden.
Explicit emphasis adds two logical pixels to the base stroke, capped at 24.
Per-feature/class styles remain on the original paths; the optional property
outline is a uniform additional presentation stroke.

Only original projected boundary segments are clipped to the map frame; no
viewport-edge closing segments are invented. Stroke half-width is allowed for
inside the frame. The standard Canvas/SVG painters consume identical primitives,
with their existing pixel-ratio behavior. Invalid projection/frame or derivation
returns no stroke and an explanation rather than partial or replacement geometry.

Tests exercise actual Leaflet/FX consumers using a mock Canvas context and the
real SVG export pipeline, including legacy/off/removal behavior. These tests
complement, rather than replace, the native acceptance evidence below. There is
no production deployment.

## Contextual control

The existing Customize → Layers geology/label area now offers one unchecked
“Emphasize property boundary” checkbox for the explicitly selected Property
subject. It adds no panel, size slider, colour picker or automatic template
default. It changes only the layout boolean, not layer/scientific state.
An enabled but stale selection can still be disabled. Native status explains
successful rendering, temporarily paused editing, hidden strokes or unavailable
geometry. A queued action cannot update a different loaded project/layer array.
The status listener is cleaned up on unmount.

## Acceptance evidence and remaining gates

The detailed local evidence is recorded in the original workspace handoff at
`work/tower-handoff/boundary-native/RESULT.md`. Through 3 November 2026, 04:04 UTC,
the desktop checks used runtime `963e80cc` and synthetic QA claims A/B (adjacent),
C (disconnected by a positive gap), and an interior hole in A. The fixture does
not represent verified mineral titles or Tower data.

Completed through the normal native editor:

- Uploaded the fixture, chose Property & Neighbours, and verified the control
  starts off. Enabling it gives stronger exteriors while retaining the thinner
  A/B internal edge, open hole/gap, source labels and map furniture.
- Downloaded the actual 2000 × 1250 free watermarked PNG and visually inspected
  the same geometry, labels, title, legend, locator, scale and north arrow.
- Checked OFF/Undo/Redo, then enabled again and reloaded through the homepage's
  Start a map action. The ordinary local draft restored the enabled presentation.
  This is local-device restoration, not cloud-save verification.
- Entered individual styling, confirmed the derived outline pauses, and selected
  original claim QA-B directly on the map. A temporary QA-B-only dashed override
  changed only that original path; resetting it and finishing styling restored
  the stronger exterior.
- Trimmed QA-C through the original map hit target. Finishing trim removed its
  fill, label and derived exterior; Restore all returned the disconnected claim
  and its exterior without closing the gap.
- Classified the supplied synthetic `Cu_ppm` field into three ranges with zero
  excluded values. Distinct original fills and the range legend coexist with
  the stronger boundary. Undo restored the unclassified QA presentation. The
  numeric inspector is point-only and does not prove raw polygon-value inspection.
- Used the editor's Preview mode and visually confirmed geometry and furniture
  after the inspector was hidden. This is not public ReadOnlyStage route proof.

The normal SVG export action correctly opens the existing Pro gate for the
anonymous/free QA context. It was dismissed without a purchase, login, email or
entitlement bypass. No native SVG download or SVG visual acceptance is claimed;
the existing SVG renderer integration tests remain valid evidence of structure.

Parallel verification added two production-build desktop/mobile browser cases in
`e2e/property-boundary.spec.js`. Both pass upload/card/explicit-opt-in, painted
canvas/noninteractive pane, styling/trim pause, original claim hit-testing,
hide/restore, exact original GeoJSON preservation, undo, free PNG and gz1 draft
restore. Pixel-readback tests request `willReadFrequently` at fixture startup so
Chrome does not switch raster backends midway through exact canvas assertions.
No product rendering behavior or entitlement checks are changed by the fixture.

The local-only `e2e/fixtures/property-boundary-visual` harness mounts the actual
ReadOnlyMapStage and uses the shared buildScene/renderSceneToSvg pipeline. Its
desktop/mobile runs pass with no page errors and unchanged project input. Actual
read-only screenshots and pixel-rendered SVGs were visually inspected: stronger
exteriors, thinner internal edge, open hole/gap and original labels/furniture.
This fixture uses a blank basemap and synthetic data; it does not claim production
account, paid UI export, or authenticated public-route verification.

All 67 focused boundary tests pass. Independent source review found no blocking
finding. Measured plain/configured totals are 1125.5/1194.4 KiB, +4.4 KiB over the
released base. A separate size audit found no duplicated dependency; the added
input/output guards, union cache, shared stroke and control account for the cost.
The total caps now allow those measured values plus the existing 0.5 KiB stamp
margin. Entry/route/standalone caps and dependencies remain unchanged.

## Integration with released parent fixes

PR #409 is human-approved conditional on all final checks and review. Its normal
integration uses actual released main `9ffe81218a37afad29a19d06d6939c0dd83ce4e0`,
including strict geophysics numeric policy, lossless BOM recovery downloads and
private plaintext report search. The original boundary runtime/fixtures remain
unchanged; parent implementation files are preserved. All 123 focused tests
across 13 boundary, recovery/storage, geophysics and report-search suites pass;
affected-file lint and diff checks pass.

Combined measured plain/configured JavaScript totals are 1130.1/1199.1 KiB.
Only total allowances change to 1130.6/1199.6 KiB, retaining the existing 0.5 KiB
stamp margin. Current route, 3D, CSS, vendor and dependency caps remain intact.
The earlier standalone measurements above describe the original reviewed base,
not the combined release tree. Commit-specific final builds, actual desktop/phone
boundary and BOM recovery cases, asset stamps and browser coverage discovery are
recorded in the handoff release evidence. Exact-current-head hosted CI/review and
production verification remain required before a live claim.
