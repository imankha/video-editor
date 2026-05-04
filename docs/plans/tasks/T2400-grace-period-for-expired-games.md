# T2400: Grace Period for Expired Games

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-03
**Updated:** 2026-05-03

## Problem

When a game's storage ref expires and no other users reference the same hash, the sweep immediately deletes the R2 object. This means the user can never extend storage — the video is gone. We're leaving money on the table: the user might want to pay credits to keep their game if prompted.

## Solution

Keep game videos in R2 for **2 weeks** after the last storage ref expires. During this grace period:

1. The game card shows "Expired" badge with "Extend Storage" option
2. If the user extends, the ref is re-inserted with the new expiry date
3. After 2 weeks with no extension, the sweep deletes the R2 object permanently

### Sweep behavior change

Currently: `has_remaining_refs(hash)` returns False → immediately delete R2 object.

New: When deleting the last ref for a hash, record a `grace_expires_at` timestamp (now + 14 days) instead of deleting the R2 object. A separate check in `do_sweep()` deletes R2 objects whose grace period has elapsed.

## Context

### Relevant Files

- `src/backend/app/services/sweep_scheduler.py` — Sweep loop, R2 deletion logic
- `src/backend/app/services/auth_db.py` — `game_storage_refs` table, `has_remaining_refs()`
- `src/backend/app/routers/storage.py` — Storage extension endpoint
- `src/frontend/src/components/ProjectManager.jsx` — GameCard expired state, extend handler

### Related Tasks

- Depends on: T1583 (auto-export pipeline, which implements the sweep)
- Related: T1581 (storage extension UX — the modal already exists)
- Part of: Expired Game Experience epic (T2410-T2440)

### Technical Notes

Options for tracking the grace period:

**Option A: New `grace_expires_at` column on `game_storage_refs`** — When deleting the last ref, instead of deleting the R2 object, insert a "grace" row with `storage_expires_at` in the past and `grace_expires_at` = now + 14 days. Sweep checks grace rows separately.

**Option B: New `r2_grace_deletions` table in auth.sqlite** — `(blake3_hash, grace_expires_at, created_at)`. Inserted when last ref deleted. Sweep checks this table and deletes R2 + removes the row when grace expires.

Option B is cleaner — doesn't pollute the refs table with phantom rows.

### Extension during grace period

The existing extension endpoint (T1581) creates a new storage ref. If the user extends during the grace period, the grace deletion row is removed (or ignored since `has_remaining_refs` returns True again).

## Acceptance Criteria

- [ ] Game videos stay in R2 for 14 days after the last storage ref expires
- [ ] "Extend Storage" works during the grace period (re-inserts ref, clears grace)
- [ ] After 14 days with no extension, R2 object is permanently deleted
- [ ] Grace period is invisible to the user — they just see "Expired" with extend option
- [ ] Existing sweep tests updated to cover grace period logic
