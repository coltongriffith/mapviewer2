# Property boundary overlay: feasibility contract

This is a test-only geometry proof on released main `1a034f73`. There is no
editor control, renderer binding, saved setting or production behavior yet.

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

The resolver remains unreferenced by application entry points. Next: share one
presentation geometry between native/read-only/PNG/SVG paths, preserve hit
testing and styling precedence, and inspect actual visual/export behavior before
exposing a minimal opt-in control. There is still no usable new boundary feature
or production deployment.
