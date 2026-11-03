# Scoped 3D tag display work

Local source candidate based on main `1a034f73`; not a deployed performance claim.

The existing scale diagnostic in `drill-scale-benchmark.md` found repeated
`tags.statuses()` key generation in tag/overlay callers after the scene-loop
optimization. A status cache hit still joined every hole ID and serialized the
manual status map. Automatic emphasis and ID mode also repeatedly counted all
visible holes, and key-hole checks repeatedly asked for shown callouts.

The tag module now reuses these derived answers within each synchronous pill,
highlight-tube, histogram, legend, state snapshot or per-hole control pass.
The complete studio overlay also owns one pass, sharing its snapshot with nested
tag/plan calls and the collar highlight/ID loop. A pass is discarded
in `finally`, including when rendering throws. There is no new cross-pass cache
or edit-invalidation protocol. Existing standalone helper calls retain their
current behavior; the next pass reads current status, visibility and callouts.
Geometry, grade bins, scientific values, source fields, rendered styles, IDs,
control bindings and public API parameters are unchanged.

Focused regressions assert one status-key build and one callout lookup for a
100-hole control pass, linear shown-hole membership work, a fresh pass after
status/visibility/callout/emphasis/data changes, and cleanup after success or a
thrown render. These assertions count real existing inputs, rather than add
product instrumentation.

Focused validation: all 22 tests in `three-d-tags.test.js` pass, including seven
operation-count/invalidation/nested-exception cases; affected lint and diff checks
pass. The final three cases cover the profile-backed overlay/state extension.

## First-stage local browser and profile evidence

Before the studio-overlay/state extension, configured candidate and separate
clean baseline builds passed. The evidence below applies to that first-stage
source; it is not validation of the later extension. The existing
102-hole / 22,908-interval Layout browser regression passed in 18.5 seconds:
zero idle paints in its measurement, zero buffers disposed or textures uploaded
by the text edit, and all existing PNG equality, hole visibility, camera, resize
and label-drag assertions retained. Its chooser took 145 ms and text edit 47.9 ms;
these are one-run diagnostics, not cross-version improvement estimates.

Eight baseline/candidate PNG exports are byte-identical: 3D and section views
for the bundled fictional sample, a 102-hole synthetic figure, edited statuses/
highlight/visibility, and a reset. They were exported at width 600 after fonts
and layers settled. Both reset images also match their original sample images.

One full existing loopback-only scale benchmark ran per version, sequentially,
using Chromium 151.0.7922.34, desktop 1400 × 900 and SwiftShader. Both passed
complete paging/source/scene counts for 2,000 collars, 20,000 surveys and 200,000
assays, plus the camera/two-frame assertions. No hosted reads or writes occurred.

| Profiled local observation | Clean baseline | Scoped-pass candidate |
|---|---:|---:|
| Load and settle | 25,573 ms | 22,938 ms |
| Camera and two frames | 857 ms | 3,791 ms |
| Maximum observed long task | 2,965 ms | 2,355 ms |
| Sampled `statuses()` self time | 9,536 ms | 8,063 ms |

The status function was identified in each minified tags chunk (`he`/`ue`) by
its unchanged hole-ID/manual-status key construction. Profiles include loading,
camera and the final screenshot; they are not load-only profiles. The candidate
still spends substantial time in status work outside these scoped passes, and
its camera observation is worse. This single software-renderer pair establishes
output preservation and reduced redundant work, not a controlled performance
ratio, physical-GPU acceptance or a completed responsiveness target.

Local evidence lives under `work/tower-handoff/`: `3d-tag-pass-units.log`,
`3d-tag-pass-layout-browser.log`, `3d-tag-{baseline,candidate}-parity.json` and
matching PNGs, `3d-tag-{baseline,candidate}-scale.json` and `.cpuprofile`, and
`3d-tag-pass-comparison.json` (including all eight PNG hashes). The separate
baseline checkout remains at exact base `1a034f73`; both temporary local servers
were stopped after capture. No source was swapped during a measurement.

Final frozen plain/configured builds, budgets and independent review remain
before a focused PR. Merging requires separate human approval.


## Profile-backed overlay/state extension

The first-stage candidate's remaining 8,063 ms of sampled status self time was
attributed by caller stack: 5,108 ms in studio's complete `drawOverlay` (2,638 ms
through collar highlighting and 2,469 ms through ID eligibility), 1,475 ms in
`tags.state()`, 925 ms in restyle/fade callers, and 555 ms elsewhere. These are
sampled self-time attributions, not wall-clock phase durations.

The next bounded edit scopes the existing pass around that complete synchronous
studio overlay and around state reads. It adds no persistent cache or asynchronous
scope. Restyle is deliberately unchanged. Nested-operation-count, inner/outer
exception cleanup, next-edit visibility/status and callout tests accompany it.
The extended source passes all 22 focused tests and the existing Layout browser
regression (17.6 seconds). Its eight PNG exports exactly match the preserved clean
baseline hashes across sample, 102-hole synthetic, edited and reset 3D/section
figures. The source did not change after the extension build/captures.

One extension full-scale profile ran after those checks, reusing the immediately
preceding clean baseline reference instead of rerunning it unchanged. It passed
the same complete 2,000-collar / 20,000-survey / 200,000-assay page, source and
scene assertions, plus the camera/two-frame checks, on the same Chromium version,
viewport and software renderer.

| Profiled local observation | Preserved clean baseline | Extended candidate |
|---|---:|---:|
| Load and settle | 25,573 ms | 22,283 ms |
| Camera and two frames | 857 ms | 1,867 ms |
| Load plus camera | 26,430 ms | 24,150 ms |
| Maximum observed long task | 2,965 ms | 2,083 ms |
| Sampled `statuses()` self time | 9,536 ms | 1,190 ms |

The extension targets the measured status-key work: its remaining samples are
predominantly restyle/fade callers, intentionally outside this scope. The camera
observation is still worse than the baseline, and multi-second blocking remains.
This is one local diagnostic reference/candidate comparison, not a controlled
speedup ratio, hosted result, physical-device acceptance or complete performance
milestone.

Extension artifacts are `3d-tag-pass-extension-{units,build,layout-browser}.log`,
`3d-tag-extension-parity.json` and matching eight PNGs,
`3d-tag-extension-scale.json`/`.cpuprofile`/`.log`. The shared comparison JSON now
includes an `extension` record, identified status function `fe`, sampled caller
stacks, runtime source hashes and the unchanged PNG hashes. The extension server
was stopped after capture; the clean baseline checkout is retained.

Final frozen builds, measured budgets and review remain before publication.
