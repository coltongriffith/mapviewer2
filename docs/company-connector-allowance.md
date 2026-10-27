# Company connector allowance rollout

The connector code is safe to deploy before the optional database migration.
An explicitly stored Company plan retains its Company label, but uses the existing
conservative limits of 30 map previews and 90 registry searches per hour unless
the database confirms the matching allowance capability. Free, Pro, anonymous,
account isolation and network ceilings are unchanged.

`get_company_connector_allowance()` is a read-only, SECURITY INVOKER function
installed by `20261027174653_company_share_allowance.sql` alongside the existing
`create_shared_map` correction. Its version-1 response contains the calling
`auth.uid()` as `subject`, plus numeric `previews: 200` and `searches: 600`.
PUBLIC and anon execution are revoked; authenticated execution is granted.
A missing subject returns null. The marker grants no plan or table access.

Only an already authenticated, account-scoped Company plan triggers the RPC,
using that user's bearer client. The API requires an error-free response with
the exact version, matching user ID and both exact limits. Missing functions,
RPC failures, malformed values and mismatched identities all retain 30/90.
The plan/auth cache remains 60 seconds, but this capability is checked anew on
every Company request and is never positively or negatively cached. Recovery or
rollback therefore affects the next request. An in-flight request can still meet
a concurrent rollback; `create_shared_map` remains the authoritative insert cap
and its existing rate-limit error path applies.

## Separate database activation

Code merge/deployment does not apply migrations, assign Company accounts or
activate the separate Company claim-monitoring/precedence migration. A later
production activation requires separate authorization and verification of the
installed prerequisites. Apply this complete file transactionally through the
existing migration workflow: the share-limit change and capability must become
visible together. Existing function ACLs, ownership, expiry, validation and
anonymous limits remain unchanged. Reapplying this source is idempotent; do not
rewrite production migration history to force an application.

For an authorized rollback, in **one transaction** revoke authenticated execution
on `public.get_company_connector_allowance()`, then restore `create_shared_map`
from `20261001180000_account_share_limits_by_plan.sql`. Restore neither the quota
alone nor a positive capability without its matching quota. Retain the explicit
PUBLIC/anon denial. A later reapplication of the complete correction reinstates
both the allowance and authenticated capability access together.

Local tests exercise missing/error/invalid capability responses, same-bearer
rollback and recovery during the existing plan cache, bounded 30/90 and 200/600
paths, real SQL role restrictions, rollback/reapplication, unchanged share ACLs
and anonymous/Free/Pro limits. These do not claim a production migration or
hosted account-write test.
