# State machines

This file maps the app's explicit and implicit state machines: their states, invariants and transition tables. It also lists the invalid states and transitions the code can actually reach, including through retries, overlapping requests and two tabs. It is the reference for the fixes listed below. Keep it updated when one of these machines changes.

Five areas are covered:

1. [2D editor saving](#1-2d-editor-saving)
2. [3D studio saving and opening](#2-3d-studio-saving-and-opening)
3. [Billing](#3-billing)
4. [Tenure monitor](#4-tenure-monitor)
5. [Auth, workspaces and the agent API](#5-auth-workspaces-and-the-agent-api)

Not covered: drill database imports and QAQC, the claim registry import jobs, and the internals of `local-backup-codec.js` (it has its own tests).

**How to read this.** `file:line` references in the transition tables point at commit `4d16e47`, the code as it was audited. Where a fix changed a transition, the section's "Changes from the fixes" table gives the new behaviour and the test that pins it. A finding is **confirmed** when its path was traced end to end through the client, server and SQL (and RLS where relevant). It is **reproduced** when a regression test fails on the old code and passes on the new. **Suspected** means the path depends on behaviour outside this repo (Stripe event shapes, Supabase token handling) or was not traced to the end.

## Bug register

Ranked by impact within each priority. P1 loses or corrupts user data, mis-bills, or loses a deadline reminder. P2 bypasses a limit or breaks a workflow with a workaround. P3 is low impact or cosmetic.

### Fixed

| ID | P | Finding | Fix | Regression test |
|---|---|---|---|---|
| BILL-1 | P1 | A retried or out-of-order `customer.subscription.updated` (active), or a retried `checkout.session.completed`, landing after `customer.subscription.deleted`, put the row back to Pro for free. Nothing later corrected it. | The webhook reads the live subscription from Stripe before applying a plan change. A checkout for a subscription that is no longer live grants nothing. | `tests/stripe-webhook-order.test.js` |
| BILL-2 | P1 | `customer.subscription.deleted` for an old subscription downgraded a customer who was paying for a newer one. The downgrade filtered on user and `source='stripe'`, never on the subscription id. | The downgrade only applies when the event's subscription is the row's current one. | `tests/stripe-webhook-order.test.js` |
| BILL-3 | P1 | The ledger claimed an event as `outcome 'ok'` before doing the work. A function killed mid-processing, or a failed release (supabase-js returns `{error}`, it does not throw), left the event acked as a duplicate for good. A paid checkout could then never grant Pro. | The claim is written as `failed`/`processing` and marked `ok` only after the work lands. A redelivery that finds an unfinished claim reprocesses it. | `tests/stripe-webhook-order.test.js`, `tests/billing.test.js` |
| BILL-6a | P3 | Under the pinned Basil API version `current_period_end` moved onto subscription items, so it was always stored as null. This silently disabled the admin stale-period check. | Read it from the items when the subscription has none. | `tests/stripe-webhook-order.test.js` |
| TEN-1 | P1 | A reminder whose day passed before it was sent was superseded and never caught up. Causes: a skipped cron day, an email provider outage, a pause that lifted, an admin retry. The scheduler drops past thresholds and runs before dispatch. | Keep the latest overdue reminder while its deadline is unchanged. Dispatch then sends it with the real days remaining. | `tests/tenure-alerts.test.js` (TEN-1) |
| TEN-2 | P1 | The catch-up reminder's key included the days remaining, which changes daily. With offsets [90, 30] a claim got one email every day for a month. The default [90, 30, 1] sent an extra email on the good-to-date itself. | Key the catch-up on the threshold it catches up: the smallest offset at or above the days left. The email still states the real days remaining. | `tests/tenure-alerts.test.js` (TEN-2) |
| TEN-3 | P1 | Removing and re-adding a claim, turning monitoring off and on, or a good-to-date that went null for one night: all of these left cancelled or superseded rows whose keys blocked the re-planned reminders forever. The unique index spans every status. | Revive never-sent cancelled and superseded rows when the plan wants their key again. | `tests/tenure-alerts.test.js` (TEN-3) |
| ED-1 | P1 | Autosave and a manual Save that overlapped (or a save slower than the 10 s autosave delay) sent the same expected revision. The second got `SAVE_CONFLICT`, the user was told another tab had saved, and "Save mine as a copy" made a duplicate map. | Revision-checked saves are queued per tab (`saveCoordinator.serialize`). Each reads the revision when it starts. | `tests/save-coordinator.test.js` (serialized saves) |
| ED-2 | P1 | Autosave answered `PROJECT_NOT_FOUND` by creating a new map without asking. A map deleted from the Dashboard or trashed in another tab came back. After signing out and in as someone else, the first account's map was copied into the second account. After company access was removed, a company map became a personal copy. | The workspace detaches: the edits stay open and in this browser, and Save creates a new map only when the user chooses to. | `tests/save-coordinator.test.js` (missing save target) |
| ED-3 | P2 | `restore_cloud_project` had no limit check. A free user could create 2 maps, trash them, create 2 more and restore the first 2, ending with 4. The same worked against a company's workspace limit. | A trigger applies the create check to every return from the trash, whether through the RPC or a direct update. The client shows the plan-limit message. | `tests/restore-quota-sql.test.js` |
| ED-4 | P2 | The conflict dialog's Overwrite and "Save mine as a copy" bypassed the save guard. They cleared dirty unconditionally, so edits made during the save were never saved. They could also re-point a map opened meanwhile at the copy. | Both go through `runGuardedSave` and the per-tab queue. | Same guard as ED-1. App-level path not unit tested. |
| 3D-1 | P1 | A save after the sign-in link replayed the stash as a blind upsert into the figure it came from, undoing any later saves. A failed replay left the stash behind, so it was replayed on every later `/3d` load for 7 days. | The stash carries the base version. The replay is a guarded save, so a newer save shows the conflict dialog. The tab that restores the stash owns it, and any later successful save there clears it. Old stashes without a base version are kept on screen, unattached. | `tests/three-d-signin-stash.test.js` |
| 3D-2 | P1 | The same replay dropped the figure's company home. Files went to the saver's personal folder, so no other member could open the figure again. | The stash carries the home, and the replay reattaches to it. | `tests/three-d-signin-stash.test.js` |
| 3D-3 | P2 | A save that landed while an Open failed, or a double-clicked Save, left `current.savedAt` stale. Every later save then reported the tab's own write as "saved somewhere else". | Record the new version when the figure on screen is still the one saved. Block a second save before the first await. | `tests/three-d-save-reliability.test.js` (3D-3) |
| 3D-4 | P2 | An older Open that finished after a newer one replaced that figure. Edits made to the newer figure were lost without the unsaved-changes prompt. | Only the latest Open may change the screen. | `tests/three-d-save-reliability.test.js` (3D-4) |

### Fixed in the second pass

These were open after the first pass. Each one is now fixed and pinned by a regression test that fails on the old code, except where the row says otherwise.

| ID | P | Finding | Fix | Regression test |
|---|---|---|---|---|
| ED-5 | P1 | A restored draft was paired with the browser-wide remembered revision, not the revision it was edited from. After two tabs closed in the wrong order, or a draft write failed on a full storage quota while the small revision write succeeded, the next save overwrote newer cloud content without a conflict. | The draft stores `baseRevision`, and a landed save moves it. Drafts from before the change fall back to the remembered revision. | `tests/project-storage.test.js` (draft base revision) |
| BILL-2b | P1 | Checkout trusted our row, which can lag Stripe and stores an `unpaid` subscription as canceled. Two tabs or two attempts could leave two payable sessions, so a customer could be charged twice. | Checkout asks Stripe for live subscriptions and refuses while one exists, then expires older open sessions so only the newest is payable. | `tests/stripe-checkout-duplicates.test.js` |
| TEN-4 | P2 | Change notices went out for events recorded by untrusted runs, and an untrusted run retired notices already queued. | Only events whose import run succeeded with `alerts_safe` reach an inbox, and queued CHANGE and NOT_OBSERVED rows are held, not superseded, while imports are untrusted. | `tests/tenure-alerts.test.js` (TEN-4) |
| TEN-5 | P2 | A sync dry run was recorded as a successful sync. | It is recorded with status `dry_run`, which no reader treats as a sync. | `tests/tenure-sync-promotion-order.test.js`, `tests/tenure-guards-sql.test.js` |
| TEN-6 | P3 | "Reappeared" events could never fire, because promotion zeroed `missing_run_count` before reconcile read it. | Promotion leaves the count for reconcile. | `tests/tenure-sync-promotion-order.test.js` |
| TEN-7 | P2 | A crash between the tenure upsert and the event insert lost that batch's change events for good. | Events and snapshots are written before the tenure rows move. A resume of the same run skips tenures whose events it already recorded. | `tests/tenure-sync-promotion-order.test.js` |
| TEN-8 | P2 | A direct `update ... set removed_at = null` revived tenures past the quota. Recipient checks ran on insert only, and the row lock did nothing on an empty policy. | UPDATE on memberships is limited to the columns the app edits. The recipient guard runs on insert and update under an advisory lock. | `tests/tenure-guards-sql.test.js` |
| TEN-9 | P3 | Forfeited or cancelled titles still got countdown reminders. | Known terminal wording (the rule that raises TENURE_TERMINATED) stops expiry reminders. Unfamiliar wording still gets them, so a real deadline is never silenced. | `tests/tenure-alerts.test.js` (TEN-9) |
| TEN-10 | P2 | An alert killed mid-send stayed in `sending` forever. A failed write of the `sent` status could also send it back to pending, and so send it twice. | Rows stuck in `sending` for an hour become `failed`, where admin retry can reach them. A failure to record a send no longer requeues the row. | `tests/tenure-alerts-reaper.test.js` |
| TEN-11 | P3 | Long id lists in `.in()` could fail the whole alert job. An owner lookup error was ignored, so emails said the owner was unpublished. An alert dry run changed the queue. | Lists are chunked at 200, owner errors fail the run, and a dry run skips scheduling. | Covered by the code path; no dedicated test. |
| BILL-4 | P2 | After a downgrade, tenures, portfolios, recipients and reminder offsets above the free limits kept being served. | The alert scheduler reads each owner's current limits (`tenure_plan_limits_for`) and schedules the oldest rows that fit. Nothing is deleted, and an upgrade plans the rest again. Maps and brand kits over the limit stay usable but cannot be added to; locking existing maps is a product decision, so it was not made here. | `tests/tenure-alerts.test.js` (limitPortfolio), `tests/plan-resolution-sql.test.js` |
| BILL-5 | P2 | `plan = 'company'` on an unprotected source was Company for tenures and shares but Free for maps, brand kits and live maps. | `ws_personal_map_limit` and `check_brand_kit_quota` treat Company like Pro. Live maps use the former. | `tests/plan-resolution-sql.test.js` |
| WS-1 | P2 | Share caps were counted and then inserted with no lock, so parallel calls passed together. | A per-caller advisory lock is taken before counting, in `create_shared_map` and `create_agent_share`. | `tests/workspace-races-sql.test.js` (lock order; PGlite cannot interleave two connections) |
| WS-2 | P2 | A token issued to a connected OAuth app could create a permanent API key. | Key creation refuses tokens that carry a `client_id` claim. | `tests/agent-run-races.test.js` |
| WS-3 | P2 | Two retries of a failed or stale agent run could both take it over and both create a map. | The takeover is a compare-and-swap on status and start time, and it resets the start time. | `tests/agent-run-races.test.js` |
| WS-4 | P2 | Release pack approval failed for every member except the owner after a figure was moved in from another home. | `release_pack_figures` only reads versions published in the pack's company. | `tests/workspace-races-sql.test.js` |
| WS-5 | P2 | A QP sign-off retracted by another editor was still written into a downloaded PNG. | The signed download re-reads the sign-off and refuses if it is no longer the same live one. | `tests/three-d-signoff-availability.test.js` |
| BILL-6b, 7, 8 | P3 | Basil refunds never found their invoice, a credit note could be counted twice, and same-second invoice events could regress status. | Invoices restate from the live invoice. Refunds find their invoice through Invoice Payments. | `tests/stripe-webhook-order.test.js` |
| BILL-9 | P3 | Checkout granted Pro without checking `payment_status`. | An unpaid session grants nothing on its own; the subscription update grants Pro once it is active. | `tests/stripe-webhook-order.test.js` |
| BILL-10 | P3 | A protected subscriber whose subscription ended kept its id, so checkout refused them forever. | The ended subscription is unlinked from protected rows; the plan is unchanged. | `tests/stripe-webhook-order.test.js` |
| WS-6 | P3 | A just-demoted admin could finish one last role change. Invites raced across workspaces and against an accept. Parallel key creation passed the 10-key limit. Sign-out left the invite token and failed silently offline. | Admin is re-checked after the owner lock. Invites lock per person and re-check membership. Keys are re-counted after insert. Sign-out falls back to this device and drops the saved invite. | `tests/workspace-races-sql.test.js`, `tests/auth-plan-race.test.jsx` |
| ED-6 | P2 | Migration sliced local maps to 10 and recorded itself complete. It ran in every tab, and re-pointed a map that a manual Save had already given a row. | Passes are bounded without dropping maps, run under a Web Lock per account, and re-point only the map still open from the start of the pass. | `tests/cloud-migration.test.js` |
| ED-7 | P3 | A Dashboard rename was saved back over by the open editor's autosave. | A rename bumps the revision (trigger), so another tab gets SAVE_CONFLICT. The renaming tab adopts the new revision and name. | `tests/rename-revision-sql.test.js` |

### Still open

| ID | Finding | Why it is open |
|---|---|---|
| WS-7 | The anonymous MCP per-caller allowance is keyed on identifiers the caller chooses, so the real ceiling is the 300/hour per-IP limit (`api/mcp.js:416-426`). | A design gap. Fixing it means signing session ids, which needs a server secret and a protocol change. |
| WS-8 | Deleting the last owner's auth account cascades their membership away and leaves the workspace ownerless. | No in-app account deletion exists, so this is reachable only through the Supabase dashboard. |
| ED-8 | A free user with more local maps than the plan allows retries the over-limit uploads at every sign-in. | Suspected only; the uploads fail cleanly with PROJECT_LIMIT and nothing is lost. |

### Issue groups

| Group | IDs | State | Issue |
|---|---|---|---|
| Billing webhook ordering and retries | BILL-1, BILL-2, BILL-3, BILL-6a | Fixed | 416 |
| Tenure reminder lifecycle | TEN-1, TEN-2, TEN-3 | Fixed | 417 |
| 2D editor save serialization and the map lifecycle | ED-1, ED-2, ED-3, ED-4 | Fixed | 418 |
| 3D sign-in stash and open/save races | 3D-1, 3D-2, 3D-3, 3D-4 | Fixed | 419 |
| 2D editor local drafts and migration | ED-5, ED-6, ED-7 | Fixed | 420 |
| Billing entitlements and checkout duplicates | BILL-2b, BILL-4, BILL-5, BILL-6b, BILL-7..9, BILL-10 | Fixed | 421 |
| Tenure sync trust and alert recovery | TEN-4 to TEN-11 | Fixed | 422 |
| Agent API and share limits | WS-1, WS-2, WS-3 | Fixed | 423 |
| Workspace approvals, sign-offs and roles | WS-4, WS-5, WS-6 | Fixed | 424 |

"Issue" is the GitHub issue number in this repository.

## 1. 2D editor saving

#### 1A. Workspace epoch (explicit, saveCoordinator.js)
State: an integer `epoch`. A ticket is `{epoch, stillCurrent}`.
Invariant: a completion whose ticket is stale may not touch React state.

| event | guard | to | side effects | file:line |
|---|---|---|---|---|
| switchWorkspace() | - | epoch+1 | every ticket already issued goes stale | saveCoordinator.js:23 |
| begin() | - | same | captures the epoch | :25-28 |
| runGuardedSave resolves | stale ticket | - | returns 'stale', no callbacks | :54 |
| runGuardedSave resolves | current, serialized === snapshot | - | onSaved | :55-59 |
| runGuardedSave resolves | current, serialized differs | - | onMismatch (baseline moves, dirty stays) | :55-57 |
| runGuardedSave rejects | stale / current | - | swallowed, or onError | :48-52 |

Callers of switchWorkspace: demo load App.jsx:3044, deep link :3258, open project :5070, local fork of a shared map :5144, new map :5228, conflict "Reload" :8100.
Missing: deleting the open project (App.jsx:8201) and sign-out never call it.

#### 1B. Per-tab cloud save state (implicit, App.jsx)
These pieces combine into the state:
- `user`
- `projectId` (null, a local uuid, or a cloud uuid; the code cannot tell a local uuid from a cloud one)
- `isDirty`
- `lastSavedSnapshotRef` and `lastSerializedRef`
- `projectRevisionRef`
- `saveConflict`
- `projectHome.readOnly`
- an autosave timer
- in-flight saves. These are **not tracked at all**: there is no saving flag or ref.

Derived states:
- **ANON**: `!user`. Every edit writes the local draft (250 ms). Save writes a local record.
- **CLOUD_UNSAVED**: `user && !projectId`. No autosave. Manual Save inserts a new row.
- **CLOUD_CLEAN**: `user && projectId && !isDirty`.
- **CLOUD_DIRTY_ARMED**: `user && projectId && isDirty && !readOnly`. A 10 s timer is pending.
- **SAVING(n)**: n ≥ 0 RPCs in flight. Implicit and unbounded.
- **CONFLICT**: `saveConflict != null`. A modal is shown.
- **READ_ONLY**: `projectHome.readOnly`. Autosave is off.
- **ORPHAN**: `projectId` names no row the current user can save: trashed, owned by another account, or org access revoked. Nothing in the code models this state.

Invariants the code intends:
- I1: dirty is cleared only when the saved snapshot equals the current serialization.
- I2: `projectRevisionRef` is the revision of the cloud row that the on-screen payload is based on.
- I3: a completion from another workspace never changes this one.
- I4: never silently overwrite another tab's or device's save.

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| project changes | any | not first render | dirty = serialized≠baseline | draft write after 250 ms | App.jsx:1038-1061 |
| 10 s quiet | DIRTY_ARMED | user, projectId, dirty, !readOnly | SAVING+1 | save_cloud_project(id, expected=revRef) | :1105-1124 |
| autosave ok | SAVING | ticket current | CLEAN / DIRTY | revRef = r.revision, baseline = snapshot | :1125-1128 |
| autosave SAVE_CONFLICT | SAVING | current | CONFLICT | modal opens | :1136-1143 |
| autosave "not found" | SAVING | message includes 'not found' | CLEAN on a **new row** | create_cloud_project, setProjectId(new) | :1144-1162 |
| autosave ORG_READ_ONLY | SAVING | - | READ_ONLY | - | :1132-1134 |
| manual Save | any signed-in state | !readOnly | SAVING+1 | id = projectId or null(insert), expected=revRef | :4901-4921 |
| manual ok | SAVING | ticket current | CLEAN | revRef, projectId, saveDraft, may clear the account save | :4935-4950 |
| Save As / Duplicate | any | - | SAVING+1 then a new projectId | insert | :5010-5060, :5181-5222 |
| open recent | any | openTicket current after load | CLEAN(P) | switchWorkspace, revRef = loaded, rememberCloudRevision | :5066-5112 |
| new / demo / deep link / fork | any | - | CLOUD_UNSAVED or ANON | switchWorkspace, projectId = null | :5226, :3042, :3256, :5144 |
| delete open project (Recent modal) | any | id === projectId | CLOUD_UNSAVED | **no switchWorkspace** | :8197-8201 |
| delete or rename open project from the Dashboard | any | - | **unchanged** (becomes ORPHAN / stale name) | App is not told | DashboardPage.jsx:402-403 |
| sign-out | any | - | ANON, keeping projectId and revRef | nothing reset | useAuth.js:181 |
| conflict: Reload | CONFLICT | load ok | CLEAN | switchWorkspace | :8096-8111 |
| conflict: Copy | CONFLICT | - | CLEAN on the new row | **no ticket**, dirty=false, baseline unchanged | :8117-8132 |
| conflict: Overwrite | CONFLICT | - | CLEAN | expected=null, **no ticket**, dirty=false | :8136-8148 |

#### 1C. Server row (SQL, 20261023100000:558-668)
States: ACTIVE(rev n), TRASHED(deleted_at), and implicitly gone after 30 days (restore is refused).

| event | from | guard | to | where |
|---|---|---|---|---|
| create_cloud_project | - | personal count (org_id null, not trashed) < limit (2 free) | ACTIVE(1) | :558-589 |
| save_cloud_project | ACTIVE(n) | owner (or org editor); expected null or = n | ACTIVE(n+1) | :593-636 |
| save_cloud_project | TRASHED / not owner | - | raises PROJECT_NOT_FOUND | :613-619 |
| trash_cloud_project | ACTIVE | owner / org admin | TRASHED (no longer counts toward the quota) | :639-652 |
| restore_cloud_project | TRASHED < 30 d | owner / org admin, **no quota check** | ACTIVE | :655-668 |
| renameCloudProject (plain UPDATE) | ACTIVE(n) | RLS | ACTIVE(n), **revision not bumped** | cloudStorage.js:175-182 |

#### 1D. Local persistence (projectStorage.js)
- DRAFT_KEY: one key per browser, shared by all tabs. Last writer wins.
- PROJECTS_KEY: read-modify-write inside one synchronous call, so it cannot interleave.
- `em_cloud_revisions`: projectId → revision, shared by all tabs. Written on save (cloudStorage.js:130, :152) and on open (App.jsx:5095).
- Recovery: when a record will not parse, its bytes are copied to `<key>.recovery`. The first copy wins (:119-126). Only PROJECTS and DRAFT are listed for the user (:132). A corrupt pending account save goes to `mapviewer.pendingAccountSave.v1.recovery` and is never shown.
- Boot: workspace = draft (payload, projectId), revision = rememberedCloudRevision(projectId) (App.jsx:871-872, projectStorage.js:362-377).

#### 1E. Account save intent
States: NONE, then PENDING(nonce) (queueAccountSave :317), then SAVING (resume, under a Web Lock), then NONE (statuses saved, saved-but-dirty and stale clear it, resumeAccountSave.js:13) or back to PENDING on error (kept, retried at the next sign-in).
- The tab that queued it holds `accountSaveTicketRef = {nonce, ticket}` (App.jsx:4981).
- On resume, the save is "same workspace" if the nonce matches and the ticket is still current. Otherwise it compares the payload (:4989-4991).
- The save always inserts: `id: accountSave ? null : projectId` (:4920).
- Tests cover coalescing, retry on error, and not clearing a newer nonce. I agree these are guarded.

#### 1F. Cloud migration (cloudMigration.js; driver at App.jsx:1290-1321)
- Per project: absent, then done(cloudId) or failed. The global `done` flag is set only when every job is done.
- The driver runs on each `user?.id` change. It excludes `pending.projectId`, takes `slice(0,10)` of the local projects, and adds the draft when nothing is pending and the draft has no projectId.
- When it finishes and the ticket is current, it re-points the open map to `uploaded[projectId||'draft']`.

### Changes from the fixes

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| any revision-checked save starts (autosave, Save, conflict Overwrite or Copy) | SAVING(n) | - | queued behind the save in flight | `expectedRevision` is read when the queued save starts | `saveCoordinator.serialize`, `App.jsx` |
| queued save starts | queued | ticket stale | dropped (`stale`) | nothing is sent | `runGuardedSave` |
| autosave PROJECT_NOT_FOUND | SAVING | ticket current | CLOUD_UNSAVED (detached) | `projectId = null`, revision cleared, message; **no row created** | `App.jsx` autosave |
| conflict: Copy / Overwrite | CONFLICT | ticket current | CLEAN or still DIRTY | guarded: dirty clears only if nothing changed during the save | `App.jsx` conflict dialog |
| restore (RPC or direct UPDATE) | TRASHED | active count < plan limit | ACTIVE | otherwise `PROJECT_LIMIT` / `ORG_PROJECT_LIMIT` | `ws_c_restore_quota` trigger |

New invariant I5: at most one revision-checked save per tab is in flight.

Second pass:

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| draft write | any | - | - | stores `baseRevision` = the revision the payload was edited from | `saveDraft` |
| boot with draft | page load | draft has `baseRevision` | CLOUD_* at that revision | legacy drafts fall back to `em_cloud_revisions` | `App.jsx` initial revision |
| save lands | SAVING | - | - | the stored draft's base moves to the new revision | `updateDraftBaseRevision` |
| rename (Dashboard, Recent) | ACTIVE(n) | name changed | ACTIVE(n+1) | the renaming tab adopts n+1 and the name; other tabs get SAVE_CONFLICT | `ws_d_rename_revision` trigger |
| migration pass | sign-in | Web Lock held by another tab | skipped | - | `runCloudMigrationExclusive` |
| migration pass | sign-in | lock acquired | done when every map is uploaded | at most 10 uploads a pass; re-points the open map only if it is unchanged since the pass began | `runCloudMigration` |

### Checked and already guarded

- Stale completions after open, new, demo or fork: guarded by the epoch (tests/save-coordinator.test.js:103-134).
- Edits during a save keep dirty set and re-arm autosave through the `project` dependency.
- Duplicate auth effects and two tabs resuming the account save: Web Lock plus coalescing, tested.
- A newer nonce is not cleared by an older save (clearAccountSave nonce check, :331).
- Migration retries do not duplicate projects already done within one tab (tests/cloud-migration.test.js:31-70).
- Create quota under concurrent inserts: `FOR UPDATE` plus count inside the RPC (:576-580).
- Local storage write failures are reported and never claimed as success (project-storage.test.js:58).
- Opening a project twice quickly: guarded by `openTicket` (:5071, :5089).

## 2. 3D studio saving and opening

`l.N` is a line in `src/three-d/account-core.js` at `4d16e47`.

#### 1.1 Figure/account attachment (src/three-d/account-core.js), implicit
These module variables together make up the state: `current` (null | {id,name,savedAt,home}, l.166),
`frozen` (published version on screen, l.211), `dirty`/`savedSig` (l.477/487), `busy` (l.476),
`pending` (sign-in link out for a save, l.489), `user` (l.475), `dialogMode` (l.525),
`projectEpoch` (l.160) and `authEpoch`/`authIdentity` (l.73-74).

Derived states:
- **NEW**: current=null, !frozen. Unsaved figure (sample or local work). dirty means "differs from baseline".
- **ATTACHED(clean|dirty)**: current set. savedAt is the server `updated_at` this tab last saw.
- **SAVING**: busy=true. Only the UI path sets it (doSave l.599). The API path `saveProject` never does.
- **FROZEN**: frozen set, read-only. saveProject refuses (l.277).
- **DETACHED**: current=null, dirty=true (detach l.233).
- **PENDING-LINK**: pending≠null and a shared stash exists (l.791). Edits re-stash every 1.5 s (l.745).
- **DIALOG(save-signin|signin|name|conflict)**.

Intended invariants:
- I1: `current.savedAt` equals the row's `updated_at` after this tab's last successful write. The conflict guard depends on it (l.295-301, 336-343).
- I2: a save's result is applied only if the figure on screen is still the one it snapshotted (epoch check, l.352).
- I3: `current.home` matches the row's org/property, so the file paths agree with storage RLS (l.291, 306).
- I4: the shared stash exists only while a save is waiting on a sign-in link, and is consumed once.
- I5: at most one save per figure is in flight.

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| Save click / Ctrl+S | NEW, ATTACHED | !busy && !dialog.open && !frozen && configured | (await getUser) then DIALOG(save-signin) if no user; DIALOG(name) if !current or asNew; else SAVING | busy is set only after `await getUser()` | 583-597, 599; account.js:76-79 |
| name submit | DIALOG(name) | name non-empty | SAVING (new row) | `await chosenDest()` runs before closeDialog | 768-774 |
| saveProject start | any !frozen | title ok | (in-flight) | **projectEpoch++** (fires em3d:account-context), snapshot taken | 280-287 |
| early conflict check | in-flight | guarded = existingId && !force && opened.id===existingId && opened.savedAt | CONFLICT or continue | SELECT updated_at | 295-302 |
| upload all | in-flight | – | fail: remove files, throw | upsert:false per-revision folder | 319-331 |
| commit | in-flight | guarded → UPDATE … eq(updated_at, opened.savedAt); else UPSERT | no row → CONFLICT (files removed) | trigger sets updated_at=now() (SQL 20261022 l.58-77) | 336-344 |
| commit applied | in-flight | epoch === projectEpoch | ATTACHED (current=saved, savedSig=snapshot) | result discarded when epochs differ | 352-358 |
| doSave result | SAVING | !res.active → return; pending && !dirty → clearStash | ATTACHED / unchanged | busy=false in finally | 601-616 |
| SIGNED_OUT error | SAVING | – | DIALOG(save-signin) | user=null | 610 |
| CONFLICT error | SAVING | – | DIALOG(conflict) | Overwrite → save({force}); As new; Reload → openProject | 611, 755-760 |
| openProject(id) | any | localRestore ready | ATTACHED(clean) | **epoch++ before any I/O** (l.366); epoch++ again and current set after load (l.395-397); **no check that this open is still the latest** | 364-400 |
| openProject fails | any | – | unchanged current | epoch already bumped. A failed loadProject reloads the backup | 383-393 |
| deleteProject(current) | ATTACHED | data.length | NEW | epoch++, current=null | 402-410 |
| open/close version | ATTACHED | – | FROZEN / ATTACHED (reopen) or DETACHED | epoch++ | 215-233 |
| signOut | any | – | NEW, user=null | epoch++, current=null | 150-157, 711-715 |
| auth identity change (other tab) | any | id differs from last observed | same (current kept!) | authEpoch++, epoch++ | 76-82, 93-97 |
| send link (save-signin) | DIALOG | stashWork ok | PENDING-LINK | stash = {intent,name,id: current?.id, project} (no savedAt, no home) | 786-797, 441-455 |
| em3d:change | PENDING-LINK | pending | PENDING-LINK | re-stash after 1.5 s, **even after another tab consumed the stash** | 740-746 |
| boot with stash | page load | readStash (≤7 days) | loads stash.project; signed in → SAVING via doSave(stash.name, stash.id); ok → clearStash, return (skips ?project) | unguarded upsert when stash.id is set | 805-827 |
| boot w/o stash | page load | ?project[&version] && user | ATTACHED / FROZEN | – | 828-835 |

#### 1.2 Pending-save stash (shared by all tabs: IndexedDB `em3d/kv` + localStorage fallback and flag)
ABSENT → STASHED (stashWork l.441; flag l.447) → CONSUMED (boot doSave ok → clearStash l.823; doSave in
the stashing tab when `pending && !dirty` l.603; menu Open l.687) → ABSENT. Expiry after 7 days (l.461).
Local-restore tabs never read or write it (l.444, 457, 465), and that is tested.
A failed boot save keeps the stash. No transition clears it on a later manual save in that tab, because
pending stays null there (l.826 sets it only when signed out). See 3D-1 (fixed).

#### 1.3 Auth identity (account-core.js l.73-82, 114-124)
UNOBSERVED (undefined) → OBSERVED(id|null) on the first getSession/onAuthStateChange. A different id
gives authEpoch++ and projectEpoch++. TOKEN_REFRESHED is ignored. saveProject checks authEpoch at l.290,
303 and 328. A same-user re-sign-in is tested as a no-op (local-restore-account test l.161).

#### 1.4 Local backup restore (local-backup.js)
Sender (openRestoreWindow): `waiting → binding → sending → sent → done`. Any phase goes to `stopped` on
timeout (90 s), child closed, `!isCurrent()` (reviewToken/contextEpoch/href, l.93-94; contextEpoch++ on
em3d:figure-loading and em3d:account-context, l.79) or a fingerprint change (l.109).
Receiver (receiveLocalRestore): `waiting-bind → bound → received → loaded → ready` (markLocalRestoreReady
l.147), or `failed` (l.122-126). Account features are blocked until ready (account-core l.42-44, 275,
365, 840). In that tab, start() forces savedSig=null and dirty=true (l.846-847).
Note: any save in the opener (saveProject l.280 → em3d:account-context) cancels a pending restore
review. This is conservative and not a bug.

#### 1.5 Hosted tours (SQL 20261104120000_hosted_3d_tours.sql + features/tour3d)
Row: NONE → ACTIVE(rev 1) (publish with expected=null, l.45-46) → ACTIVE(rev n+1) (expected = n, ≥10 s
since last, l.40-42) → REVOKED (package=null, l.74). The check constraint keeps package null exactly
when the row is revoked (l.13). The partial unique index allows one active row per project (l.16).
Withdraw trigger: soft delete or an owner/org change revokes (l.80-90). Publish and revoke lock the
project row FOR UPDATE (l.28, 69), so two tabs are serialized and the loser gets TOUR_STALE (409).
This is covered by hosted-tours-sql.test.js.
UI (sharingUI.js): flags `busy, ready, invalid, closed, info`. `run()` refuses while busy (l.99), which
blocks double clicks. Any auth event other than TOKEN_REFRESHED/INITIAL_SESSION → invalid (l.75, 90).
Client (sharingClient.js) pins {project, epoch, readOnly} at creation and throws CONTEXT_CHANGED when it
moves (l.16-22). Because saveProject bumps the epoch (account-core l.280), **saving the figure while the
Tour dialog is open invalidates sharing** ("Reopen the Tour dialog"). This is a UX annoyance only.
Publish sends the live preview package (studio.js l.29), not the saved row. That is by design ("Changes
in the model do not update the link").

#### 1.6 Static 3D shares (SQL 20261024100000_three_d_shares.sql)
ACTIVE → REVOKED (state cleared, l.323-339). ACTIVE → EXPIRED (anonymous, 30 days, l.198-200).
update_3d_share takes FOR UPDATE and then rejects gone rows (l.292-298). revoke is a guarded UPDATE.
In READ COMMITTED the two are serialized. No race found. Deleting a project leaves its links alone, by
design (l.58).

#### 1.7 Hole tag status (src/three-d/tags.js l.17-42), pure derivation, no transitions
Per hole, the first match wins: planned → flag column yes/no → released column → note regex →
(unset only) newest year among ≥2 distinct years, else newest campaign among ≥2. A manual override then
applies (`new|previous|planned` sets it, `none` gives null, `auto`/null deletes it, l.736-739).
States: {new, previous, planned, null}. The cache key covers hole ids and the manual map, with an
identity check on the holes array (l.70-71). Manual entries for holes that no longer exist are ignored
(l.40). No reachable invalid state found.

### Changes from the fixes

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| send link (save-signin) | DIALOG | stashWork ok | PENDING-LINK | the stash now carries `savedAt` and `home` | `account-core.js` form submit |
| em3d:change | PENDING-LINK | stash flag gone (another tab used it) | ATTACHED / NEW | `pending` dropped, no re-stash | `wire()` |
| boot with stash, signed in | page load | stash has `id` and `savedAt` | SAVING, guarded | `current` = stash attachment; `pending` set; success clears the stash, failure keeps it for this tab's next save | `boot()` |
| boot with stash, signed in | page load | stash has `id`, no `savedAt` (older stash) | NEW (unattached) | stash cleared, user told to Save as new; never written over the figure | `boot()` |
| Save click | any | `starting` or `busy` | ignored | `starting` is set before the first await | `save()` |
| saveProject commits | in-flight | epoch moved, but the figure on screen is the one saved | ATTACHED | `current.savedAt` advances | `saveProject()` |
| openProject finishes | any | a newer Open started | unchanged | throws `SUPERSEDED`, callers ignore it | `openProject()` |
| conflict: Reload | DIALOG(conflict) | open ok | ATTACHED(clean) | a pending stash is cleared | `wire()` |

### Checked and already guarded

- Open during an in-flight save keeps the new figure (test l.122). Sign-out mid-save does not reattach (l.134).
  An intervening other-tab save is rejected and its files are kept (l.166, 110). A failed upload waits for all uploads and then cleans up (l.151).
- Edits made during a save stay dirty (l.92). An account change during getUser is refused (local-restore-account l.181).
- Local-restore tab: no stash read/write and no email link. A first save is always a new row (local-restore-account tests).
- Backup restore while a save is in flight: the restore opens a separate tab. The opener is unaffected, and the review is cancelled on any
  account-context/figure-loading event (local-backup.js l.79, 94, 109).
- Hosted tour publish/publish and publish/revoke races are serialized by the project row lock, with TOUR_STALE/429 (hosted-tours-sql tests).
  UI double-click is blocked by `busy` (sharingUI l.99).
- 3D shares update vs revoke: serialized (FOR UPDATE + SHARE_GONE).
- Tag status: a pure function with stable precedence (three-d-tags tests).
Not audited in depth: local-backup-codec.js validation internals (970 lines, has its own codec tests).

## 3. Billing

#### 1.1 `user_plans` row (plan x status x source) — implicit, webhook is "single writer"
Columns: `plan ∈ {free,pro,company}` (CHECK widened in 20260801000003:48-50), `status ∈ {active,trialing,past_due,canceled,incomplete}`
(20260716000001:23-24), `source ∈ {signup,grandfathered,stripe,admin}` (:26-27), `stripe_customer_id` (unique),
`stripe_subscription_id`, `current_period_end`, `billing_interval`, `pro_since`. **No event-ordering column** (no last_event_at / version).

Initial states: signup trigger → `free/active/signup` (20260716000001:62-64); migration seed → `pro/active/grandfathered` (:50-54);
admin/company rows set by hand (`source=admin|grandfathered`, `plan=company`).

Stated invariants:
- I1 protected sources (grandfathered/admin) never downgraded or source-overwritten (webhook header :13-19).
- I2 every downgrade scoped to `source='stripe'` (:319).
- I3 (implicit, NOT enforced) row reflects the *latest* Stripe subscription state.
- I4 (implicit, NOT enforced) at most one live Stripe subscription per user; row tracks that one.

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| POST /api/stripe-checkout (no customer) | any | status∉{active,trialing,past_due} or no sub id | same plan, `stripe_customer_id` set | Stripe customer create (idem key `customer:uid`), upsert row | stripe-checkout.js:196-226 |
| POST /api/stripe-checkout | same | same | (no row change) | Checkout Session, idem key bucketed per 10 min **and per interval** | :228-246 |
| checkout.session.completed (mode=subscription, client_reference_id) | any | none on payment_status, none on event age, none on existing different sub | `pro`(or `company` if protected+company) / `active` / source kept if protected else `stripe`; sub id = session.subscription; pro_since once | upsert | stripe-webhook.js:231-262 |
| customer.subscription.updated, status active/trialing/past_due | any (matched by metadata user id, else customer id) | none on event age / sub id | `pro`(company if protected+company) / mapped status / source→stripe unless protected; sub id = sub.id; period end, interval | update | :263-307 |
| customer.subscription.updated, any other status (unpaid, canceled, incomplete, incomplete_expired, paused) | source=stripe | `.eq('source','stripe')` only | `free/canceled` | update | :52-57, :308-320 |
| customer.subscription.deleted | source=stripe | `.eq('source','stripe')` only — **no sub-id match** | `free/canceled` | update | :266-268, :311-319 |
| deleted/unpaid on protected row | grandfathered/admin | filtered out | **unchanged** (status stays active/past_due, sub id kept) | none | :319 |
| no user match | — | — | — | 200 `skipped` (ledger row kept as 'ok') | :281 |

Downstream readers of plan (all ignore `status`):
- client `resolveTier` (entitlements.js:142-150), grandfather by `created_at` (useAuth.jsx:39-66, pricing.js:57-58).
- `ws_personal_map_limit` (20261023100000:542-547) / `create_cloud_project` (:558-589): unlimited iff `plan='pro'` or source protected.
- `check_brand_kit_quota` (20260728000003:119): same rule.
- live maps (20261103110000:73-76): via `ws_personal_map_limit`.
- `tenure_plan_limits` (20261028120000:36-43): `plan='company'` first, then protected→pro.
- `create_shared_map` (20261027174653:272): `plan in ('pro','company')` → 200/h else 30.

#### 1.2 Stripe event ledger (`stripe_events`)
States: absent → claimed(row inserted with `outcome` default `'ok'`, `processed_at=now()` **at claim time**, 20260728000005:120-127) →
[success: row stays] | [handled exception: row deleted, 500] | [crash/timeout/delete-failure: row stays as 'ok' although nothing applied].

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| delivery | absent | insert ok | claimed | then process | stripe-webhook.js:210-215 |
| delivery | claimed | 23505 | claimed | 200 `duplicate` — **no processing** | :216-220 |
| ledger insert other error | absent | — | absent | 500 | :221-227 |
| processing throws | claimed | best-effort delete | absent (or still claimed if delete fails) | 500 | :395-415 |
| function killed mid-processing (timeout/OOM/deploy) | claimed | — | **claimed, outcome 'ok'** | none | (no code path) |
`outcome`/`detail` columns are never written; there is no "processing" vs "done" distinction.

#### 1.3 Checkout session (client-visible)
`/api/stripe-session` → `paid` (payment_status paid|no_payment_required AND `plan==='pro'`), `processing` (paid, plan≠pro), `unpaid`
(stripe-session.js:316-337). Client polls 4×2.5 s then settles (App.jsx:3433-3469). Note `plan==='company'` maps to `'free'` (:321).

#### 1.4 `custom_invoices` mirror
status derived from amounts (stripe-webhook.js:103-112). Ordering guard: `last_event_at`, strict `<` (:137). credit_note/refund paths do
read-modify-write without the ordering guard and unconditionally set `last_event_at=eventAt` (:358, :387).

#### 1.5 Quotas
Evaluated only at insert time (project create, brand kit insert, portfolio create, tenure add, recipient add, policy offset write).
No transition on downgrade; nothing trims or re-evaluates existing rows.

### Changes from the fixes

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| delivery | absent | insert ok | claimed (`outcome 'failed'`, `detail 'processing'`) | then process | `stripe-webhook.js` |
| delivery | claimed | 23505 and prior `outcome` is not `failed` | claimed | 200 `duplicate` | |
| delivery | claimed | 23505 and prior `outcome` is `failed` (crashed or released claim) | claimed | **reprocessed** | |
| processing done | claimed | - | `ok` / `skipped` | `processed_at` stamped | `finish()` |
| checkout.session.completed | any | live subscription not active, trialing or past_due | unchanged | nothing granted | |
| subscription.updated / deleted | any | - | from the **live** subscription status | read with `GET /v1/subscriptions/:id` (falls back to the event snapshot only without a Stripe key) | `liveSubscription()` |
| downgrade | source=stripe | row's `stripe_subscription_id` is a different subscription | unchanged | `skipped: not the current subscription` | |

New invariant I3 holds: every applied plan change reflects Stripe's present subscription state, so retried and out-of-order deliveries converge. I4 is still not enforced (BILL-2b).

Second pass:

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| POST /api/stripe-checkout | any | Stripe lists a subscription in active, trialing, past_due, unpaid or paused | refused (409) | - | `stripe-checkout.js` |
| POST /api/stripe-checkout | any | no live subscription | new session | other open sessions for the customer are expired first | |
| checkout.session.completed | any | `payment_status` not paid or no_payment_required | unchanged | Pro arrives with the active subscription update | `stripe-webhook.js` |
| subscription deleted | protected source, row on that subscription | - | plan unchanged | `stripe_subscription_id` cleared | |
| invoice events, credit note, refund | any | Stripe key configured | restated from the live invoice | refunds find the invoice through Invoice Payments | `liveInvoice`, `refundedInvoiceId` |
| plan resolution | - | plan in pro or company, or a protected source | unlimited maps and brand kits | the same rule as tenures and shares | `ws_personal_map_limit`, `check_brand_kit_quota` |
| alert scheduling | any | owner's current plan | oldest tenures, portfolios and recipients that fit; offsets the plan allows | the rest are superseded until an upgrade | `limitPortfolio` |

### Checked and already guarded

Signature + 300 s replay tolerance; duplicate event id (23505) acked without writes (billing.test.js:442); ledger released on
handled failure (:457); every Supabase error → 500; protected source preserved across checkout/update/delete incl. out-of-order
for protected rows (company-plan-webhook.test.js:92-130); subscription.updated-before-checkout source fix (:284-288, test :248);
pro_since set-once; checkout interval enum; checkout 409 for an existing live sub; session ownership check in stripe-session;
custom invoice stale-event rejection for strictly older events; useAuth cross-account plan race (auth-plan-race.test.jsx).

## 4. Tenure monitor

#### 1a. Alert instance (`tenure_alert_instances.status`, 0002:187-199)
States: pending, sending, sent, failed, superseded, suppressed, cancelled.
Identity invariant: the unique index spans **all statuses** (0002:219-228):
`(portfolio, tenure, recipient, alert_type, offset_days, coalesce(source_good_to_date), coalesce(change_event_id))`.
So once a key exists in *any* status, it can never be inserted again. Every terminal-ish status is therefore permanent for that key.

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| schedule: plan has key, no row | — | key not in `existing` | pending | insert, 23505 ignored | run.mjs:103-107, 353-369 |
| schedule: plan lacks key | pending | — | superseded | — | plan.mjs:198-201; run.mjs:127-136 |
| schedule: plan has key | suppressed | — | pending | metadata `requeued_at` | plan.mjs:203-206; run.mjs:112-125 |
| dispatch: blocked | pending (due) | `maySend` false | suppressed | `held_reason` | run.mjs:161-172 |
| dispatch: attempts exhausted | pending | attempt_count>=3 | failed | — | run.mjs:175-179 |
| dispatch: claim CAS | pending | `.eq('status','pending')` | sending | attempt_count+1 | run.mjs:261-276 |
| send ok | sending | — | sent | sent_at, message_id (update result unchecked) | run.mjs:217-224 |
| send 422 | sending | — | failed | recipient.bounced_at | run.mjs:225-233 |
| send transient / throw | sending | — | pending | last_error | run.mjs:234-255 |
| dry run | sending | — | pending | attempt reset | run.mjs:206-213 |
| remove tenure | pending | — | cancelled | — | 0003:357-359 |
| monitoring off | pending | — | cancelled | — | 20260807000001:189-193 |
| admin retry | failed, suppressed | is_admin | pending | attempt_count=0 | 0003:839-841 |
| (none) | sending | — | — | **no reaper, no admin path** | — |

#### 1b. Import run (`tenure_import_runs.status`, 0001:70-71; `promotion_started_at` 0009)
| event | from | guard | to | notes | file:line |
|---|---|---|---|---|---|
| start | — | — | running, alerts_safe=false | | db.mjs:97-100 |
| source down at the first fetch | running | — | failed | | run.mjs:113-119, 744-773 |
| headroom refused | running | — | aborted | | run.mjs:155-171 |
| guardrail ABORT | running | verdict ABORT | aborted, staging cleared | | run.mjs:271-298 |
| **dry run** | running | `--dry-run` | **succeeded, alerts_safe=false, records_processed=0** | | run.mjs:274-287 |
| targeted, nothing to do | running | no monitored numbers | succeeded, alerts_safe=true | | run.mjs:209-217 |
| promote start | running | — | running + promotion_started_at | | run.mjs:305-306 |
| promote ok (± reconcile error) | running | — | succeeded, alerts_safe = guardrail value | | run.mjs:358-382 |
| throw after promotion | running | promotionComplete | failed | staging cleared | run.mjs:406-435 |
| throw mid-promotion | running | promotionStarted | failed | staging KEPT, later resumed | run.mjs:436-457, 497-547 |
| job killed (60-min timeout) | running | — | stays running | never resumed (known, db.mjs:290-292 comment) | — |

#### 1c. Tenure registry row (implicit)
- `status` / `good_to_date` are copied straight from the source on every promotion (`row = {...tenure}`, run.mjs:576-582). There is no monotonic or status lifecycle. A null value overwrites a stored one, and a discrepancy event is recorded (changeDetect.mjs:69-71, 87-89).
- `missing_run_count`: promotion forces it to 0 (run.mjs:580). Reconcile adds 1 to rows not seen since `run_started` (0001:432-437). NOT_OBSERVED fires at exactly 2 (0001:443-447). REAPPEARED is meant to fire when a row with count>0 is seen again (0001:418-430).
- Display band: `urgencyBand(days,status)` treats a non-active status as expired (tenureDates.js:261-270). The alert planner does **not** look at status.

#### 1d. Membership / quota
`monitored_portfolio_tenures`: live (`removed_at is null`) ⇄ removed (soft). The live pair is unique (partial index, 0002:139-141).
add: advisory lock per user, count live rows, revive or insert (0008:223-283). remove: RPC sets removed_at and cancels pending alerts (0003:351-359).
Recipients: limit enforced by a BEFORE INSERT trigger only (0003:435-437).

### Changes from the fixes

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| schedule: key left the plan | pending / suppressed (EXPIRY) | `scheduled_for <= today`, same deadline still planned, latest overdue threshold for that deadline | pending (kept or revived) | dispatched today, email states real days left | `reconcileAlerts` |
| schedule: plan has key | cancelled / superseded | never sent | pending | revived instead of blocked by the unique index | `reconcileAlerts` |
| plan: every threshold passed | - | an offset >= days left exists | catch-up row keyed on that offset | stable key, sent once | `planExpiryAlerts` |

The alert identity invariant still holds: one row per key across all statuses. What changed is that a never-sent row can now return to `pending` instead of blocking its key forever.

Second pass:

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| sync dry run ends | running | - | `dry_run` | - | `tenure-sync/run.mjs` |
| promotion batch | running | - | running | events and snapshots written first; `missing_run_count` left for reconcile; a resume skips tenures already recorded | `promoteStaging` |
| membership UPDATE | live / removed | column outside the edit set (`removed_at`, `tenure_id`) | refused | - | column grant |
| recipient INSERT or UPDATE | - | invalid email, or a move onto a full policy | refused | advisory lock per policy | `tenure_recipient_guard` |
| plan expiry | - | known terminal status | no reminders | - | `planExpiryAlerts` |
| plan change notices | - | event's run not succeeded with `alerts_safe` | not planned | - | `trustedChanges` |
| schedule on an untrusted run | pending CHANGE / NOT_OBSERVED | - | pending (held) | - | `reconcileAlerts` |
| dispatch start | sending | `last_attempt_at` over an hour old | failed | reason recorded | `reapStuckSends` |
| send ok, status write fails | sending | - | sending, then failed by the reaper | never back to pending | `dispatch` |

### Checked and already guarded

- Duplicate sends from overlapping or re-fired alert runs: the CAS claim (run.mjs:261-276), the workflow concurrency group, and the unique index.
- Two sync runs at once: the `registry-db-import` concurrency group, plus the staging sweep that spares later runs (db.mjs:297-321).
- Quota race on add or create (double click, two tabs): the advisory lock (0008:228, 0008:120-ish create).
- Date boundary and DST: `bcToday` uses Intl, and `diffDays` uses UTC noon (tenureDates.js:39-58, 126-140). The cron at 15:00 UTC is 07:00/08:00 Pacific on the same B.C. day, and tests/tenure-dates.test.js covers DST. The only date-driven skip was TEN-1 (fixed).
- Resume regressing data with an older staging: any successful run sweeps older staging (run.mjs:355), and interruptedRun picks the newest failed run (db.mjs:149-158).
- A `running` row orphaned by a killed sync is already acknowledged (db.mjs:290-292, importHeadroom.mjs:51-56). The next full run heals the data, but no admin email is sent for the half-promotion. Low.

## 5. Auth, workspaces and the agent API

#### 1.1 Client auth session (src/hooks/useAuth.jsx)
States: `loading` -> `anon` | `signed_in(user, plan: unknown|free|pro|company)`; `recovering` flag is orthogonal.
Invariant: a plan answer is applied only if `request === planRequestRef.current && target.id === currentUserRef.current.id` (useAuth.jsx:31-32).

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| getSession resolves | loading | no auth event seen yet | anon / signed_in | acceptSession | useAuth.jsx:134-136 |
| onAuthStateChange(any) | any | - | per session | user id changed -> invalidatePlan, plan reset, clearProGrace if previous user | useAuth.jsx:106-118,138-141 |
| SIGNED_IN / INITIAL_SESSION | signed_in | same user after tick | - | recordSignupOnce | useAuth.jsx:122-126 |
| PASSWORD_RECOVERY | any | - | recovering=true | - | useAuth.jsx:119 |
| refreshPlan reply | signed_in(unknown) | current() | plan = row / free / pro(grandfathered) / unknown on error | grace record set/cleared | useAuth.jsx:39-93 |
| session null | signed_in | - | anon | invalidatePlan, clearProGrace | useAuth.jsx:128-132 |
| signOut() | signed_in | supabase signOut ok | anon (via event) | none locally | useAuth.jsx:181-185 |
Covered by tests/auth-plan-race.test.jsx, tests/auth-redirect.test.js (authRedirect.js strips hash/utm, apex host).

Client caches tied to session: workspace list cache cleared on every auth event except same-user TOKEN_REFRESHED (src/utils/workspace.js:167-176);
pending invite token in localStorage `em.pendingInvite.v1`, 14-day TTL (workspace.js:149-162); ReleasePackPanel reloads on `user?.id` (ReleasePackPanel.jsx:71-74).

#### 1.2 Org invite (org_invites, WS:1084-1101)
Derived states: `pending` (accepted_at null, revoked_at null, expires_at > now), `expired` (pending but expires_at <= now), `accepted`, `revoked`.
Invariants: one pending (non-accepted, non-revoked) invite per (org,email) (unique partial index WS:1100-1101); token stored as sha256 only; table has no client grants (WS:1104-1105).

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| create_org_invite | - | caller admin; owner role needs owner; email valid; org lock; 50/org/day, 100/user/day; not already member | pending | earlier pending invite for that email -> revoked; email sent (errors swallowed); returns token+link | WS:1182-1242 |
| accept_org_invite | pending | row FOR UPDATE; not revoked/accepted/expired; inviter still admin (owner for owner invites); caller email == invite email and confirmed | accepted | membership inserted or upgraded (never downgraded) | WS:1245-1302 |
| accept | revoked/accepted/expired | - | (error INVITE_INVALID / INVITE_USED / INVITE_EXPIRED) | client clears stored token for these | WS:1264-1272; InvitePage.jsx:41 |
| revoke_org_invite | pending/expired | admin | revoked | - ; returns false if already accepted (re-evaluated after accept's row lock) | WS:1304-1320 |
| time passes | pending | expires_at <= now | expired | hidden from list_org_invites | WS:1335 |
Tests: tests/workspaces-sql.test.js:109-226 (wrong account, case/confirmed email, expired/cancelled/resent, role ceilings, rate limit, voided when sender demoted).

#### 1.3 Membership / role (organization_members)
States per (org,user): none, viewer < editor < admin < owner (WS:104-124). Invariant: >= 1 owner per org; writes only through RPCs (no insert/update/delete grants, WS:296-302).

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| create_organization | none | 5/day advisory lock | owner | org row | WS:1341-1375 |
| accept invite | none / lower | see 1.2 | invite role | activity 'joined'/'role_changed' | WS:1287-1296 |
| set_member_role | r | caller admin (checked before lock); owner rows locked FOR UPDATE; owner involved -> caller owner (re-checked after lock); last owner cannot be demoted | p_role | activity | WS:1428-1468 |
| remove_member | r | self or admin (checked before lock); owner target -> caller owner; last owner cannot leave | none | activity 'removed' | WS:1470-1500 |
| auth.users delete | any | FK on delete cascade (baseline :181) | none | can drop the last owner (no guard) | baseline_schema.sql:181 |

#### 1.4 Property: status active/option/sold/dormant (free edits by editor), soft delete by admin only when empty (WS:168, 196-240, 403-430). No transition constraints on status (by design).

#### 1.5 Figure version (FV) and QP sign-off (SO)
Version: created by publish_figure_version (row lock + VERSION_STALE on expected updated_at), immutable afterwards (FV:125-150). Home fixed at publish time: org_id or owner_id (FV:86-98) - a moved figure keeps old versions in the old home (FV header :36-38).
Sign-off per version: `none -> live -> retracted`, then a new live one may be added. Invariant: <= 1 live per version (SO:38 unique partial index + advisory lock SO:96).

| event | from | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| insert | none/retracted | editor of version's org or personal owner; no live sign-off | live | signed_by/created_at stamped | SO:56-72, 91-126 |
| update(retraction_reason) | live | same writer check; reason 1..500 | retracted | all other columns restored from old | SO:97-107 |
| update | retracted | - | error SIGNOFF_RETRACTION_INVALID | - | SO:98 |
| delete | any | only cascade from version delete | - | - | SO:82-87 |
Tests: tests/figure-version-signoff-sql.test.js (double sign, retract once, immutability).

#### 1.6 Release pack (RP)
Pack: `none -> saved(items)`; items validated (<=12, unique, one results table, maps/figures live in this property) (RP:105-150).
Pack status (client, shared/releasePack.js packStatus): `not approved | up_to_date | draft (changed since approval) | blocked (missing items)`.
Approval: insert-only, immutable (RP:240-252). Guard (RP:173-237): editor; items == reviewed items; drill lock; live batch set equal; figures [kind,id,version_id,revision,saved_at] equal; recipe id equal; server copy stored.
No sign-off involvement anywhere (sign-off is optional by design, SO header line 2).

#### 1.7 Agent API key (agent_api_keys, AG) and run (agent_runs)
Key: `active -> revoked` (DELETE handler sets revoked_at, api/_lib/agent/keys.js:110-124), or `expired` when expires_at passes (never set by the API: keys are created with expires_at null, keys.js:80-86). Checked on every request (api/_lib/agent-auth.js:34) and again inside the SQL RPC (AG create_agent_project_and_share `k.revoked_at is null`).
Run per (api_key, idempotency_key): `none -> started -> ready | failed`; `failed -> started` and `started(age >= 2 min) -> started` on retry (api/_lib/agent/maps.js:37-82).

#### 1.8 Preview allowance (MCP and REST)
REST /preview: in-memory 6/h/IP (preview.js:33), check_rate_limit 3/h per IP hash (atomic upsert, 20260901000001_shared_rate_limit.sql), create_shared_map 10/h per creator key.
MCP: per-caller count read from shared_maps (api/mcp.js:595-596), anonymous network ceiling via check_rate_limit 300/h/IP (mcp.js:597-601), authoritative cap in create_shared_map (CS:55-70).

### Changes from the fixes

| event | from | guard | to | side effects | where |
|---|---|---|---|---|---|
| create share (editor, MCP, agent) | - | per-caller advisory lock held | counted, then inserted | parallel calls queue | `create_shared_map`, `create_agent_share` |
| POST agent key | - | bearer has `client_id` (OAuth app) | refused (403) | - | `keys.js` |
| POST agent key | - | more than 10 active after insert | refused (409) | the new key is revoked | `keys.js` |
| agent retry | failed / stale started | compare-and-swap on status and start time | started | start time reset | `beginRun` |
| release pack figures | - | version published outside the pack's company | ignored | - | `release_pack_figures` |
| signed PNG download | version open | sign-off no longer the same live one | refused | the bar is redrawn | `downloadSignedIfLive` |
| set_member_role / remove_member | - | caller no longer admin after the owner lock | refused | - | SQL |
| create_org_invite | - | per-person lock; member after revoking the earlier invite | refused (ALREADY_MEMBER) | - | SQL |
| sign-out | signed_in | server unreachable | anon (local) | saved invite link dropped on any account change | `useAuth` |

### Checked and already guarded

- Revoked/expired/used invite acceptance, double-accept (row FOR UPDATE, WS:1262-1272), email binding with confirmed address, inviter demoted/removed (WS:1275-1279; tests/workspaces-sql.test.js:154,219).
- Last owner: concurrent mutual demotions/leaves serialize on owner-row locks; after the wait the FOR UPDATE re-check skips demoted rows and the count is 1 -> LAST_OWNER (WS:1444-1463, 1479-1494; test :206).
- Revoke vs accept: revoke's UPDATE re-evaluates after accept and returns false (WS:1315-1316).
- Double sign-off / double retraction: advisory lock + partial unique index + EvalPlanQual on `old` (SO:38, 96-98).
- Sign-off on an older version: allowed by design; versions are immutable and the sign-off is per version id.
- Approval with unsigned / unpublished figures: sign-off is optional by design (SO header line 2); the approval stores saved_at and the client flags "edited since approval (not published as a version)" (shared/releasePack.js:88-90). Product gap only: nothing requires a live sign-off before approval.
- Stale approvals: items order, live batch set (under the drill lock), map revision/saved_at and recipe id are compared (RP:183-221; tests/release-packs-sql.test.js:91-147).
- Revoked API key: rejected per request (agent-auth.js:34) and again inside create_agent_project_and_share (AG `k.revoked_at is null`), so a request in flight when the key is revoked fails at the RPC.
- Plan resolution races and cross-account plan leakage: guarded by request counter and user id (useAuth.jsx:28-35, 106-116; tests/auth-plan-race.test.jsx).
- check_rate_limit is an atomic upsert (20260901000001_shared_rate_limit.sql), so the REST /preview 3/h limit holds under concurrency (it fails open on DB errors by design, guard.js:126-146).
- Team enquiries: admin-only status RPC, any-to-any among new/contacted/closed by design (team_enquiries.sql:175-197).
