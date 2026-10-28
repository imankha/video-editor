# T13820 Design: sync QA Playwright matrix (deltas against the task file)

**Status:** AWAITING APPROVAL. No implementation code has been written.
**Knowledge docs:** annotate.md, export-pipeline.md, persistence-sync.md (a "sync QA suite" section is added at the last step).
**Consumes (T13810, committed):** `window.__syncCheck(ids)`, `window.__syncTrace.entries()`, `GET /api/qa/sync-state`, `[STATE]`/`[REQ]` log lines.

## 1. Seam: `POST /api/test/seed-published-highlight` (test_seams.py, gated like the others)

Request (all optional):
```
{ "name": "Seeded Highlight", "aspect_ratio": "9:16", "published": true,
  "shared_by": null, "my_athlete": 1, "with_media": true,
  "game_id": null, "raw_clip_id": null,          # reuse an existing game/play (S6: second orientation)
  "archive_missing": false }                       # S9 404 case
```
Creates (single transaction, then optional R2 upload): game (unless `game_id`), raw clip (unless `raw_clip_id`; `shared_by`/`my_athlete` honored), auto project (`is_auto_created=1`, `source_raw_clip_id`, `raw_clips.auto_project_id`), `final_videos` row with `project_id` set, `published_at` set iff `published`, filename pointing at a real tiny mp4 (`_generate_tiny_mp4`) in the final_videos prefix. When published, the project is archived exactly as the real publish leaves it, with its archive object uploaded unless `archive_missing` (then the object is deliberately absent so restore returns 404).
Response: `{status, game_id, raw_clip_id, project_id, final_video_id, filename, media_uploaded, archive_uploaded}`.
Backend test: `src/backend/tests/test_t13820_seed_published_highlight.py` (rows exist and are linked; `published=false` leaves `published_at` NULL; seams-disabled returns 404; `archive_missing` skips the archive object). Red first against the unchanged router (404 route missing).

## 2. Spec layout (chromium + iphone only)

```
e2e/helpers/syncCheck.js        seedHighlight(), probe(), syncStep(page, label, ids), saveSyncEvidence()
e2e/sync/s1-s3.sync.spec.js     S1 (real render, once per project), S2, S3
e2e/sync/s4-s5.sync.spec.js     delete, move to second profile
e2e/sync/s6.sync.spec.js        both orientations
e2e/sync/s7-s8.sync.spec.js     export in flight / failed (sync-fault seam)
e2e/sync/s9.sync.spec.js        failed restore: 503 and 404
e2e/sync/s10-s12.sync.spec.js   rankings, selectedProject copy, shared-in
```
`playwright.config.js`: add a `sync` testMatch (`e2e/sync/*.sync.spec.js`) to `chromium` and to `iphone`; existing `iphone` is `testMatch: screen-usability` only, so the sync specs are added with a second project `iphone-sync` (same device) rather than widening `iphone`. Command: `npx playwright test e2e/sync --project=chromium --project=iphone-sync`.
Auth: dedicated e2e account via `POST /api/auth/test-login` + `X-Test-Mode` (T11990 pattern), one user id per spec (`e2e-t13820-<scenario>`), never the user's own account. One `test()` per scenario; `describe.serial` only inside a scenario.

## 3. Step contract (`syncStep`)

After every gesture: (1) wait for the expected holders' `fetch`/`write` entries in `__syncTrace.entries()` (by holder + `seq` > the gesture's start seq) plus `networkidle`, never a sleep; fail with the missing holder named if the entry never arrives within 10 s (that is itself a finding: "holder never refreshed"). (2) Read UI assertions (text/role). (3) `__syncCheck(ids)` must report zero mismatches. (4) Server probe JSON. Then navigate to each other listening screen without reload and repeat (1)-(4), then reload and repeat. Evidence per step to `qa/sync/<scenario>/<device>/<step>/` (screenshot, check.json, trace.json, probe.json, backend log lines for the trace's request ids via `reduce_log`).

## 4. Findings protocol
Unchanged from the task file. A failing step is a finding: reproduce once from fresh seam state, classify (a)-(f), file `T13830+` (check origin/master first; T13830/T13840 are already taken, so start at the next free id) with the attribution row, insert at the top of the PLAN.md bugs section, and mark the spec `test.fixme('<T-id>')` with the assertion intact. Only a seam/spec bug in this task's own code is fixed here.

## 5. Risks / open decisions
- S1 needs the real local-FFmpeg render in the container; if the container has no usable render path, S1 runs from the seam and the render gap is recorded.
- The matrix has to run against a live stack (backend + vite + R2 or local storage). The container has none running, so the run happens after approval and under `/dotask land` rules; budget ~15 min.
- Decision for you: approve the extra `iphone-sync` project name (vs. widening `iphone`), and approve that the suite stays out of Branch CI (CI never runs `e2e/**`).

## Test scope (curated)
`test_t13820_seed_published_highlight.py`, `test_t13810_sync_state_probe.py`, `test_t13810_state_log.py`, `syncCheck.test.js`, `syncTrace.test.js`, plus one sync spec on chromium (S2 from the seam).
