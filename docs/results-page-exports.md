# Results table images and PDF

In a property's Results section, select **Page images (PNG / ZIP)** or **Printable pages (PDF)**, then Download. Both include the current recipe's calculated intervals, inclusion rows, saved/unsaved status, data limitations and recipe notes. They use the same `resultsTableSnapshot` as HTML and Excel; no grades are recalculated and no approval status is added.

Pages are US Letter landscape at 144 dpi (1584 x 1224 pixels). One image downloads as PNG; multiple images download together in a ZIP, numbered in reading order. PDF embeds the identical page images in a single document. PDF text is therefore not selectable/searchable; use HTML for accessible text or Excel/CSV for reuse. There are no remote fonts, images or user HTML. Text is drawn literally with the browser's Arial/sans-serif fallback.

Each page repeats the property/recipe heading and page count. Table pages repeat column headings. Tables with more than four grade columns use labelled column groups; every group repeats hole ID, type, from/to/length and interval wording. Results remain in canonical order, and rows never split across pages. Notes and warnings wrap across pages; the footer reminds readers to retain them with the results.

Page exports stop with a visible HTML/Excel fallback if a result row or heading cannot fit, a cell exceeds 32,768 characters, the table exceeds 10,000 rows/70 columns, or the layout exceeds 100 pages. Nothing is silently truncated. Image memory is released between pages. PNG data is already compressed, so the existing ZIP writer stores it without recompression. The button shows progress and blocks repeat clicks while exporting.

The layout and writer are lazy (~2.9 KiB gzip in addition to the Excel slice); existing jsPDF and fflate dependencies are reused. Editor, claims, homepage and 3D startup budgets remain unchanged. No database, map renderer, existing map export, production migration or data changes.

Validation uses entirely synthetic fixtures, never Tower drill locations. Pure layout tests cover exact formatted values/wording, inclusion rows, long IDs, Unicode, 1,000 holes, 13 grade columns, metadata/notes and capacity refusals. Browser checks exercise actual PNG/PDF/ZIP downloads on desktop and phone, including saved/unsaved recipes, a wide 60-hole table, page sizes/counts and preservation of the last hole and notes. Rendered PDF pages are also visually inspected. These checks do not establish availability of real Tower artwork.
