# T8220: Admin People table "Games" column is a raw event count, not real games

**Status:** TODO
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

## Solution

This needs a decision before implementing (precedent: T7990 chose relabel-only after the founder
judged the underlying computation acceptable) — two real options, not a foregone conclusion:

**Option A — relabel to match what it measures.** Rename the column (e.g. "Game Attempts" or
"Uploads Started") so admins read it correctly without any new data cost. Cheapest, but doesn't
give admins the "how many games does this account actually have" signal they clearly wanted here.

**Option B — make it a real count.** Change the column to `SELECT COUNT(*) FROM games` per
account. The `list_users` table currently sources ALL its per-user numbers from ONE cheap
Postgres `user_actions` aggregate query across every user on the page — a real per-account SQLite
`games` count means opening each account's `profile.sqlite` (a materially different cost model,
same shape as the per-profile reads `UserDetailPanel`'s T7860 clip-phases endpoint already does,
but that endpoint runs for ONE user on demand, not N users per page load). Needs an Architect
look at whether this belongs in the list (cost at scale) or should stay a User Detail Panel-only
metric, especially given T8110 (in flight) is already reworking this table's sourcing for
server-side sort.

Recommend: bring both options to the user with T8110's sourcing rework in mind before picking,
since doing this alongside T8110 avoids two separate passes over the same `list_users` query.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `list_users` (~L198-258), the `game_created_count`/
  `clip_created_count`/`export_completed_count` construction (L241-243)
- `src/frontend/src/components/admin/UserTable.jsx` — column definitions (L46-48)

### Related Tasks
- [[T8240]] — same root pattern, "Clips" column (adjacent, likely same fix session)
- T8110 (in flight, TOP priority) — reworks this same `list_users` query for server-side sort;
  sequence this AFTER T8110 lands to avoid merge conflicts on the same function
- Bug 47p / T8160 / T8170 — why bknoto's specific gap is this large

### Technical Notes
Do not conflate this with the T8160 outage itself — that's a real, separate, already-tracked
incident (T8170 handles victim identification/comms). This task is about the ADMIN METRIC
DEFINITION being ambiguous, which the outage happened to expose vividly for this account.

## Implementation

### Steps
1. [ ] Present Option A vs B to the user (post-T8110) with a recommendation
2. [ ] Implement the chosen option
3. [ ] If Option B: verify page-load cost at realistic row counts (same class of check T8110's
       row calls out)

## Acceptance Criteria

- [ ] The "Games" column no longer silently reads as "current games" when it means "attempts" (or
      the column is changed to genuinely mean "current games")
- [ ] Verified against bknoto's account: displays either an honest "15 attempts" or an accurate "1"
