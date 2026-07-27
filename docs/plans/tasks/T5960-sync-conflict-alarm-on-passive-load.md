# T5960: Sync "Could not save to the cloud" alarm fires on a PASSIVE load (no edit made)

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-26
**Source:** Staging verification sweep 2026-07-26 (T5870 area). Observed directly in a real browser.

## Problem

On a plain load of `/home/games` as a real account, with **zero editing gestures made in that
session**, the red sync alarm appeared bottom-right:

> **Could not save to the cloud**
> A newer version of your work exists. Retry to load it.   [ Retry ]

Evidence: staging, 2026-07-26, screenshot `a5-01-games.png` — the banner is up while the page is an
ordinary read-only games list.

The user is told their work could not be saved when **they have not saved anything**. This is the
adjacent case to the one T5870 just fixed: T5870 stopped a 0.5s upload-lock *defer* from reading as
a failure during editing; this is a real conflict surfaced to a **reader** rather than to the writer
whose write was actually refused.

## Root cause (verified by code read — do NOT re-derive)

- The string is unique to `SyncStatusIndicator.jsx:62` (`syncState === 'conflict'`).
- `syncState` is set from the `X-Sync-Status` response header (`syncStore.js`, `mapSyncStatusHeader`).
- The header reads `"conflict"` when `has_sync_conflict(user_id)` — a **marker FILE**,
  `.sync_conflict`, written by `mark_sync_conflict` (`database.py:88-110`).
- The marker is **sticky**: it survives until a later sync succeeds and clears it. So it outlives the
  session whose write was refused and attaches to whatever session loads next — including a
  read-only one.

## Why this is NOT simply "the CAS fix misbehaving"

`.claude/knowledge/persistence-sync.md` §T4310 predicts this shape right after a deploy:

> "The FIRST write after deploy from any machine holding a stale copy will refuse (repeatedly, until
> T4315's restore heals it) — a support spike of Retry toasts right after this deploy is expected,
> not a regression."

Staging had deployed ~31 min before the observation, and repeated `dev-login` calls (each runs a
full `user_session_init`) plausibly induced the refusal. It self-cleared. **The refusal itself is
working as designed. The defect is who gets shown the alarm.**

## Decision (made with the user 2026-07-26 — implement this, do not re-litigate)

**Gate the alarm on write-attempt.** The conflict state is still tracked, but it is **not rendered
until the CURRENT session has attempted at least one write.**

- Read-only session -> silent. No alarm, no Retry banner.
- Once this session issues a mutating request, behaviour is exactly as today: alarm + working Retry.
- **Backend marker semantics are UNCHANGED.** Do not change `.sync_conflict` write/clear rules, do
  not add expiry, do not touch the CAS logic. This is a frontend surfacing change.

Rejected alternatives (recorded so they are not re-proposed): aging out stale markers (picking the
timeout risks hiding a real unresolved conflict from the actual writer), and doing both.

## Scope notes

- Primary scope is the **`conflict`** state, per the decision above.
- `failed` is backed by the same sticky-marker idiom (`.sync_failed`) and plausibly has the identical
  staleness property. **Evaluate it, but do not silently expand scope** — if it has the same defect,
  raise it in the review conversation and let the user decide, or file a follow-up.
- `pending` and `offline` are out of scope.

## Must not break

1. A user who IS editing must still get the alarm + Retry for a genuine conflict/failure. T5870's
   behaviour on the editing path is unchanged.
2. After a reload, a user who edits again must see a still-unresolved conflict.
3. Existing T5870 coverage stays green: `syncStore.test.js`, `SyncStatusIndicator.test.jsx`,
   `test_t5870_pending_vs_failed.py`, `test_sync_status.py`, `test_background_sync.py`.
4. No reactive persistence, and no new write path (CLAUDE.md § Persistence).

## Acceptance criteria

- [ ] Load the app as a real account with a `.sync_conflict` marker present and make NO edits ->
      **no alarm banner** is rendered.
- [ ] With that same marker present, make one edit -> alarm + Retry appear as they do today.
- [ ] Retry still resolves/clears the conflict without a page refresh (T5870's honest-Retry path).
- [ ] A genuine conflict raised DURING an editing session still alarms immediately (no regression).
- [ ] Unit coverage pins "conflict header seen, zero writes this session -> not rendered" and
      "conflict header seen, after a write -> rendered". This test must be RED before the fix.

## Open coverage this task should close

The verification sweep could **not** test "Retry clears the banner without a page refresh" — the
banner appeared in an un-instrumented run and never reproduced in the instrumented one. Whatever
repro harness this task builds should cover that path too.

## Knowledge

Load `.claude/knowledge/persistence-sync.md` FIRST (§T4310 CAS/SyncResult, §T5870 pending vs failed
vs conflict). Update it at Stage 7 with the new surfacing rule.
