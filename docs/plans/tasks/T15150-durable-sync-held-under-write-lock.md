# T15150: Finalize and activate hold the per-user write lock across a durable R2 sync, so uploads finishing together queue

**Status:** WAITING ON USER (live two-finish test on the dev stack, then the merge call; branch pushed, CI run 42109792880 on dfe0d49a8)
**Impact:** 5
**Complexity:** 6
**Tier:** L (persistence design, expert first)
**Created:** 2026-11-05
**Updated:** 2026-11-05
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Live Playwright run on the T15130/T15080/T15090/T15140 branch (HEAD a02d04128, 2026-11-05). T15090 took the pending-sync retry off the lock; this is what remains.

## Problem

`POST /api/games/finalize-upload` and `POST /api/games/{id}/activate` await a durable R2 sync inside the per-user write lock (`Depends(durable_sync)`, T4050). That sync is 2-5 s of the hold, so a second upload finishing at the same moment waits for the whole of the first.

Measured with two new games uploaded at once through `uploadGame` (dev stack, real R2, one run):

| Request | Total | Handler | Sync | Lock wait |
|---|---|---|---|---|
| finalize, alone (5 runs) | 3.7-4.6 s | 1.6-2.2 s | 2.0-2.5 s | none |
| finalize, overlapping | 6.7 s | 1.7 s | 2.4 s | 2.5 s |
| activate, game 1 | 6.3 s | 1.6 s | 2.2 s | 2.4 s |
| activate, game 2 | 8.9 s | 1.5 s | 5.1 s | 2.2 s |

The user sees "Finishing up" for 6.1 s and 8.3 s. The branch limit was about 6 s for finalize, and the target was no lock wait above 2 s. A prepare that arrives as a finalize starts waits for the whole hold too (1.6-1.8 s in the same run).

This only appears when finishes overlap, which is the multi-file and two-tab case. Dev timings go through a home uplink; Fly to R2 may be faster, so measure on staging before sizing the work.

## Solution

Expert agent first (persistence, CAS and concurrency). Question: can the durable sync run after the lock is released while the response still waits for it, or do overlapping finishes need to share one sync? Options:
- release the write lock before the durable sync, and hold only what CAS needs;
- coalesce overlapping durable syncs for one user, so a second finish rides the sync already running or the next one;
- fold finalize and activate into one durable sync per upload, since each now pays its own;
- measure on staging, and waive with the numbers if the staging cost is small.

Constraints: finalize stays a durable write (T4320) and never returns a lying 200 (T4050). A CAS conflict stays fail-loud: freeze, CRITICAL, Retry UX, no auto-merge. A write must not reach R2 from a snapshot older than a write the lock has since admitted.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/middleware/db_sync.py` - write lock, `durable_sync`, `_drain_pending`
- `src/backend/app/routers/games_upload.py` - finalize-upload
- `src/backend/app/routers/games.py` - activate
- `src/backend/app/storage.py` - sync primitives, `_snapshot_db_or_refuse`
- `src/backend/tests/test_t15090_lock_queue.py` - real-middleware harness to extend
- `.claude/knowledge/persistence-sync.md` - T15090 section, what holds the lock

### Related Tasks
- Depends on: T15090 (its branch must land first; this builds on the off-lock retry)
- Related: T4050, T4320

### Technical Notes
Repro: two tabs in one session, each calling `uploadGame` with a different new file at the same moment. Fixtures need new content every run, because R2 dedup skips a repeat. Read `[WRITE_LOCK_WAIT]` and `[REQ_TIMING]` from the backend log.

## Implementation

### Steps
1. [ ] Measure the same two-finish scenario on staging (not done: the fix is structural, so the staging number sizes nothing; measure at the landing test)
2. [x] Design in the main chat (driver above the expert tier; no expert spawn)
3. [x] Failing test through the real middleware and lock code
4. [x] Implement
5. [ ] Re-run the two-finish Playwright scenario (landing human test)

### Progress Log

**2026-11-05**: Filed from the live verification of a02d04128.

**2026-11-05**: Started in the main chat on `feature/T15150-durable-sync-off-the-write-lock`. Design: keep the write lock over the handler, the pending marker and `_begin_sync_attempt`, release it, then await the durable sync. The per-key upload lock (T6402) already serialises CAS decision, snapshot and PUT, so a later snapshot is a superset of an earlier one and R2 never moves backwards. No coalescing: the second finish commits after the first snapshot, so its own PUT is inherent.

**2026-11-05, review round**: Proof Verifier VERIFIED the red-to-green (red reproduced in an isolated worktree at a964395a8: second finalize blocked, waits 2496 ms finalize / 5050 ms prepare; green at 46156ca5a). Reviewer: no BLOCKING; one MAJOR accepted: a non-durable write landing while two durable uploads queue defers on the upload lock and the T5870 re-drain gives up, leaving its marker unowned until the next write. New since this change, not pre-existing as first written. Fixed: a durable writer whose sync returned OK re-checks for an unowned marker in its `finally` and drains it; test 2 now asserts the marker clears and the drain ran. MINOR notes recorded under Residuals in persistence-sync.md; four stale in-lock comments refreshed.

## Acceptance Criteria

- [x] Two finishes at once: no `WRITE_LOCK_WAIT` above 2 s on finalize-upload, activate or prepare-upload (log evidence: harness with a 2.5 s R2, base 2502 ms finalize / 5050 ms prepare, head none logged, every wait under the 50 ms log threshold; live two-tab run pending at the landing test)
- [x] Finalize stays durable: an R2 failure still returns the retryable 503, and a CAS conflict still freezes and surfaces Retry (test)
- [x] `persistence-sync.md` states what holds the lock during finalize and activate
