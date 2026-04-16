# T1539: R2 Concurrent-Write Rate Limit on profile.sqlite

**Status:** TODO
**Impact:** 7 (intermittent user-visible stalls + degraded-state cascades)
**Complexity:** ?
**Created:** 2026-04-16
**Updated:** 2026-04-16

## Problem

Cloudflare R2 returns `429 ServiceUnavailable` ("Reduce your concurrent
request rate for the same object") when multiple PutObject calls land
on the same key (`{env}/users/{uid}/profiles/{pid}/profile.sqlite`)
inside a short window. Observed first-hand on dev:

```
10:05:32 [R2_CALL] client=sync op=PutObject status=429 elapsed_ms=1421
10:05:32 ERROR Failed to upload DB to R2: ... ServiceUnavailable
                "Reduce your concurrent request rate for the same object"
10:05:32 [SYNC] Retry still failing for user e093d335-...
```

Why the same object gets hit concurrently:

- The whole user profile lives in **one** SQLite file (`profile.sqlite`)
  that is uploaded as a single R2 blob after every write.
- Even with the per-user write serialization from T1531, more than one
  R2 PutObject can be in flight for the same key at the same time
  (e.g. a writer's post-handler sync overlapping with a `retry_pending_sync`
  fired by a separate request, or two writers landing within milliseconds
  of each other from different middleware paths).
- T1537 narrowed one source (only writers retry now), but the underlying
  shape — *every* write uploads the same multi-MB object — is unchanged.

When R2 429s a write, the user enters degraded state (`.sync_pending`
marker), and subsequent writes do `retry_pending_sync` on top of their
own sync. Failure begets more concurrency begets more 429s. A single
unlucky 429 can produce a multi-second stall as the cascade unwinds.

## Why this is hard

The constraint isn't "make R2 faster" — it's "stop sending concurrent
writes to the same key without changing the persistence paradigm."

**The persistence paradigm is non-negotiable** (see CLAUDE.md "Persistence:
Gesture-Based, Never Reactive"):

- Every user gesture results in a backend write that is **persisted to R2
  before the request returns**.
- After a write returns 200, the next read (this session, another tab,
  another device) must see that change. No "eventual" consistency.
- No debouncing. No batching across gestures. No background-flush queues
  that could lose writes on crash.
- One write path per piece of data — no parallel "fast path" / "slow path"
  variants that could diverge.

A naive fix that violates this paradigm (queue writes, debounce uploads,
ack-then-flush, single-flight-with-conflict-resolution) is worse than
the bug, because it would silently break the "what I just did is saved"
invariant that everything else in the app assumes.

## Requirements (must hold for any solution)

1. **Atomic gesture commit.** When a write request returns 200, the change
   is durably persisted to R2 — readable by the next request from any
   client. No "will be saved soon" semantics.
2. **No silent loss under crash.** If the backend dies between handler
   completion and R2 write, the change must be reconcilable on next boot
   (current `.sync_pending` marker behavior is the floor, not a thing to
   lose).
3. **No new write paths.** Whatever we do applies uniformly to every
   write handler. We do not introduce "fast" vs "slow" or "best-effort"
   write modes — that fragments the model the rest of the codebase
   reasons about.
4. **Cross-user fairness preserved.** A 429 (or hot user) must not stall
   unrelated users. Today's per-user lock granularity (T1531) is the
   minimum bar; a solution must not make this worse.
5. **Per-user serialization must remain at least as strong as today.**
   Two writes from the same user that touch overlapping data still need
   correct ordering — last-writer-wins on the R2 blob is what gives us
   that today.
6. **Observable.** We must keep the `[R2_CALL]` / `[SYNC]` /
   `[WRITE_LOCK_WAIT]` logs (or equivalents) so future regressions are
   diagnosable from logs alone.

## What's out of scope for *this* task

- Replacing SQLite or moving off R2.
- Background-only sync. (Violates requirement 1.)
- Per-row or per-record locking. (Way too fine for a single-file blob;
  see T1538 for the level of granularity that's plausible.)

## Open questions to explore

- What does "the same object" actually mean to R2's rate limiter — is it
  bucket-scoped, key-scoped, account-scoped? (Empirical: same key, same
  user, same dev account.) Knowing the dimension constrains the design.
- Is the contention coming from one source (achievement POST + concurrent
  reads) or many? T1537 removed read-side retries, so re-measure first.
- T1538's per-resource locks were filed as a finer-grained *write*
  granularity. Does it intersect this problem at all? (Per-resource
  locks could *increase* concurrent same-key writes if the R2 push isn't
  also coordinated.)
- What's the actual upper bound R2 will accept on PutObject/sec for one
  key on our plan? If it's 1/sec, the design space is very different
  from 10/sec.

## Pre-requisite: evidence

Re-measure after T1537 ships (write-side-only retries). If we still see
429s in normal use, this task is justified. If we don't, downgrade
priority and revisit only when the next 429 appears.

Capture before designing:
- `[R2_CALL]` PutObject frequency per user during a typical edit session
- Inter-arrival times for same-key PutObjects (smallest gap that 429s)
- Whether 429s only happen during sustained burst or also under
  steady-state

## Notes for AI handoff

- Touched files when this lands will likely include
  [src/backend/app/middleware/db_sync.py](../../../src/backend/app/middleware/db_sync.py)
  and [src/backend/app/storage.py](../../../src/backend/app/storage.py).
- Do **not** propose solutions in design docs without first re-reading
  the "Persistence: Gesture-Based, Never Reactive" section of
  [CLAUDE.md](../../../CLAUDE.md). Many obvious fixes (debounce, batch,
  background queue) violate it.
- The user explicitly flagged that resource-specificity (cf. T1538)
  *might* be part of the answer — explore it, but do not assume it.
