# T4110: Edit-a-reel persistence — re-export/publish silently lost end to end

**Status:** TODO
**Type:** Bug (prod, data-loss / durability)
**Reported by:** imankh@gmail.com (prod), 2026-06-28
**Follows:** T4050 (durable sync for publish/restore/delete), T4010 (atomic re-export), T4020 (framing shadow)

## Symptom (user words)

> "On prod I just edited a reel for the *at Legends Mar 28* game that occurred at the 59th
> minute. I exported successfully and 'Moved It To My Reels' but I don't see it in My Reels.
> I'm still yet to see edit work end to end. Also I have 2 'Game Highlights' collections for
> this game; the phantom one is broken (nothing happens when I hit play). These are probably
> related."

## Investigation (supervisor, from prod R2 ground truth — all confirmed)

Account: user `3ed03fb5-949d-4cfd-b708-0c758ea68ef3`, profile `9fa7378c`. Game 6 = "at Legends Mar 28".

- **The 59th-minute reel = project 46 / final_video id 29** ("Brilliant Dribble and Pass",
  `clip_game_start_time=3566s` ≈ game-min 59.4, 36.3s). In R2 it is **still v1, published 06-20**.
  **Today's re-edit produced NOTHING in R2**: no `export_jobs` row dated 06-28, no new
  `final_46_*.mp4` object, no v2 `final_videos` row.
- **Project 41 / final_video id 36** ("Brilliant Dribble", game-min 33) is in a stuck half-state:
  exported 06-27 (object `final_41_997d773b.mp4` present in R2), but `published_at = NULL` and
  `projects.archived_at = NULL` (never archived) → **the publish ("Move to My Reels") was lost**.
- All 10 other game-6 reels: published, 9:16, `.mp4` objects present, fine.
- **Every game-6 reel is 9:16** — so the real collection is ONE "Game Highlights" card with all
  reels playable. `GameCollectionGroup` renders one "Game Highlights" CollectionCard **per eligible
  aspect ratio** (`src/frontend/src/components/collections/GameCollectionGroup.jsx:74-88`). The
  "second/phantom Game Highlights that plays nothing" is **transient client state** from the
  unpersisted edit (a reframe/retrim that never reached R2); a hard reload collapses it back to the
  single working card. The two symptoms are the SAME bug.
- Prod runs a **single** Fly machine (`reel-ballers-api`), restarted **19:05Z today** (deploy);
  user active 19:09. Game-6 source video is NOT expired (`storage_expires_at=2026-07-09`, status ready).
- Minor side-finding (not the bug): orphaned R2 objects from prior re-exports never cleaned up
  (`final_18_edbd4a4b.mp4`, `final_55_58d385e8.mp4`).

## Root cause (hypothesis to CONFIRM via live repro, then fix)

T4050 made the **request-scoped** gestures (publish / restore-for-edit / delete) durable
(sync-before-respond inside the per-user write lock). It did **not** harden the **background export
worker**: `_finalize_overlay_export` (`src/backend/app/routers/export/overlay.py:94-194`) commits the
new `final_videos` / `export_jobs` rows to the LOCAL per-user `profile.sqlite` and relies on
**fire-and-forget** R2 sync. The rendered `.mp4` uploads directly to R2, but the DB rows that POINT
at it do not durably sync. On a single autostopping/redeploying machine, those local writes are lost
when the machine cycles before the background sync runs → the edit silently reverts. The publish that
follows then has nothing new (or itself rode the pre-T4050 fire-and-forget path on 06-27 for proj 41).

Reference: T4050 commit `0bff519d` ("re-export of reel ... fails silently") and the in-code note at
`overlay.py:161-164` ("if a re-export never reaches here, prod max final_video.id stuck") — prod max
`final_video.id` IS stuck at 36 (project 41), consistent with lost/never-finalized re-exports.

Memory caveat: persistence-model/fire-and-forget changes were previously deferred until sessions are
pinned to one machine (blocked T1537). Prod is single-machine now and T4050 already began hardening
gestures, so extending durability to the export path is in-scope. Keep the change **gesture-aligned**
(the export-complete finalize IS a durable boundary tied to the user's export action) and do NOT add
reactive persistence.

## Plan

### Step 1 — REPRODUCE LIVE FIRST (report back to supervisor before fixing)
Drive the app as the real user on the dev stack and confirm the exact break point:
```
bash scripts/dev-verify.sh e2e/T4110-reedit-reel-persistence.spec.js --reporter=line
```
Write `e2e/T4110-reedit-reel-persistence.spec.js` using `loginAsRealUser(context,'imankh@gmail.com')`
(see `e2e/helpers/realAuth.js` + drive-app-as-user skill). Flow: open My Reels → Edit a published
game-6 reel → make an edit (reframe and/or retrim) → export → "Move to My Reels". Capture:
- the network calls + status for the export-complete, `/publish/{project_id}`, and
  `/{download_id}/restore-project` requests;
- backend `[ReExport]` / `[Publish]` / `[SYNC]` / `[Restore]` log lines (T4050 tracing) — does the
  finalize run? does the DB sync to R2 succeed? does publish 200 or 503?
- whether a SECOND aspect-ratio / phantom "Game Highlights" card appears (deterministic shadow/ratio
  bug à la T4020) vs only transient.
Add `console.warn('[DBG] ...')` tracing as needed (strip before commit). **Report the confirmed break
point here and STOP for supervisor review** before implementing.

### Step 2 — FIX (after repro confirms)
Extend T4050's durable-sync to the export finalize path so the new `final_videos`/`export_jobs` rows
are durably synced to R2 before the export is reported complete (and/or have `publish` verify the
export row is present in R2-backed state and re-sync if not). Re-use `_background_sync(lock_timeout=
None)` / the `durable_sync` machinery in `src/backend/app/middleware/db_sync.py`. If repro reveals a
deterministic secondary bug (phantom collection card / shadow version / ratio split), fix that too.
Test-first per backend `bug-reproduction` skill.

### Step 3 — MIGRATION (prod data repair, runs at deploy)
Write a `profile_db` versioned migration (`src/backend/app/migrations/profile_db/vNNN_*.py`; bump
`PRAGMA user_version`; update `_SCHEMA_DDL`/`ensure_database()` only if schema changes — likely not).
It must be **idempotent and safe for all users** (run_all_migrations applies per-user across R2). Heal
the lost-publish half-state: for any project that is **not archived**, **has a completed export**
(a `final_videos` row + the `.mp4` object) but whose latest final has `published_at IS NULL` AND the
project carries no in-progress editing intent — re-publish the latest final and archive the project
(mirror `publish_to_my_reels`). Scope the predicate tightly so it ONLY matches the stuck signature
(this repairs imankh's project 41). Confirm against the prod snapshot before finalizing the predicate.
See memory "Running Migrations" + `scripts/edit-user-db.py` for verifying against prod data.

## Classification

**Stack Layers:** Backend (export/durability + migration) + Frontend (if a deterministic phantom-card bug is found)
**Files Affected:** ~4-7
**LOC Estimate:** ~150-300
**Test Scope:** Backend (durability test, ASGITransport + in-memory R2, like `test_t4050_durable_sync.py`) + Frontend E2E (the repro spec)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes | Map export finalize + sync + collections aggregation interplay |
| Architect | Yes | Durability approach touches persistence model; design-gate the durable-export boundary + migration predicate |
| Tester | Yes | Repro spec (Step 1) + durability unit test (Step 2) |
| Reviewer | Yes | Data-loss / persistence-model change, high scrutiny |
| Migration | Yes | profile_db heal migration (Step 3) |

## Relevant files
- `src/backend/app/routers/export/overlay.py` (`_finalize_overlay_export` ~L94; prior-object delete ~L84-91)
- `src/backend/app/middleware/db_sync.py` (`durable_sync`, `_background_sync`)
- `src/backend/app/routers/downloads.py` (`publish_to_my_reels` ~L815, `restore_project_from_archive` ~L920, `list_downloads` ~L215)
- `src/backend/app/queries.py` (`latest_final_videos_subquery` ~L104)
- `src/backend/app/routers/collections.py` (`collections_summary` ~L282)
- `src/frontend/src/components/collections/GameCollectionGroup.jsx`
- `src/backend/tests/test_t4050_durable_sync.py` (durability test pattern to follow)
- `e2e/helpers/realAuth.js`, `scripts/dev-verify.sh` (live repro)
