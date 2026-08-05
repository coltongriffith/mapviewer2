# Tenure Monitor — help

Monitor your B.C. mineral tenure portfolio, catch approaching deadlines,
identify title changes, and connect every claim directly to Exploration Maps.

---

## What Tenure Monitor does

You add the B.C. mineral tenures you care about. Exploration Maps then:

- shows how many days remain until each claim's good-to-date
- emails you before each deadline
- flags changes it detects in the government record — a moved good-to-date, a
  status change, an ownership change, a redrawn boundary
- keeps your notes, your maintenance decision, and a record of who decided what
- opens any claim, or your whole portfolio, in the Exploration Maps editor

**What it does not do.** Exploration Maps is not the title registry and cannot
act on your titles. It will never log into Mineral Titles Online for you, file
assessment work, pay cash in lieu, register a transfer, or acquire ground. It
reads public information and reminds you. Everything that changes a title
happens in MTO, by you or someone you authorise.

---

## What a good-to-date means

The **good-to-date** is the date by which a claim must be maintained — through
recorded assessment work or a cash payment in lieu — to stay in good standing.
It is the province's date, published in the public tenure dataset, and it is the
date Tenure Monitor watches.

**Days remaining** is counted in Pacific time, because a B.C. deadline is a B.C.
deadline wherever you happen to be reading from. If you check your portfolio at
breakfast in London, you will still see British Columbia's date.

Where the province publishes no good-to-date for a title, we show *"Date
unavailable — verify in MTO"* rather than a number. We would rather tell you we
don't know than invent a countdown.

The same applies to the handful of records where the province has left a
placeholder date in the feed. We treat those as no date rather than counting
down from 1900.

---

## Applications are marked as applications

The B.C. dataset publishes **applications alongside granted titles**, in the
same feed and with the same columns — about 2,500 of them at the time of
writing. Anything the province publishes as an application carries an
**Application** tag in the table, in search results and on the claim panel.

This matters because an application is not held ground. The date shown on one
comes from the same government column as a granted claim's good-to-date, but it
is **not a confirmed maintenance deadline**, and the reminder email for an
application says so rather than telling you a claim is about to lapse.

**What we don't show, and why.** This dataset publishes no application status,
no stage, no expected decision date and nothing about consultation. So Tenure
Monitor shows none of those. We would have to guess, and guessing about where a
title application stands is not something you should be reading off a map
product. Check MTO.

---

## Groups of claims

A portfolio is a **group of claims** — a project, a region, a joint venture, or
just "everything we hold". Each group has its own reminder settings, its own
recipients, its own map and its own CSV export, so a reminder about your Cariboo
ground doesn't arrive mixed in with the Golden Triangle.

Use **New group** in the header to start another, and the picker beside it to
switch. Free plans keep one group; Pro keeps several.

---

## Watching ground you don't own

A portfolio is a watch list, not an ownership record. You can monitor **any**
registered B.C. title — a competitor's ground, a property you are evaluating, a
block next to your own — using exactly the same portfolios, groups and reminders
as your own claims. Search by registered owner, select the titles, add them.

Nothing about doing so is visible to the title holder, and nothing about it
changes the title.

---

## Adding claims

Six routes, because claim records live in different shapes:

| Method | Best for |
|---|---|
| **Tenure number** | You know the number. Most reliable. |
| **Several numbers** | Paste a list — commas, spaces or one per line. |
| **Registered owner** | Finding a company's titles. Returns candidates to confirm. |
| **Client number** | If the province publishes one for your titles. |
| **Map extent** | Everything inside a bounding box. |
| **Upload CSV** | An existing claim schedule from anywhere. |

### Owner search returns candidates, not conclusions

Company names reach the registry in clipped legal form, with abbreviations,
subsidiaries, previous names and joint-venture partners. So an owner search
shows you what it found, grouped by how confident the match is, and **you**
choose which titles belong in your portfolio. Only an exact name match is
pre-ticked. Adding a title you don't hold would put someone else's deadline on
your dashboard — and push yours further down it.

### CSV upload reports every row

Recognised columns: `tenure_number`, `claim_name`, `owner_name`, `project_name`,
`internal_notes`. Any combination works; a tenure number gives the most reliable
match.

Every row comes back in one of seven states — matched, several possible matches,
not found, found but not in good standing, duplicate, already monitored, or
unreadable — with its line number. Nothing is discarded quietly. If four rows
don't match, you will see which four, because those are the claims nobody would
otherwise be reminded about.

---

## When reminders are sent

By default, before each claim's good-to-date:

- **Free plan** — 90, 30 and 1 day
- **Pro** — 90, 30, 7 and 1 day

The final one-day reminder is on every plan, free included. Going quiet the day
before a deadline is the failure this feature exists to prevent, so it is not
something we hold back for a paid tier.

Reminders go out in the morning, Pacific time. Each one names the tenure number,
the claim, the registered owner, the good-to-date, the days remaining, your
recorded decision, and when we last received government data. It links you
straight to the claim, to the map, and to MTO.

**If the province moves a good-to-date**, the reminders for that claim are
recalculated automatically and the outdated ones are cancelled — you will not be
reminded about a deadline that no longer exists.

**You will not receive the same reminder twice.** That is enforced in the
database, not by a check we hope runs.

**If you add a claim that is already close to its deadline**, you get one
reminder straight away, stating the real number of days left.

Turn reminders off for an individual claim from its detail panel; it stays in
the portfolio and keeps its history.

---

## Why you still need to verify in MTO

Exploration Maps holds a **copy** of the public B.C. tenure dataset, refreshed
several times a day. It is not the registry, and it is not live. Between our
last successful sync and now, anything could have changed.

Every screen shows exactly when we last received government data, and every
claim has a **Verify in MTO** link. Before you act on a deadline — file work,
pay in lieu, let something lapse, or buy anything — check the official record.

> Government title records and Exploration Maps monitoring results should be
> verified in the official Mineral Titles Online registry before a transaction
> or deadline decision.

A reminder from us is a reminder. It is not legal notice, and government records
control.

---

## What "not in the latest dataset" means

Occasionally a monitored title stops appearing in the published data. When that
happens across two consecutive successful imports, we tell you:

> This title was not present in the latest successful dataset. Verify its status
> in MTO.

**This is not confirmation that anything happened to your claim.** A record can
drop out for several reasons, including a delayed or partial publication at the
province. It is a prompt to go and look, nothing more. We wait for two clean
imports before saying even this, precisely so a bad night at the province does
not turn into a false alarm about your ground.

---

## Recording what you intend to do

Each claim carries a maintenance decision:

- Undecided
- Review required
- Intend to maintain
- Intend to allow lapse
- Maintenance completed
- Needs official verification

Plus an internal project name, private notes, a target decision date, and a
reference note for after you've filed in MTO.

**Never put an MTO password or any other credential in these fields.**
Exploration Maps does not connect to your MTO account and never will.

Every decision change, note edit and acknowledgement is recorded with who made
it and when, in the **Activity** tab. That is the record for anyone who later
asks why a claim was handled the way it was.

---

## Opening claims in Exploration Maps

From the detail panel, or **Open in Exploration Maps** for everything currently
filtered. Claims arrive as an ordinary map layer, so every editor tool works on
them — styling, labels, callouts, legend, templates, brand kits, and exports.

Turn a live claim portfolio into a presentation-ready project map.

If you later re-open a saved map whose claim boundaries the province has redrawn
since, the map tells you so and names the affected tenures. Re-import the layer
to refresh the outlines.

---

## Exporting a claim schedule

**Export CSV** downloads whatever the current filters show: tenure number, claim
name, registered owner, project, type, status, area, issue date, good-to-date,
days remaining, urgency, your decision, notes and reference.

The file includes the date it was exported and when the government data was last
synchronized — a spreadsheet gets forwarded and read months later, so the
caveats travel with it.

---

## Stopping monitoring

**Stop monitoring** on any claim cancels its scheduled reminders. Your notes and
decision history are kept, so re-adding it later restores them.

To pause reminders for a claim without removing it, untick *Send reminders for
this claim* in its detail panel.

---

## If government data is unavailable

Tenure Monitor is built so a bad day at the province cannot damage your
portfolio.

- A failed or partial import **never replaces** the data we already hold. Your
  portfolio keeps showing the last good dataset, with an honest timestamp.
- **Change notices are held back** when an import looks incomplete, so you don't
  get a wave of alarms about changes that may not have happened.
- **Deadline reminders still go out**, because a good-to-date we read from a
  successful import doesn't become wrong just because a later sync failed. Going
  quiet about a real deadline would be the worse outcome.
- If we haven't had a successful sync in over two days, every screen says so.
- During a known data problem, a banner appears across Tenure Monitor.

---

## Plans

| | Free | Pro |
|---|---|---|
| Monitored B.C. tenures | 10 | 50 |
| Portfolios | 1 | Several |
| Reminder thresholds | 90, 30, 1 days | 90, 30, 7, 1 days |
| Alert recipients | 1 | 2 |
| Claim table and portfolio map | ✓ | ✓ |
| CSV claim schedule | ✓ | ✓ |
| Open claims in the map editor | ✓ | ✓ |
| Clean, high-resolution map exports | — | ✓ |

Selecting more claims than your plan monitors adds what fits and tells you
exactly how many were left out.
