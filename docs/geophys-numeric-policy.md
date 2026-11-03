# Geophysics source-number interpretation

New 3D file imports carry `geophysNumericPolicy: "finite-decimal-v1"`, including
files initially unrecognized or later remapped to Geophysics. The policy is
saved with the raw file text and restored; source rows, header names, coordinate
values, units, interpolation parameters and scientific settings are not edited.

The policy accepts complete finite signed decimal/scientific-number tokens.
Qualified values (`<0.05`, `>10`), separators (`1,000`), trailing text (`12tail`),
blank/nonfinite values and malformed coordinates are excluded. No BDL, decimal
comma, units or vendor-sentinel substitutions are inferred. A finite `-9999`
remains a number unless the source has already explicitly handled that code.
Ragged rows are excluded so split XYZ fields cannot shift mapped columns.

The existing Geophysics controls disclose accepted/submitted/excluded counts
and reasons without adding a panel. The API also returns per-file counts and
policy labels in `geophys.diagnostics`. Named geophysics fields remain mappable
even when all values are invalid, so users receive the exclusion explanation.
Auto-detection based only on a geophysics filename requires strict numeric
evidence; numeric prefixes do not qualify. Other role detection is unchanged.

Saved files without a policy keep the old prefix-number interpretation; opening
an old figure does not silently change its image. Their legacy interpretation
is disclosed. Replacing/importing a file explicitly applies the new policy.
Unknown saved string policy versions up to 80 characters are retained but fail
closed, with an unsupported policy explanation. Other defined malformed markers
normalize to an unsupported `null` marker before any source/cache fingerprint
serialization; they never become legacy by omission. Policy is part of geometry-
cache and source fingerprints and survives storage, version and share metadata.

This is local source work, not a production activation. The combined 59-test
suite passes, including existing layers, CSV/XYZ, mixed-policy, all-invalid,
import/serialization, storage/version/share roundtrips and retained-file/library
lifecycle cases. Three actual built-app browser cases pass in installed Windows
Chrome (desktop and mobile strict/legacy/unknown restore, plus manual role/column
mapping). Source text and policy markers roundtrip exactly in those cases.

Readable desktop/mobile captures show the existing controls reporting four of
nine points accepted and five excluded, with reasons and unchanged-source text.
They live in the local handoff as `geophys-strict-panel-{desktop,mobile}-20261103.png`.
The trial plain build, affected lint and diff checks pass. Final frozen-head
plain/configured builds, measured budgets, hosted checks/review and approval
remain required before release. No production database or account writes were
used for this evidence.

Startup graph review separated the small eager policy/metadata primitives from
the lazy point scan and diagnostic wording. Final-source measurements are
176.9 KiB entry and 143.8 KiB lazy in both plain/configured builds. Only these
two 3D caps allow a small stamp margin (177.2/144.1 KiB); total, other routes
and dependencies stay unchanged. Final stamped gates still run after this change.
