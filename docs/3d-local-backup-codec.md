# 3D local backup codec boundary

Source candidate, not release or physical-device acceptance. `local-backup-codec.js` is lazy, network-free and does not mutate a project. It validates the same envelope for export and import. `encodeBackup` returns UTF-8 bytes, a filename and a recomputed summary. `decodeBackup` returns the original validated plain project, name and recomputed dependencies. `validateBackupProject` checks project data and returns its dependencies.

Format is `exploration-maps-project`, version1, kind `3d`; inner project is the existing v1 `EM3D.getProject()` shape. Exact raw scientific file text, names/order, manual roles/column mappings, scientific settings, camera/pan, legacy policy absence and string/null policy markers are retained. Defined malformed policy objects are rejected. No values are rounded, repaired or policy-upgraded. Auth/session/save-target/share authority has no envelope slot. Errors contain fixed reason codes, never source text or image URLs.

Validation occurs before handing a project to the app: 8 MiB encoded bytes; fatal UTF-8; unpaired-surrogate rejection; JSON grammar and duplicate decoded-key checks before JSON.parse; depth16, 50,000 values, 200,000 tokens, 10,000 entries/container and100 files. Prototype/credential fields, unknown envelope/project/file/settings fields and unsupported required versions fail. Optional undefined fields produced by the existing API are omitted by ordinary JSON serialization; decoded JSON never introduces undefined values.

The raw-text preflight separately bounds parser/renderer expansion: 100,000 rows,128 columns,400,000 cells,65,536 characters/cell; OBJ25,000 vertices/faces, at most8 vertices/face and bounded finite coordinates. Before any live parser runs, collar/survey/assay mappings also bound individual trajectory depth to20,000 metres,1000 collar IDs and100,000 estimated2-metre path steps. These are conservative local-backup acceptance limits, not new scientific interpretations or changes to normal uploads. Larger figures retain ordinary save/export options. API-derived numeric and framing domains are checked rather than clamped. The102-hole/22,908-interval fixture fits these complexity limits; this is not the full-scale200,000-assay acceptance target.

Image slots are exactly `settings.logo.$image` and geology images `N/E/S/W/section`. Only canonical base64 PNG/JPEG is accepted, with matching signatures and dimensions before any image source assignment. PNG chunk lengths and CRCs are checked. Individual images cap at3 MiB encoded payload,4096 edge and4,194,304 pixels; total embedded pixels cap at8,388,608. Decoder staging in the fresh child remains responsible for actual raster decode before applying the figure. External/blob/SVG/relative URLs and unknown `$image` slots fail. Descriptive URLs in raw text, labels or source notes remain inert data. Known DEM/imagery/inset/font dependencies and source references are recomputed, without storing or fetching signed URLs. Provider pixels/fonts are not embedded; offline or provider-image parity is not promised.

Initial supported settings cover the existing base figure, bins, labels/wall labels, callouts, manual sections, camera/pan, scientific equivalent recipe, shell/geology/geophysics/tags, block controls, branding snapshots/allowed fonts, mesh presentation and descriptive library/property refs. Nonempty map overlays and drawn shapes are explicitly refused in this first scope; unknown settings/fields fail instead of being silently dropped. Existing raw GeoJSON/KML/overlay files are likewise refused. This restriction must be shown as an unsupported-content error, not advertised as universal project compatibility.

Node unit fixtures cover source-derived fictional sample/defaults; exact raw BOM/CRLF/qualified values/policy roundtrip; branded PNG and no-logo projects; camera/pan; duplicate escaped keys; malformed JSON/UTF-8; depth, byte, node and parser-expansion failures; unsafe image paths; inert source URLs; extreme renderer settings; and trajectory bombs. These prove bounded validation behavior, not browser memory peaks, atomic old-loader rollback, mobile hardware performance or full pixel parity. The app flow must independently prove fresh-tab context, new unsaved identity, account detachment, cancellation, renderer decode and unchanged original work.

## User flow and account boundaries

The existing My 3D maps menu downloads a local JSON file or reads one for
preflight. Open as new figure opens a separate same-origin tab, preserving the
original figure, history and cloud target. A window/origin/nonce-bound one-shot
MessageChannel transfers bytes privately; neither URL nor browser storage
contains the project. The child validates again before loading and keeps editing
and account actions inactive until successful load. Its target starts unsaved.

Restored tabs skip automatic project/version/brand/source loading throughout
their lifetime and preserve pending sign-in stashes. Explicit Save uses ordinary
permissions and creates a new target; paid export gates remain. Email-link
initiation is refused in this tab before sending or changing the shared stash:
sign in in another tab, then return and Save. Existing session/password Save is
supported. Public shared, embedded and published read-only contexts cannot use
these actions. This is a bounded editable 3D project backup, not an account archive
or a fix to the existing generic loader's old-tab transaction behavior.

## Independent resource-review corrections

The final source review adds regression-backed preflight for actual renderer paths, not merely finite JSON values:

- BothCSV and actualsharedXYZ detection/parsing feed the same manual/inferred collar/survey/assay geometry checks. Leading blankCSV rows follow the native parser, and false saved mesh roles on non-OBJ files are refused. Neither scientific text nor numeric policy is rewritten.
- Raw assay and published From/To, plus manual/published callout `at`/`at2`, are typed, finite, ordered and depth-bounded. Combined interval and override budgets each cap100,000 estimated2-metre steps before ribbon allocation.
- At most3 grade shells, matching `look.patchShell`. Valid explicit geology/geophysics face arrays and supported custom geophysics line records roundtrip unchanged. Explicit lines cap16; active `curtain` mode with `auto`/`all` also caps the conservative union of derived raw line identifiers at16.
- Geology categories cap32 across BOTH saved legend and effective native raw code mappings. `geology.classifyGrid` uses up to256×256 cells, so32 classes alone occupy8MiB of weights per grid before blur copies, coverage, other faces and textures. This is a conservative bound, not a total-process memory guarantee.
- Native label limits200 and wall-label limits120 characters are enforced without truncation, including actual coordinates/size/scale and stat rows up to12×120. Backup-specific label count ceilings are200 ordinary/8wall labels. Other rendered settings text caps4096 per string/32,768 aggregate, excluding raw scientific files and the separately validated inline image paths.

The102-test combined source suite covers codec, transport, restore context, account isolation and existing save reliability. Codec includes44 targeted cases. Trial builds/browser captures performed before these corrections do not validate the corrected source: fresh combined graph/budget/browser evidence remains mandatory before publication. These limits do not establish physical mobile peak-memory safety.

Final alias/effective-role correction: the codec now reuses native pure
matchCols/roleOf/refineRole with the same300-row sample before applying saved
manual columns/recognized role, matching addFiles→loadProject ordering. CSV
classification buffers only300 bounded rows; all remaining rows stream through
the resolved geometry/category/line checks. Slash/dash/parenthesis-wrapped aliases
and unsupported saved-role fallbacks have dedicated regressions. No duplicated
code/line alias regex remains. Latest combined102tests and affected lint/diff pass;
fresh post-correction build/browser gates remain outstanding.

Equivalent-grade resource bound: use native pure `eqFactors` to validate supplied units and finite positive factors, after finite positive prices and0<recovery<=100 checks. Preserve the original recipe and scientific source rows. Limit the component map to1–16 entries (bounded80-character component names) and estimated component-count×native-valid-assay-interval work to400,000. This independently prevents a small JSON recipe from multiplying existing row work into hundreds of millions of component loops. Regression fixtures cover encode/decode count and cross-product bombs plus exact valid multi-metal roundtrip and invalid unit/recovery/factor failure. Post-change combined102tests and affected lint/diff pass. Fresh final builds/browser gates remain required before publication.

Equivalent work and interval-span counters use the same leading-qualifier prefix
reading as native studio geometry (including '<0'/'<1'), solely to bound work.
The stored raw strings are never rewritten or policy-upgraded. Latest combined
source validation:102tests across5files, including44codec cases; no renderer
execution was used for adversarial resource fixtures.
