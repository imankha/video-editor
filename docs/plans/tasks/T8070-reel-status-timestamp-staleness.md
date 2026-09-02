# T8070: Reel status should go stale when the clip's timestamps change

**Status:** STAGING
**Impact:** 4
**Complexity:** 5
**Created:** 2026-08-30 (deferred from T8060 per user decision: "Skip for now but file task for it")

## Problem

T8060 shows the linked reel's stage (Focus/Overlay/Completed/Published) on a
clip's Reel control. But if the clip's `start_time`/`end_time` change after
the reel was produced, the produced working_video/final_video still reflects
the OLD footage window -- it's "essentially a different clip" now, per the
user. The Reel control should stop showing the (now stale) produced status
in that case, and resume showing it again if the timestamps are changed back
to EXACTLY the values that produced the existing reel.

## Investigation (2026-08-30, before deferring)

Checked whether any existing data could answer "does the linked reel still
reflect this clip's current start/end time":

- `GET /projects/{id}/clips` (`WorkingClipResponse.start_time`/`end_time`,
  `clips.py`) is **live-joined from `raw_clips`**, not a stored snapshot --
  confirmed at `clips.py` lines ~199-200, ~1581-1582, ~1653-1655. So the
  project's clip view always reflects the CURRENT raw_clip boundaries; there
  is no existing place recording what window the actual exported
  working_video/final_video files were rendered from.
- `_create_auto_project_for_clip` (`clips.py:1021`) only copies dims
  (width/height/fps) via `_insert_working_clip_with_dims` -- it does NOT
  snapshot start_time/end_time anywhere.
- The existing `raw_clips.boundaries_version` / `working_clips.raw_clip_version`
  mechanism (`.claude/knowledge/annotate.md`, "T4340") is a MONOTONIC
  version counter bumped on any start_time/duration change -- it can detect
  "something changed since X" but cannot detect "changed and then changed
  back to the same value," which is explicitly required here (revert should
  restore the reel reference).

**Conclusion:** satisfying the exact requirement needs a genuine value
snapshot, not the existing version counter. Presented this tradeoff to the
user; they chose to defer rather than pick the counter-only shortcut.

## Solution (proposed, not yet approved by Architect)

- Add two new nullable columns, e.g. `raw_clips.reel_source_start_time REAL`,
  `raw_clips.reel_source_end_time REAL` -- the start/end time the clip's
  CURRENTLY-linked reel's most recent successful export actually used.
- Write sites (3): `_create_auto_project_for_clip` (seed from the raw_clip's
  current start/end at reel-creation time), the Focus export success path,
  and the Overlay export success path (refresh to current start/end each
  time a new export actually completes against them).
- Do NOT touch these columns from `update_raw_clip`'s boundary-change path --
  they represent "what the existing artifacts were built from," which stays
  fixed until the NEXT successful export, independent of how many times the
  user edits the clip's boundaries in between. This is what makes reverting
  to the exact original values naturally restore validity (a pure value
  comparison, not a version bump).
- Frontend: `ClipDetailsEditor`'s stage lookup additionally compares
  `region.startTime === linkedProject.reel_source_start_time &&
  region.endTime === linkedProject.reel_source_end_time` (fields need adding
  to the project list/detail response) before showing the Focus/Overlay/
  Completed/Published states; a mismatch falls back to "Create Reel" (the
  autoProjectId itself is untouched in the DB -- this is a display-level
  reset, not a deletion).

## Context

### Relevant Files (anticipated)
- `src/backend/app/migrations/user_db/` or `profile_db/` -- new migration
  for the 2 columns (confirm correct track/schema location first)
- `src/backend/app/routers/clips.py` -- `_create_auto_project_for_clip`,
  Focus export success path
- `src/backend/app/routers/export/` (Overlay export success path -- exact
  file TBD, needs a fresh look at export completion handlers)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` -- stage
  comparison gains the timestamp-match check

### Related
- T8060 (the stage-aware Reel control this extends)
- `.claude/knowledge/annotate.md` T4340 section (`boundaries_version` /
  `raw_clip_version` -- the existing, insufficient-for-this mechanism)

## Tier note

Touches schema (new columns + migration) and 2+ backend export completion
paths + frontend -- classify as L-tier per CLAUDE.md (schema change -> full
staged workflow, Architect design gate) when picked up.

## Progress Log

**2026-09-01/02**: Design approved with revisions - Q1 (NULL policy) changed from
self-heal to a BACKFILL migration (no runtime trust-produced fallback, per "migrations
make data correct"); Q2 expanded scope to multi-clip per-clip staleness (data layer only,
via `WorkingClipResponse`); Q3/Q4 confirmed as proposed. A new blocker (Q5) surfaced
during the Q2 investigation - no UI surface exists today for multi-clip per-clip
staleness (annotate only shows the seed clip) - resolved as **Option A**: ship the full
data model + annotate seed-clip display now, file the multi-clip visual as a separate
follow-up (see [T8350](T8350-multiclip-reel-staleness-visual.md)).

Implemented: `raw_clips.reel_source_start_time/end_time` (profile_db v049) with a
backfill for every already-produced reel clip (no unknown-snapshot cohort); 5 write
sites (seed + Focus x2 + Overlay x2); both read surfaces (annotate region + per-clip
`WorkingClipResponse`); frontend staleness gate in `ClipDetailsEditor`.

Branch CI went red twice, both real issues, both fixed:
1. v049's backfill crashed (`no such table: working_clips`) against a profile at an
   older/minimal schema state (surfaced by share-materialization tests) - added a
   table-existence guard so it degrades gracefully instead of crashing the JIT seam.
2. `test_registry_head_is_audited` (T6030 structural guard) required bumping
   `HEAD_VERSION_AUDITED` to 49 and confirming the new columns' hot reads are guarded -
   done.

CI green (`feature/T8070-reel-status-timestamp-staleness`). Full-browser Playwright
drive not possible in-container (no network egress); covered instead by FastAPI
TestClient + React Testing Library component tests exercising the real HTTP routes and
the real Completed<->Create Reel toggle. Awaiting user test + merge.

## Acceptance Criteria

- [x] Reel control stops showing produced status when the clip's start/end changed after
      the reel was produced
- [x] Reverting timestamps to EXACTLY the producing values restores the status
- [x] Schema tracks reality for existing reels too (backfilled, no NULL/self-heal cohort)
- [x] Multi-clip reels: per-clip data available via `WorkingClipResponse` (visual cue is
      the separate T8350 follow-up)
- [x] Backend + frontend tests pass (61 + 15 green); full-browser e2e not runnable in
      this container (documented, not claimed)
