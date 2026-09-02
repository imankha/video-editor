# T8220: Admin People table "Games" column is a raw event count, not real games

**Status:** WIP
**Impact:** 4
**Complexity:** 4
**Created:** 2026-08-31

## Problem

Investigating bknoto@gmail.com at the user's request: the admin People table's "Games" column
shows **15**, but the account has **1** actual game.

Root cause: `UserTable.jsx`'s `Games` column (`game_created_count`) is built in
`admin.py list_users` (~L241) as `user_actions.get("game_created", 0)` — a raw count of the
`game_created` analytics EVENT (Postgres `user_actions`), not the number of rows currently in the
account's `games` table. Same shape for the adjacent `Clips` column (see [[T8240]]).

For bknoto specifically the 15 is explained by the known T8160 upload outage (bug 47p / T8170):
9 `game_created` events on signup day + 6 more on 2026-08-31 retrying a failing upload, of which
all but one were later cleaned up (deleted pending/failed rows) — the account currently has 1
`games` row. So the metric isn't "wrong" in the sense of a bug in the count itself (it does count
`game_created` events correctly); it's **misleading as a "Games" label** because it silently
conflates "attempts" with "current inventory," and that gap gets large specifically during the
exact failure scenarios (upload retries, cleanup sweeps) an admin would most want visibility into.

**Second confirmed instance (2026-09-01), chenyh1225@gmail.com:** user asked why analytics showed
"7 games uploaded" when the account has zero games. Investigation (read-only, prod Postgres +
R2): signed up 2026-08-30 13:13 UTC, tried uploading a game **7 times in 20 minutes** across three
platforms (`webapp-mobile` x1, `pwa-desktop` x2, `webapp-desktop` x4) — every single attempt failed
(`game_upload_failed:refused` x1, `game_upload_failed:network` x6), zero `game_upload_succeeded`
events ever fired. Squarely inside the T8160 outage window (self-aborting multipart upload, live
~2026-08-30 build 2a906b5a until the 2026-08-31 fix). Her account is 100% correct — it has nothing
because nothing ever durably succeeded (her `user.sqlite` doesn't even exist in R2, 404). This is
a worse case than bknoto: 0 actual games vs. 1, so the attempts/success gap read as 100% wrong
rather than "15 vs 1."

**Second surface found, same root cause:** `PlatformBreakdown.jsx` L12 —
`ACTION_LABELS = { game_created: 'Games Uploaded', ... }` — hardcodes the label "Games Uploaded"
directly onto the raw `game_created` (attempt) event in the Platform Breakdown admin view. This is
the exact same conflation as the People table's "Games" column, in a second dashboard surface that
wasn't caught by the original T7510 attempt/outcome split (which DID fix `FunnelChart.jsx` —
"Upload Attempted" vs "Uploaded" as distinct stages — and `UserDetailPanel.jsx`, which renders both
`game_created` and `game_upload_succeeded` as a distinct pair). `UserTable.jsx` and
`PlatformBreakdown.jsx` are the two surfaces T7510 missed.

## Solution

**User directive (2026-09-01): "tries versus success is very important."** This rules out a
relabel-only fix that just renames the column to hide the attempt count (old Option A) — the
admin needs to see BOTH how many times a user tried and how many actually succeeded, not one
number that silently picks a side. Revised direction:

**Chosen shape — show both, don't collapse to one metric.** Every surface currently doing
`game_created` bare (`UserTable.jsx` "Games" column, `PlatformBreakdown.jsx` "Games Uploaded"
label) should render an attempt/success PAIR, mirroring what `UserDetailPanel.jsx` already does for
the per-user journey view and what `FunnelChart.jsx` already does for the funnel view. Concretely:

- `UserTable.jsx` "Games" column becomes something like `7 tried / 0 succeeded` (or two adjacent
  columns) instead of one bare number — sourced from BOTH `game_created` and
  `game_upload_succeeded` counts (`admin.py list_users` already has the `game_created` count;
  needs to add the `game_upload_succeeded` count alongside it, same query shape).
- `PlatformBreakdown.jsx` needs the same pairing per platform cell, not just a relabeled single
  number — likely add `game_upload_succeeded` as its own row/column next to `game_created` in the
  matrix (see `GRID_CELLS`/`ACTION_LABELS`), not just renaming the existing `game_created` row.

This is cheap on the data side: `game_upload_succeeded` is already a first-class `FLOW_EVENTS` key
with its own `user_actions` rows, no schema change, no new migration — same query shape as the
existing `game_created` lookup, just fetch both. Real per-account `games` table counts (old
Option B) are NOT needed to satisfy "tries vs success" — that distinction lives entirely in the
existing attempt/outcome analytics events already used by `FunnelChart`/`UserDetailPanel`.

Still sequence AFTER T8110 (in-flight TOP priority, reworking this same `list_users` query for
server-side sort) to avoid merge conflicts on the same function.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `list_users` (~L198-258), the `game_created_count`/
  `clip_created_count`/`export_completed_count` construction (L241-243); needs a
  `game_upload_succeeded` count added alongside. `analytics_platforms` (~L1932-) — feeds
  `PlatformBreakdown.jsx`, needs `game_upload_succeeded` surfaced per platform too.
- `src/frontend/src/components/admin/UserTable.jsx` — column definitions (L46-48)
- `src/frontend/src/components/admin/PlatformBreakdown.jsx` — `ACTION_LABELS` (L10-25) hardcodes
  `game_created: 'Games Uploaded'` (L12); second surface with the identical bug, found 2026-09-01
  while investigating chenyh1225@gmail.com

### Related Tasks
- [[T8240]] — same root pattern, "Clips" column (adjacent, likely same fix session)
- T8110 (in flight, TOP priority) — reworks this same `list_users` query for server-side sort;
  sequence this AFTER T8110 lands to avoid merge conflicts on the same function
- Bug 47p / T8160 / T8170 — why bknoto's and chenyh1225's gaps are this large (both hit the same
  2026-08-30 self-aborting-multipart outage)

### Technical Notes
Do not conflate this with the T8160 outage itself — that's a real, separate, already-tracked
incident (T8170 handles victim identification/comms). This task is about the ADMIN METRIC
DEFINITION being ambiguous, which the outage happened to expose vividly for this account.

## Implementation

### Steps
1. [ ] `list_users` (admin.py): add `game_upload_succeeded` count alongside the existing
       `game_created` count
2. [ ] `UserTable.jsx`: render both as a pair (e.g. "7 tried / 0 succeeded"), not a bare number
3. [ ] `analytics_platforms` (admin.py): surface `game_upload_succeeded` per platform alongside
       `game_created`
4. [ ] `PlatformBreakdown.jsx`: render the attempt/success pair per platform cell instead of
       relabeling `game_created` alone as "Games Uploaded"
5. [ ] Sequence after T8110 lands (same `list_users` function, avoid merge conflicts)

## Acceptance Criteria

- [ ] The People table "Games" column shows both tries and successes, never a bare attempt count
      labeled as if it were successful uploads
- [ ] Platform Breakdown shows both tries and successes per platform, never "Games Uploaded"
      bound to the raw `game_created` attempt event
- [ ] Verified against bknoto's account (15 tried / 1 succeeded) and chenyh1225's account
      (7 tried / 0 succeeded)
