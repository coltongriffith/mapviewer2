# QA/QC import and register

Open **QA/QC register** in a property's **Drill data** tab. Existing assay and
collar imports stay separate. The screen opens deliberately and loads its
parser and interface only when needed. It provides records and provenance, not
QA/QC charts, pass/fail judgments or scientific approval.

Editors can import CSV/tab-separated files or choose an Excel `.xlsx` sheet
and header. Choose **CRM definitions** before standards; import routine samples
before their duplicates. Explicitly review the column mapping, sample type,
laboratory, stable lab job identifier, element names and units. Laboratory/job
and sample type can be specified for a whole file when their columns are not
mapped. A mapped but blank cell does not silently fall back to a constant.

The first three mapped rows provide a value/identity preview. The server then
checks the entire request before **Commit QA/QC import** appears. Changing the
file or mapping invalidates that preview. Uncertain commit retries retain the
same UUID and exact request. A recorded prior commit is reported as confirmed;
a rolled-back attempt is explicitly not restored. **Review again** starts a
fresh preview. A later refresh failure does not erase a confirmed write message.

Reported strings, units and below-detection flags are preserved by the strict
mapper described in `drill-qaqc-import.md`. Missing, negative or over-range
values cannot silently become measurements. No coordinates or Tower records
are invented. Optional parent/CRM/interval mappings are under a closed detail
section to keep routine imports concise.

The active sample/CRM register and import history use bounded 25-row pages with
stable UUID and timestamp tie-breakers. Samples show original reported strings,
not substituted detection-limit values. Full record details retain the source
batch and submitted row order. This order is not a worksheet line or sampling
date. CRM definitions retain the supplied expected value, SD and source.

History shows filename, file SHA-256 and Excel sheet/header metadata. The server
also retains bounded mapping choices and the exact request fingerprint. Physical
source lines are used for current validation only; a 5,000-row line array is not
stored in the 16 KiB provenance object. Original files are not automatically
attached; retain them in the property data library. Assay-batch certificate links
do not yet apply to QA/QC batches.

Viewers can inspect records and history but see no import or rollback controls.
Editors can roll back an import without deleting its history. Visible dependent
batches disable an unsafe rollback; the server also checks dependencies outside
the displayed page and returns a useful error. Property navigation resets file,
preview and request state, and late responses cannot populate another property.

## Deployment and verification

This UI depends on the separate QA/QC foundation migration. No new migration is
included or applied by this UI change. If that schema is unavailable, the panel
shows a clear message and ordinary drill imports keep working. Production
database changes still require the owner's authorization.

Tests cover the real mapper, cursor construction/bounds, preview invalidation,
stable retries, rolled-back attempts, property navigation, read-only access,
missing schema and confirmed writes followed by refresh failure. Desktop/phone
browser tests use the actual built application with an isolated synthetic
Supabase fixture: CRM CSV, routine Excel with BDL, standard/duplicate CSV,
uncertain retry, dependent rollback and unavailable schema. These are not claims
of testing an applied production database. Foundation SQL/security tests remain
the authority for actual database permissions and dependency behavior.
