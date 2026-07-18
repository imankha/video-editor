# T5410: Poster selection rework - athletic open-play frame, computed at overlay (no extra Modal), + user-editable preview

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-17
**Follows:** [clearest-frame-posters EPIC](clearest-frame-posters/EPIC.md) (that epic shipped the og:image mechanism + a byte-size "clearest frame" heuristic; this task replaces the heuristic, moves the compute, and adds a manual override)

## Problem

The share-link/email poster is chosen by `extract_clearest_frame_jpeg` (largest-JPEG-among-5-samples in the first half of the first slow-mo section). A user-ranking study on real prod reels (imankh) proved this is **worse than random** and samples the **wrong part of the reel**.

### Study evidence (why we're changing it)

Ranking experiments where the user ordered candidate frames by cover-worthiness (Spearman vs user ranking):

- **Byte size (shipping today): -0.54** - actively backwards. It rewards whole-scene detail (bleachers, tree lines, field lines), not the subject.
- **Zone dominates everything.** Frames from the **spotlight moment** (the ~0-2s auto-highlighted instant) ranked WORST (mean normalized rank 0.80, never #1 across 5 reels, sometimes rejected outright). Frames from **open-play slow-mo** (a few seconds into the slow-mo, player running clear) ranked BEST (0.38, #1 in 4/5). The auto-spotlight fires on the *contested/occluded* instant - exactly what reads badly as a cover.
- **Within open-play, all pixel/box features are weak** (|Spearman| <= 0.23): subject size/height +0.23, ball-near-subject notably better (0.88 vs 0.74 goodness), occlusion +0.11, player-count +0.09. **Rejected as non-predictive:** YOLO confidence (-0.11, mildly wrong - high conf = static upright player), box aspect ratio (-0.12), sharpness (-0.08), byte size (-0.54).
- Conclusion: encode **one big weight (zone) + light nudges**; do NOT try to learn a precise weight vector (only ~25 labeled frames - would overfit). The residual within-zone preference is aesthetic - handle it with a **manual override**, not a fragile model.

## Solution (three parts)

### 1. New selection algorithm: athletic open-play frame

Replace the byte-size heuristic with a zone-weighted score over candidate frames:

```
score =  10.0 * in_open_play_slowmo     # DOMINANT: source from the slow-mo, skipping
                                         #   the first ~2s spotlight window AND the outro
       +  2.0 * subject_size            # subject box height / frame height (bigger = better)
       +  1.5 * ball_present            # a detected sports-ball near the subject box
       +  1.0 * (1 - occlusion)         # subject box not overlapped by other player boxes
       # confidence, aspect, sharpness, byte-size: weight 0 (proven non-predictive/backwards)
```

Weights are set from measured effect sizes, not learned (honest at this sample size). Candidate window = the reel's slow-mo section from `final_videos.slowmo_section_start/end` (already frozen, v025), **excluding** the first ~2s spotlight region and the trailing branded outro. No slow-mo section -> fall back to whole clip minus outro (still drop byte size). Subject = the tracked spotlighted player where known (see part 2), else the largest lower-central person box.

### 2. Move the compute to the overlay phase (no additional Modal)

Today the poster is captured at publish (T5280) with a bare ffmpeg frame grab. The new score needs **player+ball detection** across the open-play window. Detection already runs during the **overlay/spotlight phase** (`routers/detection.py`, YOLOv8x, results cached in R2 `detections/{working_video}/frame_N.json`) and the tracked-subject boxes are already frozen into `working_videos.highlights_data` (`region.detections` = all boxes+conf per sampled frame; `region.keyframes` = the tracked subject). **Verified: overlay/detection time == final-video time (identity map)** - a detection at working-video time t is the frame at final time t (confirmed by box alignment at final=2.0s).

**The gap:** stored detections currently cover only the ~2s spotlight region - i.e. the WORST zone, not the open-play zone we now select from. So the overlay phase must **extend detection sampling to the open-play slow-mo window** (reusing the SAME detection path/cache - not a new Modal function), compute the best poster frame time, and freeze it so publish just grabs that frame. This keeps detection cost inside the work the overlay phase already does and adds **zero Modal at publish**.

- Persist the chosen poster frame time (e.g. `final_videos.poster_frame_time` or on the working_video) at the overlay->export boundary, gesture-scoped (no reactive writes - see CLAUDE.md persistence rules).
- At publish, `generate_poster_at_publish` grabs the frame at that stored time instead of running the byte-size sampler.
- **Architect decision needed:** exactly where detection over the open-play window runs (extend the overlay auto-detect sweep vs. a CPU-YOLO pass in the export worker - both avoid a new Modal job; CPU-YOLO at export is simplest and Modal-free, YOLOv8n is ~1s for 10 frames per the benchmark). Land the choice in the design doc.

### 3. User-editable preview image (manual override, the aesthetic last mile)

After export completes, a **completed draft/reel** gets a "**View / edit preview image**" action (one of the options on a finished draft card). It opens the current poster plus:
- a **scrubber over the final video** to pick an exact frame ("Set as cover"), and
- an **upload-your-own-image** option (custom cover).

On confirm, the selected frame/image becomes the poster: overwrite the R2 poster object + `final_videos.poster_filename` via a **surgical, gesture-triggered** API call (explicit user action only - never reactive). This is the reliable answer for the within-zone aesthetic preference the auto-score can't capture. Consumers (`shares.py::_resolve_poster` / `_serve_poster_jpeg`, edge og:image, and the T4890-follow-on email thumbnail) are unchanged - they already read `poster_filename`.

## Context

### Relevant files
- `src/backend/app/services/poster.py` - `extract_clearest_frame_jpeg` (byte-size heuristic to REPLACE), `generate_poster_at_publish` (T5280 capture point), `first_slowmo_section`/`resolve_slowmo_section` (final-time math to reuse), `backfill_posters` (admin regen - extend for the new algo).
- `src/backend/app/routers/detection.py` - YOLO person+ball detection; R2 cache scheme.
- `working_videos.highlights_data` - `region.detections` (boxes+conf) + `region.keyframes` (tracked subject); identity time map.
- `final_videos` - `poster_filename` (v024), `slowmo_section_start/end` (v025); add poster-frame-time + any override flag (migration - Migration agent).
- `src/backend/app/routers/shares.py` - `_resolve_poster`, `_serve_poster_jpeg` (poster consumers; unchanged).
- Frontend: overlay phase (`src/frontend/src/modes/overlay/`, `usePlayerDetection.js`, `detectionAssignment.js`) for the detection sweep; the drafts/gallery UI (`ProjectManager.jsx` / downloads / gallery card) for the "edit preview image" action + scrubber modal.

### Related tasks
- Builds on: T4890 (og:image mechanism), T5090/T5180/T5270/T5280 (poster policy + publish-time capture).
- Feeds: the share-email **play-button thumbnail** (embed this poster in the share email to lift CTR - same frame feeds og:image + email).

### Backfill
Existing reels have no open-play detections stored. Backfill via an admin CPU-YOLO pass over published finals (mirror `backfill_posters`), or accept existing posters until re-exported. Decide in design; no silent read-time fallback (log/omit per CLAUDE.md).

## Classification hint
**L-tier**: backend selection change + detection-timing move + schema/migration + frontend override UX (modal + scrubber + upload) + backfill. Architect design gate required (esp. where open-play detection runs, and the poster-frame-time persistence path). Migration agent for the new column(s).

## Acceptance criteria
- [ ] Poster is selected from open-play slow-mo (spotlight ~2s + outro excluded), by the zone-weighted score; byte-size heuristic removed.
- [ ] Selection runs off detections produced in the overlay phase (or a Modal-free CPU pass) - **no new/extra Modal at publish**.
- [ ] Publish captures the pre-chosen frame; poster object + `poster_filename` land before the durable-sync barrier (preserve T4110/T5280 invariants; poster failure never fails export).
- [ ] A completed draft exposes "View / edit preview image": scrub-to-frame AND upload-custom, both writing the poster via a gesture-scoped surgical call.
- [ ] Existing reels handled per chosen backfill strategy (no silent fallback).
- [ ] Tests: selection scoring unit tests (zone/size/ball/occlusion), override endpoint test, edge/share poster still served. Real unfurl + email spot-check.

---

## Implementation Details

> Full design + rationale: [T5410-design.md](T5410-design.md). This section is the implementor's concrete change list. **REVISED 2026-07-17** per two authoritative user decisions (below).

### Key architectural decisions (user-authoritative; see design §0, §4)
- **Detection runs on MODAL, during overlay EXPORT** — reuse the existing `detection.py::call_modal_detect_players` (YOLOv8x), NOT a new Modal function, run over the open-play frames. **CPU-at-publish is REJECTED** — a CPU YOLO pass on the Fly API worker would overload the server (user).
- **Poster select+generate MOVES from publish (T5280) to the overlay export/finalize step.** The poster therefore exists at export-complete → the "Edit preview image" UX lives on the completed **DRAFT** card (post-export), not the published My-Reels card. **This REVERSES T5280** (accepted tradeoff: every exported draft pays the Modal detection cost even if never published — see design §5).
- **Detect on the FINAL R2 object** (`final_videos/{filename}`), not working clips: final-time offsets are already resolved, so the frozen `slowmo_section` maps 1:1 and the identity time-map is moot.
- **The `10*zone` weight is realized as a candidate-window gate**, not a per-candidate term. Within-window ranking = `2*subject_size + 1.5*ball_present + 1*(1-occlusion)`.
- **"Exclude the trailing outro" is a near no-op post-T3950** (stored finals carry no baked outro); keep only a small end-margin.
- **Override writes overwrite the deterministic R2 poster key** → consumers (`shares.py`, edge og:image) need zero changes.

### Backend — `src/backend/app/services/poster.py`
- Add constants: `SPOTLIGHT_SKIP_SECONDS=2.0`, `END_MARGIN_SECONDS=0.3`, `MIN_WINDOW_SECONDS=0.5`, `N_SAMPLES=12`, `PERSON_CLASS_ID=0`, `BALL_CLASS_ID=32`, `BALL_NEAR_RADIUS_FRAC`.
- Add pure/testable helpers: `open_play_window(section, final_duration) -> (start,end)|None`, `pick_subject(boxes, frame_dims) -> box|None`, `score_candidate(subject, boxes, frame_dims) -> float`.
- Add `modal_detect_cached(user_id, input_key, frame_number)` — check R2 cache (`get_cached_detection`), else `call_modal_detect_players(...)` + `cache_detection_result` (reuses `detection.py`'s cache scheme; person+ball only).
- Add **async** `select_poster_frame(user_id, final_filename, window, fps) -> time` — sample ~12 final-time frames → parallel Modal detect (`asyncio.gather`) on `final_videos/{filename}` → score → best time; empty detection → **window midpoint** (logged), never first-frame.
- **Rename** `generate_poster_at_publish` → **async** `generate_poster_at_export(user_id, final_video_id, final_filename, section, final_duration, fps)`: `open_play_window` → `select_poster_frame` → ffmpeg grab best frame → upload → set `poster_filename`+`poster_frame_time`+`poster_source='auto'`. Best-effort/never-raises unchanged.
- Add `store_override_poster(user_id, final_video_id, final_filename, jpeg_bytes, source, frame_time)` — shared override writer (overwrite deterministic key + set 3 columns).
- Update `backfill_posters(force=..)`: run `select_poster_frame` (Modal) on each published reel's **existing final object**; **skip `poster_source IN ('scrub','upload')`** even under force; heal `poster_frame_time`/`poster_source`. Add `poster_source` to the candidate SQL.
- `extract_clearest_frame_jpeg` stays ONLY for recap posters (T5180 path unaffected).

### Backend — export hook (`src/backend/app/routers/export/overlay.py`)
- Hook point: `_finalize_overlay_export` (overlay.py:111) already computes+freezes `slowmo_section` and INSERTs `final_videos` (returns `final_video_id`); the FINAL video is already in R2. In each **async** completion path that calls it (`_run_overlay_export_background`, no-keyframes copy, test path, `export_final`), `await generate_poster_at_export(...)` **after** finalize returns and **before** the sync-then-announce barrier, so `poster_*` columns ride the existing `sync_export_db_to_r2`. (Do NOT block the sync `_finalize_overlay_export` on an event loop.)
- Pass the render's known fps + `duration` into the poster call (avoid a redundant ffprobe; probe only as fallback).
- Poster failure → export still COMPLETE with `poster_filename` NULL (never fatal; T4110 barrier intact).

### Backend — publish (`downloads.py`, REVERSE T5280)
- `publish_to_my_reels` **no longer generates** the poster. Replace the `asyncio.to_thread(generate_poster_at_publish, ...)` block (downloads.py:~1291) with a cheap best-effort existence check (HEAD the deterministic key; log at info if absent). No Modal/ffmpeg at publish.

### Backend — schema/migration
- New `final_videos` columns: `poster_frame_time REAL` (nullable), `poster_source TEXT` (nullable; `'auto'|'scrub'|'upload'`, NULL=legacy/auto).
- Migration `src/backend/app/migrations/profile_db/v026_add_poster_frame_fields.py` (Migration agent): additive guarded `ALTER TABLE` (mirror v025); **no data backfill**; tuple-row-factory safe.
- Add both columns to `database.py::ensure_database` `CREATE TABLE final_videos` (after line 688).
- Migrations don't auto-run — trigger `POST /api/admin/migrate` after deploy, before backfill.

### Backend — override endpoints (`src/backend/app/routers/downloads.py`)
- `POST /api/downloads/{final_video_id}/poster/frame` `{time}` → grab final-video frame at `time`, `store_override_poster(source='scrub', frame_time=time)`. `Depends(durable_sync)`.
- `POST /api/downloads/{final_video_id}/poster/upload` (multipart image) → decode-verify + re-encode JPEG (cap long edge ~1440px), `store_override_poster(source='upload', frame_time=NULL)`. `Depends(durable_sync)`.
- Both: current-profile ownership, gesture-only (no reactive persistence). Available for a completed draft's final object (works pre- and post-publish).

### Frontend — editable preview UX (on the completed DRAFT)
- `ProjectManager.jsx`: on the completed-draft card (`ProjectCard`, `has_final_video` branch ~line 1654), add an **"Edit preview image"** action. Opens new `PosterEditModal.jsx` with the draft's `final_video_id` + `poster_frame_time`.
- `PosterEditModal.jsx` (new, View): current poster + `<video>` on the draft's final stream scrubber, **"Set as cover"** (captures current time), **upload** file input. Scrubber default = `poster_frame_time`. No backdrop-close. Writes only on confirm click.
- Draft hook / `useDownloads.js`: add surgical `setPosterFrame(id, time)` + `uploadPoster(id, file)` (POST; update local `poster_filename`/`poster_frame_time` on success; store raw, no derived flags).

### Backfill (existing reels)
- Admin **Modal-detection** force-regen via extended `backfill_posters(force=true)` on existing final objects (`call_modal_detect_players` on the final R2 key over the open-play window); skip user overrides; missing final → `skipped_gone` (logged); empty detection → midpoint (logged). Cache reuse (`detections/{fn}/frame_N.json`). Staging → single prod pass → `verify_share_unfurl.py`. (Rejected: regenerate-on-next-export.)

### Tests
- Unit: `open_play_window`, `score_candidate`, `pick_subject`, `select_poster_frame` empty→midpoint (Modal mocked; synthetic box fixtures).
- Integration: export finalize sets `poster_*` (`poster_source='auto'`, Modal mocked); poster failure → export still COMPLETE (barrier intact); both override endpoints (columns + `poster_source` + durable 503); backfill `force` skips overrides; publish no longer generates; `shares.py` still serves the overwritten poster.
- Frontend: modal seeks to `poster_frame_time`; confirm fires ONE POST; `no-persistence-in-effects` clean.
- Manual: real unfurl + email thumbnail after staging backfill.

### Invariants preserved
Poster failure never fails export; poster set before the T4110 sync-then-announce barrier at finalize; gesture-based surgical persistence; poster served via the token-gated proxy (never presigned og:image, EPIC decision #5). T4175 expiry-sweep is NOT a `final_videos` writer → no poster hook needed there.

### Open questions for the user (design §7)
- **RESOLVED #1:** detection = Modal, at overlay export (CPU rejected — would overload server).
- **RESOLVED #3:** edit surface = completed-DRAFT card (poster exists at export-complete).
2. "Exclude outro" is a no-op post-T3950 — OK to keep only an end-margin?
4. Upload validation: decode-verify + re-encode + cap long edge ~1440px, don't force aspect — OK?
5. `poster_frame_time` = NULL on upload; scrubber then defaults to reel midpoint — OK?
6. **NEW** — export latency: run the Modal poster before the sync barrier (durable, +latency) vs deferred after announce (`sync_db_to_r2_explicit`)? Recommend: before the barrier unless staging shows unacceptable latency.
6b. **NEW** — never-published-draft Modal cost: accept uniformly, or add a guard/threshold?
7. **NEW** — override survival across re-export: preserve `poster_source` scrub/upload when a draft is re-exported, or let re-export reset to auto? Recommend: preserve non-auto sources.
