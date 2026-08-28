# T7970: Upload failures are almost never recorded — "Upload Success" is 100% by construction

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

Found during a user-requested audit of the admin dashboard (2026-08-28) — the user flagged
"UPLOAD SUCCESS 100% (2/2 succeeded)" as implausible since they personally know of failed uploads.

Root cause: the read side is correct (`admin.py:1650-1651, 1680-1681, 1711-1715` computes
`succeeded / (succeeded + failed)`), but the **write** side almost never fires. `game_upload_failed`
is emitted from exactly one place in the entire backend — the stale-pending-upload reaper
(`games_upload.py:610-613`), always with `reason="user_abandoned"`, and ONLY when a user later
re-hits `GET /pending-uploads` on a row old enough to reap. Every actual in-flight failure (R2
error, network abort, validation rejection, finalize crash) writes **nothing**. Meanwhile every
success does log (`games_upload.py:410`, `game_upload_succeeded`). The denominator is therefore
success-only by construction — 100% is mathematically guaranteed regardless of the real failure
rate. `analytics.py:196-203` already defines the reason taxonomy (`timeout/network/refused/
sync_failed`) that no code path currently emits — the shape exists, the call sites don't.

This is the most consequential of the four audit findings: the team is currently blind to real
upload reliability, which directly affects trust in decisions like T7610's stuck-user outreach
(which explicitly assumes "bug fixed, retry" copy is accurate) and any future reliability work.

## Solution

Add `record_milestone(user_id, "game_upload_failed", reason=<taxonomy>)` calls at the actual
failure sites in the upload path, not just the abandonment reaper — R2 upload errors, chunk/
network aborts, validation rejections, and finalize-step crashes. Reuse the existing reason
taxonomy in `analytics.py:196-203` (`timeout/network/refused/sync_failed`) rather than inventing
new reason strings; add a taxonomy value only if none of the existing ones fit a given failure
mode. Preserve the existing `user_abandoned` reaper path unchanged — it's a real failure category
(prepared-but-never-finished), not being replaced.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games_upload.py` — upload path; success emission at line 410, reaper
  failure emission at line 610-613; find and instrument the actual failure branches (R2 error
  handling, chunk validation, finalize exception paths)
- `src/backend/app/analytics.py` — `record_milestone`, `MILESTONE_REASONS` taxonomy (lines
  ~196-203), `FLOW_EVENTS` config (~175-176)
- `src/backend/app/routers/admin.py` — read side is already correct (lines 1573-1577,
  1650-1651, 1680-1681, 1711-1715); no changes expected here beyond verifying the new events roll up

### Related Tasks
- Sibling bugs from the same audit: T7960 (viral %), T7980 (channels cartesian join), T7990
  (stat-tile day-boundary mislabel)
- T7610 (stuck-user outreach) assumes upload reliability claims are accurate — this task is the
  evidence gap behind that assumption

### Technical Notes
- Check `daily_counters.game_uploads_failed` rollup wiring once new failure reasons are emitted —
  confirm it increments correctly for non-`user_abandoned` reasons (existing tests in
  `test_analytics_dashboards.py:208-221` and `test_analytics.py:322-423` already cover the
  `reason=` suffix mechanism; extend rather than duplicate).
- Per CLAUDE.md: no reactive/defensive persistence — each new `record_milestone` call must trace to
  a real failure event (the gesture/error itself), not a periodic sweep guessing at failures.

## Implementation

### Steps
1. [ ] Audit `games_upload.py` (and any R2/Modal client error paths it calls into) for every place
       an upload can terminate without success
2. [ ] Add `record_milestone(..., "game_upload_failed", reason=...)` at each real failure site,
       reusing existing taxonomy values where they fit
3. [ ] Extend existing analytics tests to cover the new failure call sites (not just the reaper)
4. [ ] Verify `daily_counters.game_uploads_failed` increments for the new events

### Progress Log

**2026-08-28**: Filed from admin dashboard audit (code-expert agent finding).

## Acceptance Criteria

- [x] A simulated R2/network/validation upload failure produces a `game_upload_failed:<reason>`
      row, not silence
- [x] Admin "Upload Success" card reflects a real denominator (successes + all failure types, not
      just abandonment)
- [x] Existing `user_abandoned` reaper behavior unchanged
- [x] Tests cover at least one non-reaper failure path end to end
