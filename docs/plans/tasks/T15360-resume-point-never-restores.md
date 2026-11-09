# T15360: Resume where you left off never restores (exit beacon not installed, `/` rewritten before the gate)

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Tier:** S to M (frontend only, no schema change)
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Found in the staging check of PR #728 (T14980), 2026-11-09, build 7354. T14980's user-facing
behaviour does nothing: closing the tab on a play, reopening the app (same or another browser),
or signing out and back in always lands on `/home/reels`. The PR's verifier timed out, so no
criterion was checked before merge; the unit tests pass because they call the pieces directly.

Two independent causes. Either one alone stops every restore.

1. **The exit beacon is never installed.** `installResumePointExitBeacon()` in
   `src/frontend/src/utils/resumePoint.js` is exported, but nothing calls it. The only writes
   come from navigation gestures (`writeResumePoint`), which always send `left_at: null`.
   `isFreshResumePoint` in `utils/resumePointRestore.js` treats a point with no `left_at` as
   absent, so no stored point is ever restorable. Staging: hiding the page (visibilitychange to
   hidden) on `/annotate/g/1` sent no request, and the row kept `left_at: null`.
2. **The restore gate can never be true.** `App.jsx:405` restores only when
   `window.location.pathname === '/'`, but `editorStore`'s module-load canonicalization
   (around `editorStore.js:650-672`) has already rewritten `/` to `/home` by then. Staging: with a
   fresh, valid point set through the API (`/annotate/g/1`, `left_at` now), a cold load of `/`
   went `/` -> `/home` -> `/home/reels`. This is the same class of bug as T15220.

The sign-out case also needs (1) fixed differently: logout suppresses the beacon on purpose, so
the last gesture write (with `left_at: null`) is what survives. Either the restore stops
requiring `left_at` (and uses the server's `updated_at` for age, which `get_resume_point`
already enforces at 30 days), or gesture writes carry `left_at`.

## What passed on staging (no change needed)

- T14980:C3 a deep link and a payment return are not overridden by the point.
- T14980:C5 / T14990:C4 an impersonated session never changes the user's point (gesture
  write, exit, and a direct POST all leave the row unchanged).
- T14990:C2 clicking the user's email in the admin lands on the point (`/annotate/g/1?t=12`).
- T14990:C5 the banner shows "Reopen their page".

Not checked on staging: T14980:C1 playhead and Focus/Overlay-at-start, C4 deleted target (both
blocked by this bug), T14990:C1 admin detail panel, T14990:C3 same id in two profiles.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/resumePoint.js` - `installResumePointExitBeacon`, `writeResumePoint`
- `src/frontend/src/utils/resumePointRestore.js` - `isFreshResumePoint`, `restoreFromResumePoint`
- `src/frontend/src/App.jsx` - the restore gate (around line 402)
- `src/frontend/src/stores/editorStore.js` - module-load canonicalization of the cold path
- `src/backend/app/services/resume_points.py` - `get_resume_point` (30-day age check on `updated_at`)

### Related Tasks
- T14980, T14990 (PR #728): the feature this fixes
- T15220: the same module-load canonicalization bug for payment and campaign params

## Acceptance Criteria

- [ ] On staging, close the tab on a play, then cold-load `/` in a new browser context: the same
      play opens at the same playhead on Annotate, Focus and Overlay (amended 2026-11-09: T15340, in the
      same dotask group, extends the playhead restore to Focus and Overlay).
- [ ] Sign out on a play, sign back in: the same play opens.
- [ ] A point whose target was deleted lands on Home with the notice and clears the row.
- [ ] An e2e test drives the real cold load of `/` (not a direct call to `restoreFromResumePoint`),
      so the canonicalization ordering is covered.
