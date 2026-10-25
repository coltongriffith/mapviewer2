# Alteration CSV and Excel import

The property drill importer adds an explicit **Alteration** kind using the existing column mapping, dry run, commit, templates and retained import history. This slice does not load alteration into 3D or add structural observations. It never creates collars or coordinates from a log.

## Source contract

- `hole_id`: actual source identifier, trimmed, 1–60 characters.
- `from_m`, `to_m`: measured downhole metres; start nonnegative, end strictly greater, finite numbers below the existing magnitude limit.
- `code` (up to60 characters) or `description` (up to500): at least one source value required; case preserved.
- `intensity` (optional text, up to60): outer whitespace trimmed, otherwise preserved. `03`, `0`, `weak`, `1-2`, `ND` and `1,5` stay text. Blank is omitted/unknown, never inferred as zero. Excel cells already stored as numbers cannot recover leading zeros; use text cells when those zeros matter.

One record is allowed per property/hole/from/to interval. Exact duplicate interval keys stop the import; overlapping distinct intervals remain separate and produce warnings. Alteration gap messages say “gaps between logged intervals,” without implying that samples are missing. Nested intervals do not invent a gap inside a larger logged interval.

CSV and the existing lazy Excel reader use the same canonical builder. Decimal-comma normalization applies only to opted-in numeric fields, not IDs, codes or intensity. Error locations retain physical CSV lines or worksheet rows. Column templates remain separated by kind.

## Detection and availability

An interval-shaped file can suggest Alteration from an explicit alteration header (`Alteration code`, `Alteration description`, `Alteration intensity`, `Alt code`, and equivalents) or an explicit alteration filename. Generic `Code` or `Intensity` alone does not reclassify legacy files. The user can always choose Alteration and map columns directly. Shared 3D role detection is unchanged.

The optional `alteration` summary count is shown only when returned by the database. Before the additive migration is deployed, an alteration dry run rejected with `INVALID_KIND: alteration` explains that the feature needs the database update; original import kinds still work. The UI does not execute migrations. Deployment requires the separate reviewed migration and rollout authorization.

## Preview and retry lifetime correction

Review found an existing importer race: mapping/kind changes could be followed by an older dry-run response restoring its reviewed diff. Each operation now has a generation; input edits, cancellation and unmount invalidate old responses. Late template responses are also discarded and loaded templates remain associated with their kind. A property change remounts the importer, preventing an old commit callback from refreshing the next property.

An unchanged uncertain commit retry retains its batch UUID. File, kind and mapping changes discard both the reviewed diff and retry UUID. During commit, submission controls are disabled; closing/changing property still abandons local callbacks. This preserves the original database retry semantics: it is **not** a claim of payload-verified retries or of automatic reversal of a server operation after navigation.

## Verification

Focused parser tests cover both file formats, exact source strings, decimal handling, required/length/depth checks, original row locations, duplicate/overlap/gap behavior, template mappings and unavailable-schema errors. Component tests cover both new and legacy-kind stale previews, kind/template races, uncertain retry UUID reuse, mapping invalidation, commit controls and unmount callbacks. Built desktop/phone tests cover alteration CSV and Excel, templates, uncertain retry, summary/history/rollback and legacy behavior before the new database support exists. SQL authorization/versioning tests are supplied by the separate foundation migration.
