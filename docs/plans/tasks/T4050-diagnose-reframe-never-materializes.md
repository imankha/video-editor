# T4050: Diagnose - Re-edited reel's new framing never materializes

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-06-27
**Updated:** 2026-06-27

## DIAGNOSE ONLY — no fix this pass

The user (author, prod, imankh@gmail.com) wants this **root-caused and reported back first**, then
we decide the fix together. Do **NOT** implement a fix, do **NOT** change task statuses, do **NOT**
commit code changes. Producing a **failing reproduction test** (committed) is encouraged if feasible;
otherwise deliver a written root-cause report. This follows two prior partial fixes (T4010 atomic
re-export, T4020 framing shadow) that did not resolve it.

## Symptom (user's words)

> "I tried to edit a clip [a published reel], set it from 9:16 to 16:9, hit export, and the new
> framing never seems to have materialized. I get a draft card with no preview, and the reel is not
> in My Reels. **Even within the session, after I edit I never get to see the re-framed clip.**"

So: **edit a published reel → re-frame (e.g. 9:16 → 16:9) → re-export → the new re-framed reel never
appears (no visible working/preview result), even before any reload.**

## Adopted product model (decided by user 2026-06-27 — context, NOT the bug)

- **Edit moves the reel back to Drafts (unpublished).** This is INTENDED — keep it.
- After editing + re-export, the user **re-publishes** via "Move to My Reels". No "replace in place" /
  no carrying `published_at` forward. This simplifies code + UX.
- The bug is purely that **the re-framed result never materializes** so there's nothing to republish.

## Grounding from prod forensics (already done by supervisor — trust these)

- **No data loss:** all 38 `final_videos` R2 objects are intact; the user's reel is safe and still in
  My Reels (the 59'26" "Brilliant Dribble", source clip at game-time ~3566s).
- **Live machine DB == R2** (db-version 2221, last sync 2026-06-25): the re-edit session's working
  data (the restored project's `working_clips`, e.g. transient `working_clip id=56`) is **not present**
  in the persisted DB — it existed only during the session.
- **Frontend console during the failing edit** showed the restored project's source clip failing to
  load: `clip id=56 missing dims (width/height/fps null)`, `[videoMetadata] FAIL ... moov parse
  failed`, and `Probe fallback failed for clip id=56: head fetch threw: Failed to fetch (head)`.
  -> The **source video for the clip could not be fetched** when re-editing. A leading hypothesis is
  that the game's source mp4 (`games/{blake3}.mp4`) was reclaimed/expired, so re-cropping has no
  source to render — but CONFIRM, don't assume; it could also be a framing-export/save bug or a
  transient fetch failure that the code then handles wrongly.
- **Persistence is secondary here:** per-user writes commit to local SQLite and sync to R2 via a
  **fire-and-forget background task** (`src/backend/app/middleware/db_sync.py` ~L634). The user
  confirms the re-frame fails to appear *in-session*, so the primary bug is upstream of R2 sync.

## Your job (diagnosis)

Reproduce and root-cause **where in the re-edit -> re-frame -> re-export pipeline the new framing is
lost**, end to end. Follow the evidence — do not stop at the first plausible cause. Specifically trace:

1. **Restore for edit:** `POST /api/downloads/{id}/restore-project` -> `restore_project`
   (`src/backend/app/services/project_archive.py`): does it faithfully restore `working_clips` /
   `working_videos` / crop+segments so the framing editor has a valid source? What happens when the
   source clip's video object is missing (the `clip 56` fetch failure)?
2. **Framing re-export:** `POST /crop` and `POST /framing` (`src/backend/app/routers/export/framing.py`)
   and `multi_clip._export_clips`: does the re-framed (9:16->16:9) working video get produced and
   **saved/replaced** on the restored project? Watch for the T4020 "shadow version" failure mode
   (a redundant post-render save writing an empty working-clip version that later gets pruned).
3. **Working-video persistence:** is the new framing written to `working_videos`/`working_clips` and
   pointed at by the project, or does it silently no-op / write an empty version?
4. **Overlay -> final:** `POST /final` and `_finalize_overlay_export`
   (`src/backend/app/routers/export/overlay.py`): does a new `final_videos` row + R2 object get
   created for the re-framed reel? (Max `final_video.id` in prod is still 36 -> suggests the re-export
   **never reached** a successful final insert.)
5. **Source availability:** confirm whether re-editing a reel whose game source video is gone is the
   trigger. Check the game-expiry / `game_storage` model and how the editor/export behaves when
   `games/{blake3}.mp4` is absent. Should re-edit be blocked/warned up front instead of silently
   producing nothing?

### How to reproduce (prefer test-first over full E2E)

Full E2E needs a game video + annotated clip + published reel — heavy. Prefer leveraging existing
backend tests/fixtures that already exercise the archive/restore + re-export round-trip:
- `src/backend/tests/test_t4010_reexport_in_place.py`
- `src/backend/tests/test_archive_restore_bugs.py`
- `src/backend/tests/test_framing_actions.py`
Write a focused **failing** test that drives: published reel -> restore_project -> re-frame export ->
assert the new re-framed working video + final video materialize (and assert the desired
Edit->Drafts->republish state). If a missing-source path is the cause, add a test asserting the
expected loud failure instead of silent loss. Run with
`cd src/backend && .venv/Scripts/python.exe run_tests.py` (or `pytest tests/<file> -v`), redirect
output to a log, report exit code.

## Deliverable (report back, do NOT fix)

A written root-cause report covering:
1. **Exact failure point** (file:line) where the re-framed result is lost, with the call chain.
2. **Trigger conditions** (e.g. only when source video missing? only on a restored project? always?).
3. Whether a **failing reproduction test** was achieved (commit just that test if so, explicit paths
   only — `git add <file>`, never `-A`).
4. **Proposed fix options** with trade-offs (including the Edit->Drafts->republish model and
   fail-loud-on-missing-source), for the user to choose. No implementation.

## Relevant Files
- `src/backend/app/services/project_archive.py` - archive/restore round-trip
- `src/backend/app/routers/export/framing.py` - `/crop`, `/framing` re-frame export
- `src/backend/app/routers/export/multi_clip.py` - `_export_clips`
- `src/backend/app/routers/export/overlay.py` - `/final`, `_finalize_overlay_export`
- `src/backend/app/routers/downloads.py` - `restore-project` (L882), `publish` (L810)
- `src/backend/app/middleware/db_sync.py` - fire-and-forget R2 sync (secondary)
- `src/frontend/src/hooks/useProjectLoader*` - the `clip 56 missing dims` / probe-fallback path
- Tests: `test_t4010_reexport_in_place.py`, `test_archive_restore_bugs.py`, `test_framing_actions.py`

## Related
- **Follows (unresolved):** T4010 (atomic re-export), T4020 (framing shadow version)
- **Deferred:** durable-persist of writes (fire-and-forget sync; user says not the cause here)
