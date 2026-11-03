# Find in report text

The property's Data library offers one contextual **Find in report text** action
for Markdown documents and `.txt` files explicitly classified as Document.
It opens a compact search form only when requested. Nothing is read until Find
in text is submitted. Viewers retain their existing file-read access; no editing
permission is added. PDF/Word extraction and OCR are not implemented or implied.

Search matches literal content, case-insensitively, with original line numbers
and bounded snippets. Regex characters are literal. Results show the selected
file name, version and recorded SHA-256. At most 50 matching lines are displayed,
with the total matching-line count retained. Text and highlighting use React
text nodes; Markdown and uploaded HTML never execute.

Only UTF-8 reports up to 2 MiB are supported. Reads check current library metadata
and network-verified current-user identity before and after retrieval. They use
the existing private bucket and a short-lived signed read URL held only in the
request, never state, logs, DOM or results. Streaming bytes are counted and the
reader cancelled on excess; there is no unbounded download fallback. Actual byte
count and SHA-256 must match the selected version; malformed UTF-8, binary control
bytes, unknown hashes, unexpected size and inaccessible/stale files fail visibly.
Normal file downloads and their permissions are unchanged.

User/property/request/file changes and library reloads invalidate in-flight
searches. Closing aborts the request. Each explicit search rechecks the current
version/deletion state. These are before/after observations, not an atomic
server-side snapshot or an access lease. No text/index is saved or sent to a
search provider. The query stays in the tab. No migration, storage activation,
service credential or new dependency is required.

This is a local source candidate. Four focused unit/UI files pass (32 tests).
Both configured browser cases pass on desktop/mobile (four runs), including private
read errors, invalid UTF-8 and a concurrently changed version. Panel captures are
readable at both sizes. Trial totals measure 1124.7/1193.6 KiB plain/configured; only
total caps changed, to 1125.0/1194.0. Frozen SHA-stamped builds/budgets and final browser
confirmation remain required before publication. Merging needs human
approval. Broader PDF/Word/report search still needs an extraction/OCR contract.

Combined release candidate: normally integrated actual main 32a0b94c (released
strict geophysics and local recovery). Ten affected unit/UI files pass, 103 tests.
Combined trial totals measure 1125.7/1194.7 KiB; only total caps grow to
1126.1/1195.1 with 0.4 KiB stamp margin. Other caps/dependencies remain unchanged.
Final SHA-stamped builds and configured browser confirmation follow this freeze.
