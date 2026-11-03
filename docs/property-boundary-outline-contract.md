# Property boundary overlay: feasibility contract

This is local, unpublished work based on released main `1a034f73`. Geometry
validation, shared renderer bindings and an explicit contextual control exist;
native visual/export acceptance and release checks remain pending.

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
features and drawing a separate overlay is the proposed solution. Existing
identity and trim-consumer regressions run alongside these fixtures.

## Required before runtime integration

- Resolve only the explicitly selected, visible eligible Property & Neighbours
  subject. Stale, ambiguous, hidden, context or non-polygon selections produce
  no overlay; do not infer a replacement subject.
- Bound source count, polygon/ring/coordinate count and topology work before
  union, and bound derived output. Reject invalid/open/nonfinite/out-of-range or
  unsupported geometry. The test-local prototype is **not** an input validator;
  ten fixtures do not establish arbitrary topology correctness.
- Preserve holes, disconnected pieces and gaps without snapping, buffering,
  convex hulls, smoothing or tolerance-based gap closing. Do not add a fallback
  outline around invalid data when derivation fails.
- Cache derived geometry by immutable geometry and visibility inputs, with
  collectable ownership. Style-only changes must not repeat polygon union.
- Feed one result to native, read-only, PNG and SVG, independently of original
  feature drawing and hit testing. Derived outlines must not intercept clicks,
  trim/style selection, or change the ordinary dissolve guard.
- Review stroke ordering, visibility, clipping, opacity and expert overrides
  visually on actual desktop/mobile output before exposing a minimal opt-in
  control. Preserve saved maps, undo/redo, restore and export permissions.

No new dependency, database, entitlement or account change is proposed. A future
cohesive implementation PR needs tests, native visual/export evidence, measured
builds and review; merge requires separate human approval.

## Unbound input foundation

`propertyBoundaryInput` now requires an explicit enabled argument and one exact
selected Property-recipe claims layer. It does not select another eligible layer
when the saved selection is stale, duplicated, hidden or marked as context.
Nothing calls this helper from the app yet, and it adds no saved setting.

Conservative prototype work limits are 256 source features, 128 polygon parts,
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

## Unbound union/output foundation

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
real SVG export pipeline, including legacy/off/removal behavior. These do not
establish native visual or pixel-rendered PNG acceptance. Next: inspect actual
desktop/mobile, classification/override, clipping and PNG/SVG output before
release gates. There is no production deployment.

## Contextual control

The existing Customize → Layers geology/label area now offers one unchecked
“Emphasize property boundary” checkbox for the explicitly selected Property
subject. It adds no panel, size slider, colour picker or automatic template
default. It changes only the layout boolean, not layer/scientific state.
An enabled but stale selection can still be disabled. Native status explains
successful rendering, temporarily paused editing, hidden strokes or unavailable
geometry. A queued action cannot update a different loaded project/layer array.
The status listener is cleaned up on unmount.

This control makes the local candidate testable through the normal editor;
desktop/mobile visual, actual PNG and history/restore acceptance remain required.
