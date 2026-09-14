# T10121: Storage-reclaim sweep can permanently destroy a game's footage before its recap exists, with three separate real mechanisms and zero alerting

**Status:** WIP
**Impact:** 9
**Complexity:** 7
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Split out of T10120 (bug 52: a 17-clip game showed only "Delete", no way to view annotations).
T10120's investigation found the most likely explanation for that specific report is UI-only (see
T10120) — but the same investigation, run by the expert agent, found this codebase's storage-reclaim
sweep has **three additional, independent mechanisms** that can permanently delete a game's video
before a recap exists to fall back on, **with no logging, alerting, or recovery path**. This task
is the backend hardening for those — real, ongoing data-loss risk on current master, not dependent
on T10120's frontend fix.

This is a P1: `.claude/knowledge/`'s and CLAUDE.md's core invariant is "correct data, not
workarounds" and "fail loud, never silently self-repair" — this sweep violates both by design today.

## The three mechanisms (all confirmed live on current master, 2026-09-14)

### B — `pending` games are never re-selected for retry (T2460 half-fixed)

`sweep_scheduler.py:374-377`'s selector:
```python
f"({p}auto_export_status IS NULL OR ({p}auto_export_status = 'failed' AND COALESCE({p}auto_export_attempts,0) < ?))"
```
matches neither `IS NULL` nor `'failed'` for a game stuck at `'pending'`. `auto_export_game`
(`auto_export.py:93-94`) *does* tolerate being re-entered on a pending game ("Retrying previously
pending game" — T2460's fix was implemented on the retry side) but the **selector that would hand
it back never does**. If a machine dies mid-export (Fly suspend, deploy, OOM — a documented prior
incident class), the game sits at `'pending'` forever, the post-export re-check
(`sweep_scheduler.py:178`) finds nothing pending export, `delete_ref` runs, and the source is
hard-deleted after the 14-day grace window. Confirmed via `git show 88d39691`:
`_find_games_for_hash` never included `pending`. **Silent, permanent data loss.**

### C — retry exhaustion reclaims by design, with zero alerting

`MAX_AUTO_EXPORT_ATTEMPTS = 3` (`auto_export.py:47`). On the 3rd failure the game drops out of
`_find_games_for_hash`'s selector entirely, the sweep's re-check at `sweep_scheduler.py:178` passes
(nothing left needing export), and `delete_ref` proceeds — reclaiming the source with **no log
distinguishing "gave up permanently" from "succeeded."** `auto_export_game`'s own exception handler
logs at `logger.error` once (`auto_export.py:157-161`) and the sweep logs the outcome at **INFO**
(`:170`). No CRITICAL, no alert, no metric, nothing user-visible. Per-clip failures inside a
"successful" export are also swallowed (`auto_export.py:122-123`), so `'complete'` doesn't even
guarantee full clip preservation.

### D — multi-video games can lose one half while the other is still active

`_ensure_game_storage_refs` (`games.py:927-950`) skips hashes that already have a ref, so a video
added later (T8700/T8910 "Add video", shipped 2026-09-05/07 — after sarkarati's report, so not his
cause, but live today) gets a *later* expiry than the first video. `_find_games_for_hash`'s
all-hashes-expired filter (`sweep_scheduler.py:397-405`) excludes the game from export while only
one hash has expired — so no export runs for it, the re-check at `:178` returns empty, and
**`delete_ref` deletes the expired hash's ref anyway**, reclaiming that half's footage while the
game is still "active" from the other half's perspective. There's an existing test
(`test_multi_video_partially_expired_excluded`) that pins the *selection* exclusion but nothing
asserts what happens to the ref afterward — that's the missing regression that would have caught
this.

### E — a discarded sync result can silently undo a completed export

`auto_export.py:110, 152, 160` call `sync_db_to_r2_explicit(...)` and discard the returned
`SyncResult`. On `CONFLICT`, `storage.py` replaces the local DB with R2's newer copy — destroying
the just-written `auto_export_status='complete'` + `recap_video_url` row, even though the recap MP4
is already uploaded (`auto_export.py:577`, which happens before the DB write). Self-limiting today
(the sweep's next read sees a retryable game and keeps the ref) but this is exactly the
"read-modify-write on an unconfirmed copy" shape CLAUDE.md's persistence rules ban outright — and
every machine runs its own sweep loop with no leader election (`main.py:564-566`), so concurrent
sweeps on the same game are possible.

## Recoverability

**No R2 object versioning exists anywhere in this codebase** (confirmed: zero hits for
`VersionId`/`list_object_versions`/`BucketVersioning` across `src/backend` and `scripts`) — the only
versioning is the custom `x-amz-meta-db-version` CAS header for SQLite sync, unrelated. `r2_delete_object_global`
(`storage.py:2135-2166`) is a hard, permanent delete. **Once the sweep's Phase 2 deletes
`games/{hash}.mp4`, the pixels are gone — there is no recovery for mechanisms B/D, and only a
partial chance for C** (a mid-export crash may have already uploaded a team recap before failing on
athlete, per `auto_export.py:128-133`'s deliberate team-first ordering). In all cases, clip
metadata (names, notes, ratings, timestamps) survives forever in `raw_clips` — the sweep never
touches it — so the honest failure mode is "your annotations survive, the footage does not," which
`RecapPlayerModal.jsx:593-601` already communicates correctly once T10120 makes it reachable.

## Diagnosing sarkarati's specific game

The expert's proposed diagnostic query assumed `games`/`raw_clips` live in shared Postgres — they
do NOT. Per CLAUDE.md's Migration System table, `games` is defined in
`src/backend/app/database.py`, which is the **profile_db track** (per-user-per-profile SQLite,
R2-synced), not `pg.py`'s shared Postgres. Running the query via `fly proxy ...:5432` will just
fail with "no such table." To actually run it: download sarkarati's profile SQLite from R2 first
(see `reference_changing_env_data`/`edit-user-db.py` playbook, read-only mode), then run locally:

```sql
SELECT id, name, auto_export_status, auto_export_attempts, recap_video_url, blake3_hash,
       (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id) AS total,
       (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id AND rc.my_athlete = 0) AS team_clips,
       (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id AND (rc.my_athlete = 1 OR rc.my_athlete IS NULL)) AS athlete_clips,
       (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id AND rc.filename IS NOT NULL AND rc.filename <> '') AS preserved_extracts,
       (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id AND rc.shared_by IS NOT NULL) AS imported
FROM games g WHERE g.name LIKE '%Breakers%';
```

Then HEAD (not GET) three R2 keys to confirm artifact presence without downloading them:
`{env}/users/{uid}/profiles/{pid}/recaps/{game_id}_team.mp4`, `.../recaps/{game_id}.mp4`, and
`games/{blake3_hash}.mp4`.

- `team_clips = 17, athlete_clips = 0, auto_export_status = 'complete'` → T10120's mechanism (A).
  Team recap exists, nothing lost, T10120's fix alone resolves his game.
- `auto_export_status = 'pending'` → mechanism B. `'failed'` with `attempts >= 3` → mechanism C.
  Check `preserved_extracts` for any surviving pixels; if none, this is genuine data loss for him
  and must be communicated honestly (clip list preserved, footage gone), not silently patched over.

Expert's estimate from the code alone: ~60% mechanism A (T10120 alone fixes it), ~40% B/C (needs
this task's fix plus possibly an honest "footage lost" conversation with him). The query above
settles it definitively — run it before telling him anything is fixed.

## Fix design (expert-authored 2026-09-14)

All changes localized to `sweep_scheduler.py`, plus one `auto_export.py` fix:

1. **Close the `pending` hole.** Add `auto_export_status = 'pending'` to the `needs_export`
   selector (`:374-377`) under the same attempt cap. `do_sweep` is single-threaded per process and
   `auto_export_game` already handles pending re-entry safely — this alone finishes what T2460
   started.
2. **Add an artifact gate before `delete_ref`** (`:185`). New helper,
   `_recap_artifacts_complete(user_id, game_id) -> bool`: for each layer with ≥1 rated clip
   (`_get_annotated_clips`), require `file_exists_in_r2(user_id, recap_r2_keys(game_id, layer)[0])`.
   A game with zero rated clips passes trivially (the legitimate `'skipped'` case). **Refuse to
   delete the ref if any required artifact is missing** — this verifies against R2 directly rather
   than trusting a status column, independently catching B, C, D, and E.
3. **Make exhaustion explicit and loud.** When the attempt cap is reached and the artifact gate
   still fails, write a new terminal `auto_export_status = 'abandoned'` (plain TEXT column, verify
   no CHECK constraint in `database.py`'s `games` DDL before assuming a migration is needed), emit
   **one CRITICAL** log with `user_id`/`profile_id`/`game_id`/`clip_count`/`attempts`, stop
   retrying, and **keep the ref** — never let a permanently-failed export silently destroy the
   source. Reclaiming an `'abandoned'` game becomes an explicit admin action, not a timeout. This is
   the same shape CLAUDE.md already mandates for CAS conflicts: freeze the write, log CRITICAL,
   surface the failure, never auto-merge or blind-retry.
4. **Honor `sync_db_to_r2_explicit`'s return value** (`auto_export.py:110,152,160`). Any result
   other than OK after the `complete` write must log CRITICAL and return a non-settled status so the
   sweep keeps the ref instead of treating the write as durable when it wasn't confirmed current.
5. **Multi-video partial expiry.** Minimal safe fix: refuse `delete_ref` for a hash belonging to a
   game whose *other* hashes haven't expired yet (rather than re-reffing all of a game's videos to
   a common expiry, which is the better long-term model but has credit-semantics implications out
   of scope here).

### Rejected alternatives (expert's reasoning, keep for the design record)
- Backfilling `recap_video_url` from the team recap key via a JIT migration — rejected, repeats the
  one-field-two-meanings mistake T10120 is fixing; the per-layer signal is the correct model.
- UI safety net alone (no sweep fix) — rejected, hides B/C/D/E behind a nicer screen while the sweep
  keeps permanently destroying footage.
- Sweep fix alone (no UI fix, i.e. skip T10120) — rejected, does nothing for already-reclaimed
  all-team-layer games, which per the investigation is the majority of this symptom shape.
- Unbounded retries instead of a terminal `'abandoned'` state — rejected, a deterministically
  failing encode would burn the sweep every cycle forever with no signal.

## Investigation still needed before implementing

Per CLAUDE.md's model policy this already went through the expert agent for root cause + design;
given the destructive/irreversible nature of the sweep (real permanent deletion, no versioning)
this should also get an **Architect design-gate review** before implementation, not just proceed
straight to code — confirm the artifact-gate approach, the `'abandoned'` terminal state, and the
multi-video refusal logic against the full sweep code path before cutting a branch.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/sweep_scheduler.py:167-189` (main sweep loop), `:374-377`
  (`needs_export` selector — mechanism B), `:397-405` (multi-video exclusion — mechanism D)
- `src/backend/app/services/auto_export.py:47` (`MAX_AUTO_EXPORT_ATTEMPTS`), `:93-94` (pending
  re-entry), `:110,152,160` (discarded `SyncResult` — mechanism E), `:122-123,128-133,157-161,577`
  (per-clip swallow, team-first ordering, error handling, recap upload timing)
- `src/backend/app/routers/games.py:927-950` (`_ensure_game_storage_refs`)
- `src/backend/app/storage.py:2135-2166` (`r2_delete_object_global`, confirms no versioning)
- `src/backend/app/database.py` — `games` table DDL, confirm `auto_export_status` has no CHECK
  constraint before adding `'abandoned'`

### Related Tasks
- Split from T10120 (the frontend fix for the most-likely cause of bug 52 — independent, ships
  either order)
- T10130 (storage-expiry banner reassurance copy) is blocked on **this task**, not T10120 — the
  "you can safely let it expire" claim is only true once this sweep hardening ships
- **Bonus landmine found during this investigation, filed separately**: T10122 —
  `extend_game_storage` charges credits without verifying the video still exists

### Technical Notes
- No silent fallbacks, no defensive self-repair, fail loud — this task IS that principle applied to
  the sweep; don't regress it while implementing.
- Every write here happens inside the background sweep, which `export-pipeline.md:611` documents as
  the one sanctioned gesture-less writer — this is not a violation of gesture-based persistence.

## Implementation

### Steps
1. [ ] Architect design-gate review of the fix design above (destructive operation, real design
   surface area).
2. [ ] Close the `pending` selector hole.
3. [ ] Implement the R2 artifact-gate before `delete_ref`.
4. [ ] Implement the terminal `'abandoned'` status + CRITICAL logging + ref retention.
5. [ ] Honor `SyncResult` in `auto_export.py`.
6. [ ] Fix multi-video partial-expiry ref deletion.
7. [ ] Backend tests (curated ~10): sweep must not delete a ref when a required recap artifact is
   absent; a `pending` game is re-selected; exhaustion writes `'abandoned'` + CRITICAL + keeps the
   ref; partial multi-video expiry does not delete the expired half's ref (the missing regression
   for `test_multi_video_partially_expired_excluded`).
8. [ ] Determine whether any already-`'abandoned'`-shaped games exist on prod today and need
   individual remediation (data-safety rules apply — confirm scope before any write).

### Progress Log

**2026-09-14**: Split out of T10120 after the expert investigation found this was the larger,
more severe finding. Not yet Architect-reviewed or started.

## Acceptance Criteria

- [ ] A `pending`-stuck game is retried, not silently abandoned to reclaim.
- [ ] The sweep cannot delete a game's source video ref while a required recap artifact is missing
      from R2.
- [ ] Permanent export failure produces a CRITICAL log and a terminal, non-silent state — never a
      timeout that quietly proceeds to deletion.
- [ ] A `SyncResult` other than OK after an export write blocks reclaim instead of being ignored.
- [ ] A multi-video game's still-active half is never reclaimed because its sibling hash expired.
- [ ] Backend tests cover all four mechanisms above.
