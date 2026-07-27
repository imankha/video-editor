# T5950: Verify the cross-machine CAS conflict path (blocked until we run more than one box)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-26
**Blocked by:** running more than one backend machine. **Not actionable today** — see below.

## Why this is parked, not forgotten

Production currently runs a **single Fly machine**. A CAS conflict requires two machines (or two
sessions on different machines) writing the same user DB, so the conflict path **cannot occur in
production as deployed**, and cannot be produced in the single-container dev stack either.

User's call, 2026-07-26: *"we are still on 1 box so I'm not worried about it."* Correct — this is
forward-looking coverage for the durability epic, not a live gap. Pick it up when we scale out.

## What is unverified

The durability epic shipped three interlocking pieces, all merged and on staging:
- **T4310** — CAS on upload (conflict → freeze/escalate/Retry, never silent clobber)
- **T4315** — restore-if-newer on write paths
- **T5870** — `pending | failed | conflict` states, and a Retry that on conflict performs
  restore-if-newer then states honestly if still refused

Every layer is unit-tested and each guard is red-verified. **What has never run end-to-end against a
real conflict is the human-facing sequence**, because no test environment can currently create one:

> two machines write the same user DB → CAS refuses the second → the user sees the conflict banner →
> clicks Retry → their local DB is replaced by the newer copy → they are TOLD their local changes
> were replaced → the page reloads so in-memory state matches disk.

That last mile is the part T5870 round 1 got wrong (it silently discarded the edit and reported
success). It is now fixed and unit-covered on both sides — but never exercised for real.

## What to do when we go multi-box

1. **Reproduce a genuine CAS conflict.** Same account, two machines (or pin two sessions to different
   machines), both writing the same profile/user DB. Confirm the second upload is refused rather than
   clobbering.
2. **Walk the whole user-visible sequence** and confirm each step:
   - conflict banner appears with the alarm copy (not the quiet "Cloud backup pending")
   - Retry is present and clickable
   - Retry performs restore-if-newer
   - **the user is told their local changes were replaced by a newer version** — this is the step
     that was silently broken; verify the persistent notice actually renders after the reload
   - the page reloads so what is rendered matches the restored DB
   - if the restore still cannot proceed, the honest refusal is shown and it does NOT loop
3. **Verify the markers.** `.sync_conflict` must not be cleared for a DB that was not actually
   confirmed (T5870 round-2 fix), and must be cleared once a later sync genuinely succeeds.
4. **Confirm no silent clobber** — the whole point of T4310. A stale machine must never force-push
   over newer cloud state.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/health.py` — `_retry_resolve_conflict` (restore-if-newer + honest refusal)
- `src/frontend/src/stores/syncStore.js` — `retrySyncToR2`, the `data.restored` branch (notice + reload), `surfaceRestoredNoticeIfPending`
- `src/frontend/src/components/SyncStatusIndicator.jsx` — banner states
- `src/backend/app/middleware/db_sync.py` — `sync_status_header`, marker lifecycle
- `src/backend/app/storage.py` — CAS + the T5920 checkpoint guard

### Related
- **T4310** CAS upload · **T4315** restore-if-newer · **T5870** pending/failed/conflict + honest Retry · **T5920** WAL checkpoint-or-refuse
- Durability epic: `tasks/durability-sync/EPIC.md`
- Session-pinning work also gates other deferred items (see the fire-and-forget deferral)

## Acceptance Criteria

- [ ] A genuine cross-machine CAS conflict is reproduced (not simulated/mocked)
- [ ] The second writer is refused — no silent clobber of newer cloud state
- [ ] The conflict banner shows the alarm state, not the quiet pending state
- [ ] Retry restores the newer copy AND the user is explicitly told their local changes were replaced
- [ ] The page reloads so rendered state matches the restored DB
- [ ] An unresolvable conflict shows the honest refusal and does not loop
- [ ] `.sync_conflict` is never cleared for a DB that was not confirmed; is cleared on genuine success
