# Retrospective: Game-Video Wrongful Deletion (ref_count drift)

**Date**: 2026-07-23
**Complexity**: Complex (production incident — data loss, live prod-data repair, hot deploy)
**Duration**: 1 session
**Trigger**: User hit "video not loaded" opening a game in Annotate on prod (imankh game 3, Beach FC).

## Summary

A prod game video 404'd in Annotate. Root cause: the irreversible R2 game-video deletion in the
cleanup sweep was gated on `game_ref_counts.ref_count` (Postgres), a hand-maintained counter that
drifts out of sync with the per-profile `game_storage` rows (the source of truth). When it
under-counts (<= 0), the sweep permanently deletes a video a user still holds a live, non-expired
ref to, while the game keeps showing `ready`. Fixed the code (guard + counter floor), restored the
3 already-lost videos from the user's local originals, extended all the user's games, audited all
10 prod users, and rescued one other user (chris.kunst23) from an imminent (Jul 27) wrongful delete.

## What Worked Well

- **`reduce_log` on the console dump** immediately localized it: `[VIDEO] format not supported` +
  `[FaststartCheck] Failed to fetch` on `/api/games/3/video` → an R2 object problem, not frontend.
- **Diagnosed against ground truth, not guesses**: queried prod Postgres + HEAD'd R2 directly.
  The `ref_count = -1` (and later `-31`) values were the smoking gun that made the root cause
  undeniable rather than theoretical.
- **Recovery from local originals** worked because the R2 key hash is reproducible. Validated the
  sampled-BLAKE3 algorithm against a *still-present* game (game 1) before trusting it on the
  missing ones — caught that it is a sampled hash (size prefix + 5×1MB), not a full-file hash.
- **Fix reused the sweep's existing per-profile iteration** (DBs already downloaded in Phase 1),
  so the authoritative live-ref recount added correctness with no extra R2 cost.
- **Audited the whole user base** before deploying — found chris's imminent loss with 4 days to
  spare, and confirmed no other already-lost videos.

## What Didn't Work

- **First audit under-counted multi-video games.** It linked refs via `games.blake3_hash`, which is
  NULL for multi-video games (part hashes live in `game_videos`). It missed that `ff2a307a` was a
  second wrongful-delete case. Fix: key the audit on `game_storage` rows directly (hash-keyed,
  covers every video part). Lesson below.
- **Lint hook friction**: the PostToolUse ruff hook blocks on *pre-existing* lint debt anywhere in
  a touched file (SIM102, import sorting, unused vars), forcing unrelated cleanups mid-fix.
- **`MAX` vs `GREATEST`**: first wrote `MAX(ref_count-1, 0)` — Postgres `MAX` is an aggregate;
  scalar two-arg max is `GREATEST`. Caught by existing tests hitting real dev Postgres.

## Lessons Learned

### For Code Expert
- Two stores hold game-storage state and they can disagree: **profile.sqlite `game_storage`**
  (per-user expiry, drives UI + sweep Phase 1) and **Postgres `game_ref_counts` /
  `r2_grace_deletions`** (aggregate, drives Phase 2 deletion + scheduling). Any expiry/repair must
  touch both. `insert_game_storage_ref` already does all three (sqlite upsert + pg count + grace
  cancel) — prefer it over hand edits.
- Multi-video game part-hashes are in `game_videos`, not `games.blake3_hash`. Any per-hash audit
  must read `game_storage`/`game_videos` directly or it silently misses half of a 2-part game.

### For Architect
- **Do not gate an irreversible action on a hand-maintained counter.** `ref_count` is redundant,
  derivable state (= count of live `game_storage` rows) and it drifted badly (−31). The durable
  design is to derive it (or verify against the source of truth before the destructive step),
  which is what the fix does. This is the "no redundant state" rule applied to a delete gate.
- Safety nets must run *before* the irreversible step and cover *all* profiles — the old
  `_expire_game_storage_all_profiles` ran after the delete and only on locally-present profiles.

### For Implementor
- When repairing prod data, make scripts idempotent (HEAD-skip, size asserts) and dry-run first.
  `edit-user-db.py` handles the R2 version-bump + Fly restart; use it rather than reimplementing.

### For Tester
- Test the destructive path with real data both directions: counter too-low (wrongful delete) and
  too-high (storage leak). Added `TestGraceDeletionLiveRefGuard` + `TestDeleteRefCounterDrift`.

## Recommendations

- [ ] One-time `game_ref_counts` reconciliation to real per-profile counts (clears 14 negatives +
      the `pg=4, real=0` storage leaks). Guard makes it non-urgent.
- [ ] Consider replacing the bare counter with a derived ref-set table (one row per referencing
      profile) so `ref_count = COUNT(*)` can never drift — larger change, follow-up task.
- [ ] Add an admin/monitoring check: alert on any `game_ref_counts.ref_count < 0` or any
      grace-queued hash that still has a live ref (would have caught this proactively).

## Related

- Fix commit: `1678145a` (master), deploy `deploy/backend/2026-07-23-3`
- Code: `app/services/sweep_scheduler.py` (Phase 2 guard), `app/services/auth_db.py`
  (`delete_ref` floor, `count_refs_in_profile`, `heal_ref_count`)
- Memory: `project_game_video_refcount_drift`, `reference_restore_game_video_from_local`
- Prior related incidents: bug 27p/29p (`project_bug29p_v017_resurrection`), v023 repair migration
