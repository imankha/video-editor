# T6010: The `failed` sync alarm has T5960's staleness bug too — gate it on write-attempt

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-27
**Follows:** T5960 (merged to master 2026-07-27, commit `e90633d7`) — read that task file first.

## Problem

T5960 fixed the `conflict` alarm being shown to a session that never wrote anything. The
**`failed`** state is backed by the same sticky-marker idiom and has the identical defect, one
state over. It was deliberately left out of T5960's scope; this task closes it.

**Verified in the backend (do NOT re-derive):**

- `sync_status_header(user_id)` (`middleware/db_sync.py:313`) is the single source of the
  `X-Sync-Status` header. It returns `"failed"` whenever `has_sync_failed(user_id)` — a property of
  the USER, evaluated for **any** session that happens to make a request.
- `.sync_failed` (`database.py:123-144`) is written by `mark_sync_failed` after the bounded
  re-drain definitively gives up, and is cleared **only** by a later successful sync
  (`database.py:1463`, `db_sync.py:298`).
- `.sync_conflict` is cleared on exactly the same successful-sync path, one line above
  (`database.py:1462`). **The two markers are equally sticky** — this is not a case where `failed`
  self-heals faster.

So a user whose write definitively failed in session A, who then closes the tab and comes back,
gets *"Could not save to the cloud / Some changes didn't reach the cloud"* on a passive load in
session B — the exact shape T5960 removed for `conflict`.

## The one real counter-argument, and why it does not hold

`failed` differs from `conflict` in that it can be set by an **out-of-band writer on the user's
behalf** (the export worker syncing after a render). One could argue that failure is worth showing
even to a non-writing session, because it is a statement about the user's DATA, not about this
session's actions.

It does not hold, because of when the gate arms:

- If the export was started in **this** session, `POST /api/exports/framing` already armed
  `hasAttemptedWrite` — the alarm shows. No regression.
- If it was started in a **previous** session, we are back to "a previous session's failure greets
  a passive reader", which is precisely the bug.

Either way, gating is correct. Record this reasoning; do not re-litigate it.

## Decision (implement this)

Extend T5960's existing write-attempt gate in `SyncStatusIndicator.jsx` to cover `failed` as well
as `conflict`. Symmetric with the shipped `conflict` behaviour:

- Read-only session, `failed` marker present -> **silent**.
- After this session issues a genuine user-data write -> alarm + Retry, exactly as today.
- **Backend untouched.** No change to `.sync_failed` write/clear rules, `sync_status_header`, the
  re-drain, or CAS. Frontend surfacing only.
- `pending` and `offline` stay ungated and unchanged.

## Consider and report (do not action without asking)

`pending` renders the quiet *"Cloud backup pending — your work is saved locally"* banner and is
also user-scoped, so a passive reader can see it for someone else's queued write. It is not
alarm-styled, so it is lower harm. **Evaluate and state a recommendation in your report; do not
change it in this task.**

## Must not break

1. A user who IS editing still gets the `failed` alarm + working Retry immediately.
2. T5960's `conflict` gating is unchanged — do not regress it while generalising the condition.
3. `pending` and `offline` behaviour unchanged.
4. Stays green: `syncStore.test.js`, `SyncStatusIndicator.test.jsx`, and backend
   `test_t5870_pending_vs_failed.py`, `test_sync_status.py`, `test_background_sync.py`.

## Acceptance criteria

- [ ] `failed` header observed, zero writes this session -> **no banner rendered**.
- [ ] `failed` header observed, after one genuine write this session -> alarm + Retry render.
- [ ] `conflict` gating still behaves exactly as T5960 shipped it (regression pin).
- [ ] `pending` still renders its quiet banner regardless of write-attempt (pin that it is NOT
      caught by the generalised condition).
- [ ] The first two are RED before the fix.

## Knowledge

`.claude/knowledge/persistence-sync.md` (§T4310 CAS/SyncResult, §T5870 pending vs failed vs
conflict, and the T5960 surfacing-rule section added 2026-07-27). Update it at Stage 7.
