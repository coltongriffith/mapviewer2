# Download preserved local data

This local source candidate replaces console-only recovery instructions with a
small contextual notice in the existing editor. It appears only when a corrupt
local draft or saved-map record has already been preserved by `projectStorage`.
It adds no settings, account requirement, repair action, deletion or importer.

The ordinary Download draft copy / Download saved maps copy buttons download
the current preserved string as UTF-8 text using the existing Blob downloader.
Filenames are fixed and distinct; the output is a raw recovery/support copy,
not a repaired project or importable archive. Encoding is verified before a
file is offered, including a preserved leading UTF-8 BOM; malformed unpaired Unicode fails closed rather than silently
changing its contents. Pending/error/status text is accessible, and dismissal
only closes the notice. Neither primary nor recovery storage is written by this
component. The legacy internal debugging helpers remain compatible.

Focused tests cover exact raw content, safe names, pending/error/retry, missing
copies, lossless-encoding refusal and non-destructive dismissal. Two authored
browser cases exercise desktop and phone downloads, real file contents, storage
preservation, responsive notice and rediscovery on a real reload without
re-seeding.

## Local validation

- All 21 tests across the new notice and existing project-storage suites pass
  (2.96 seconds), including raw text with CRLF, non-ASCII, NUL and leading BOM,
  pending/error/
  retry, unavailable recovery copies, lossy-Unicode refusal and dismissal.
- The plain trial build passes (12.42 seconds). It is not the final frozen
  release build, and final plain/configured measured budgets remain pending.
- Both actual built-app Chrome browser cases pass: desktop 1280 × 800 and an
  emulated touch phone 390 × 844. They read the actual downloaded files, compare
  exact preserved strings and fixed filenames, check primary/recovery storage
  unchanged across downloads and dismissal, and rediscover the original copies
  after a real navigation without replaying the seed.
- Screenshots from those same cases were inspected. The notice is a compact
  strip above the map; the two recovery buttons and dismissal wrap visibly on
  the phone. No settings or additional panel is introduced.
- A screenshot-artifact rerun passes both unchanged cases in 6.6 seconds. No
  runtime source changed after the successful trial build. New-file lint and
  diff checks pass; App's existing lint warnings remain, with no errors.

Local artifacts under `work/tower-handoff/`: `local-recovery-units.log`,
`local-recovery-bom-units.log`, `local-recovery-trial-build.log`, `local-recovery-browser.log`,
`local-recovery-browser-screenshots.log`, `local-recovery-desktop.png` and
`local-recovery-phone.png`. The temporary loopback server was stopped. Physical
phone, cloud restore and repaired-project import are not claimed. Final stamped
plain/configured builds, budgets and review remain before publication.

No production reads/writes, migration, provider configuration, subscription
change, external message or new dependency is required. A future merge needs
separate approval after exact-head checks and review.
