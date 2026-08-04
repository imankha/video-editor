# T5081: Split clean-copy conflicts from unsynced-write conflicts

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-04
**Updated:** 2026-08-04

Epic child 1/5 — see [EPIC.md](EPIC.md) for goal, settled design decisions, and the two field-findings
sections. This task is the safety net every later child leans on.

## Problem

Every CAS refusal in `storage.py` produces the same outcome: freeze the baseline, log CRITICAL, and
surface the persistent failed-sync banner with a manual **Retry**. But two very different situations
land there:

| Local copy | Meaning | What the user should see |
|---|---|---|
| Has unsynced local writes | Real user data on both sides — genuinely ambiguous | Freeze + ask (correct today) |
| Clean, R2 simply ahead | Nothing to arbitrate; our copy is stale, theirs is canonical | Nothing — heal and continue |

The 2026-08-04 prod incident was entirely row two (a read-only warmed copy vs a healed R2 copy), and
the user was still handed a "did not save" banner for an action they never took, with exactly one
possible answer behind the Retry button. T6160 already schedules a re-pull on the conflict path, so
the machine self-heals — the *user-facing failure* is what is wrong, not the data handling.

This matters beyond the incident: JIT (T5083) turns cross-writer conflicts into a routine event
(two tabs, phone + laptop, export worker vs login). Shipping JIT before this split would convert
every one of those races into a scary banner.

## Solution

Discriminate at the conflict site in `storage.py` (both the profile and the `user.sqlite` twin,
which already mirror each other):

1. **Determine whether the local copy is clean** — no unsynced local writes relative to its confirmed
   baseline. Pick the cheapest sound signal and state it in the design; candidates: the existing
   dirty/pending-sync tracking in `middleware/db_sync.py`, or an explicit "this copy has been written
   since it was restored" flag set on the write path. Do NOT infer cleanliness from a byte compare or
   an mtime.
2. **Clean + R2 ahead** → re-pull under the per-user write lock (the swap is only WAL-safe there),
   record the downloaded sync version as the new baseline (same `get_object` that produced the bytes
   — the T6340 rule), retry the upload once, and stay silent. Log at INFO with a distinct marker so
   the event is still greppable.
3. **Dirty + R2 ahead** → unchanged: freeze, CRITICAL, failed-sync banner + Retry.
4. **Retry that itself conflicts** → fall through to the dirty behavior. Never loop.

The `reason=` discrimination that T6390 added (`stale_baseline` vs `unconfirmed_baseline`) is the
precedent for how to name and log the new case. An `unconfirmed_baseline` (loaded=None) is NEVER
eligible for the silent path — that is the T4315 catastrophic-clobber shape.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/storage.py` — both CAS sites (~L1343 profile, ~L1658 user.sqlite), `_conflict_diag`
- `src/backend/app/middleware/db_sync.py` — `_get_user_write_lock` (L228), SYNC_PARTIAL reporting, the
  dirty/pending tracking that feeds "is this copy clean"
- `src/backend/app/database.py` — `get_local_db_version`/`set_local_db_version` (L524/L584),
  `schedule_profile_db_reheal` (the T6160 re-pull this task promotes to inline+silent)
- `src/backend/app/routers/health.py` — `/api/retry-sync`, `set_sync_failed`; the banner's server side
- `src/frontend/src/hooks/useRawClipSave.js`, `src/frontend/src/stores/overlayActionStore.js` — the
  client surfaces that must stop firing for the clean case
- Knowledge: [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md) § CAS / SyncResult

### Related Tasks
- Epic sibling, blocks: **T5083** (JIT) — ship this first
- Builds on: T4310/T4315 (CAS + restore-if-newer), T6160 (scheduled re-pull), T6390 (writer identity
  + reason discrimination), T6402 (self-conflict exemption — same "this is not a real conflict" family)

### Technical Notes
- M-tier. Backend-only. No schema change, no migration.
- **The swap is WAL-unsafe outside the per-user write lock** — this is why today's code refuses to
  re-download inline. The silent path is only legal inside the lock; if the lock is not held (a
  reader), keep today's behavior and let the scheduled re-heal handle it.
- Do not weaken the refusal itself. The upload must still be refused before the re-pull; this task
  changes what happens *after* the refusal, never whether stale bytes can be force-pushed.
- Test with a real conflict, not a mocked one: two baselines against one R2 object.

## Implementation

### Steps
1. [ ] Define the "clean copy" signal (design note in the task file — one sentence, one source)
2. [ ] Add the clean/dirty branch at both CAS sites with a distinct log marker
3. [ ] Inline re-pull + single retry under the write lock for the clean case
4. [ ] Ensure `unconfirmed_baseline` (loaded=None) never takes the silent path
5. [ ] Client: verify no failed-sync banner fires for the healed case
6. [ ] Tests: clean+ahead heals silently; dirty+ahead still freezes and banners; retry-conflicts-again
       falls back to freeze; unconfirmed baseline always refuses

### Progress Log

**2026-08-04**: Split out of T5080 when it became an epic. Motivated by the prod CAS conflict the
same day (see EPIC.md field findings) — correct data handling, wrong user-facing outcome.

## Acceptance Criteria

- [ ] A clean local copy against a newer R2 copy heals inline and produces NO user-visible failure
- [ ] A dirty local copy against a newer R2 copy behaves exactly as today (freeze, CRITICAL, banner)
- [ ] The silent path runs only inside the per-user write lock; readers keep the scheduled re-heal
- [ ] `unconfirmed_baseline` conflicts are never silenced
- [ ] The healed case is still greppable in logs (distinct INFO marker, not silence)
- [ ] Tests pass
