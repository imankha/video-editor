# T5870: "Your edits aren't saving" fires regularly and only a page refresh clears it

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-25
**Source:** Production bug **38p** (glitch 1 of 3) — the other two glitches shipped separately

## Problem

User report 2026-07-25 (production, Mac/Safari), first of three glitches in bug 38p:

> "I receive your edits aren't saving error somewhat regularly. Only way to overcome it is to
> refresh the page."

Two distinct defects in one sentence, and both matter:

- **(A) Frequency** — a data-loss-flavored warning appears during ordinary editing. Either syncs
  genuinely fail often, or the banner is a **false positive**.
- **(B) The Retry affordance does not work** — the user's only recovery is a full page refresh.
  The banner exists precisely so the user does NOT have to refresh; if refreshing is the only cure,
  the recovery path is broken, not just unpolished.

This is a trust bug: the copy says the user's edits are not saving, which is exactly the fear the
durability epic exists to address. A false positive here is nearly as damaging as a real failure.

## Investigation leads (traced 2026-07-25 — start here, do not re-derive)

### Lead 1 — the marker means "pending", but is read as "failed"

`middleware/db_sync.py:250-252`:
```python
def is_sync_failed(user_id: str) -> bool:
    return has_sync_pending(user_id)
```
`.sync_pending` is a marker file that the module's own comment (`db_sync.py:154-157`) says is set
**BEFORE a sync attempt**. So "a sync is in flight / queued" and "a sync failed" are the *same
state*. The header emission at `db_sync.py:791-792` guards with
`not is_sync_attempt_in_progress(user_id)` — **verify whether that guard actually covers deferred /
queued / retry-worker syncs**, or only a sync currently executing in-process. If a deferred sync is
pending but not "in progress", every response in that window carries `X-Sync-Status: failed` and the
user is told their edits are not saving while the write is merely *in flight*. This is the leading
hypothesis for (A).

### Lead 2 — sticky marker explains "only a refresh helps"

The frontend is not sticky: `stores/syncStore.js` `checkSyncStatus` CLEARS `syncFailed` on any
response whose header is not `failed`/`conflict`. So a persistent banner means the **backend keeps
re-emitting the header** — i.e. `.sync_pending` is still on disk. It is cleared only by a successful
sync. A page refresh runs `session_init` (a fresh full sync) which clears it; the Retry button takes
a different path. That asymmetry is the leading hypothesis for (B).

### Lead 3 — the Retry path was demonstrably broken (partly fixed by T4310, re-measure)

`POST /api/retry-sync` (`routers/health.py`) calls `database.sync_db_to_cloud`. Pre-T4310 it
force-pushed (`skip_version_check=True`) and used `if success:` truthiness — the returned strings
`"conflict"`/`"failed"` are truthy, so it reported `{"success": true}` and cleared `.sync_pending`
**after a refused sync**. T4310 fixed the truthiness + made it CAS. **Re-measure this task AFTER
T4310 and T4315 are on staging** — part of (B) may already be fixed, and T4310 deliberately makes
genuine conflicts *more* visible (loud beats silent clobber), so the banner's frequency may shift in
both directions. Do not measure against the pre-T4310 build.

### Lead 4 — is any of it a REAL failure?

Do not assume false positive. Instrument first: for a user hitting this, determine the actual
outcome distribution — genuine R2 errors, lock timeouts, CAS conflicts (post-T4310), vs. pending-not-
failed. Fix the real failures AND the misreporting; do not silence the banner to make the symptom go
away (that would hide the exact data-loss class this epic exists for).

## Solution direction (confirm at implementation)

1. **Separate "pending" from "failed."** A queued/in-flight sync must NOT surface as a user-facing
   failure. Only a sync that has actually failed (or conflicted) should raise the banner. This likely
   means a distinct marker/state rather than overloading `.sync_pending`.
2. **Make Retry actually recover** — after a successful retry the server-side marker must clear and
   the banner must go without a refresh. If Retry cannot resolve it (a real conflict), say so
   honestly and tell the user what will happen, rather than looping.
3. **Honest copy per state:** in-flight (say nothing, or a quiet indicator), transient failure
   (retryable), conflict (T4310 — needs reconciliation). Reuse the T5350 clip-gesture copy work;
   do not invent a fourth vocabulary.
4. **No silencing.** If a write genuinely did not land, the user must still be told.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/middleware/db_sync.py` — `is_sync_failed`/`set_sync_failed` (250-259), marker
  semantics (154-157), header emission (791-792), write-path guard (677), `mark_sync_pending` (736)
- `src/backend/app/routers/health.py` — `/api/retry-sync`
- `src/backend/app/database.py` — `sync_db_to_cloud` (the retry path)
- `src/frontend/src/stores/syncStore.js` — `checkSyncStatus`, `retrySyncToR2`, online auto-retry
- `src/frontend/src/components/SyncStatusIndicator.jsx` — the banner
- `src/frontend/src/stores/overlayActionStore.js:18,125` — "edits aren't saving — Retry" copy
- `src/frontend/src/hooks/useRawClipSave.js` — clip-gesture 503 handling (T5350)

### Related
- **Bug 38p glitch 1** — this task; glitches 2 (auto-select) and 3 (frame-step) shipped 2026-07-25
- **T4310** (CAS, on staging) — changed `/api/retry-sync`; makes real conflicts visible
- **T4315** (restore-if-newer) — most likely to reduce genuine failures; land first
- **T5350** (DONE) — clip-gesture `sync_failed` frontend UX; reuse its patterns
- Durability epic: `tasks/durability-sync/EPIC.md`

## Acceptance Criteria

- [ ] Root cause named with evidence for BOTH (A) frequency and (B) refresh-only recovery — measured
      on a build that includes T4310 + T4315, not the pre-T4310 build
- [ ] A merely pending/in-flight sync never tells the user their edits aren't saving
- [ ] A genuine failure/conflict still warns — no silencing; prove with a seeded failure
- [ ] Retry resolves a recoverable failure without a page refresh (banner clears, marker clears)
- [ ] An unrecoverable conflict is stated honestly rather than looping
- [ ] Tests: pending-not-failed, transient-failure-then-successful-retry, conflict path, and a
      regression test pinning "no refresh required"
- [ ] Verified as a real user on staging (drive the failing path, not just unit tests)
