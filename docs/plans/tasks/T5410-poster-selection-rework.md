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

## Solution (three parts) — **REVISED 2026-08-01: no new YOLO, override moves into overlay**

> Two user decisions on 2026-08-01 reshaped this task. Full rationale in
> [T5410-design.md](T5410-design.md) §0. Summary:
> 1. **No new YOLO calls anywhere.** *("I actually am nervous about new yolo calls. even now we
>    only run yolo on 4 frames during the framing export. Can we make any improvements in the
>    poster image selection without new yolo?")*
> 2. **The manual override becomes a marker on the OVERLAY timeline**, not a post-export modal.
>    *("what if when the user opened overlay there was an indication as to what frame was
>    preselected for the poster frame and the user had the option to move it.")*

### 1. New selection: the open-play window gate (NO detection)

The study's `10*zone` weight is **not a per-frame term** — every candidate shares the zone, so it
cannot discriminate between candidates. It is a decision about **when**, and it is realized as a
**candidate-window gate** computed by pure arithmetic on `final_videos.slowmo_section_start/end`
(already frozen, v025):

```
window = [slowmo_start + SPOTLIGHT_SKIP(2.0s),  min(slowmo_end, duration - END_MARGIN(0.3s))]
poster_time = user's overlay marker if set, else midpoint(window)
```

No slow-mo section -> whole clip minus end margin. **No detection is required for any of this.**

**Everything else in the original score is dropped**, because the study measured it at noise:

| Signal | Study effect | Verdict |
|---|---|---|
| **Zone** (open-play vs spotlight) | **10x dominant** — open-play #1 in 4/5 reels; spotlight WORST (never #1) | **Window gate** ✅ free |
| Byte size (shipping today) | **-0.54, worse than random** | **Deleted** ✅ |
| subject_size / ball_present / occlusion | +0.23 / weak / +0.11 | Dropped — needed YOLO, bought noise |
| confidence / aspect / sharpness | -0.11 / -0.12 / -0.08 | Already 0-weight |

Going from byte-size to the window gate moves the primary signal from **actively backwards** to the
zone that won 4 of 5 reels. The dropped terms are exactly the residual that part 3 exists to handle.

### 2. Move poster generation to overlay export (now nearly free)

Poster select+generate moves from publish (T5280) to the overlay export/finalize step, so the poster
exists at export-complete. **With detection cut, this costs one ffmpeg seek + one R2 upload** — the
same work T5280 already did at publish, merely relocated. No Modal, no CPU inference, no added
export latency, and **no per-export GPU cost on drafts that are never published** (the concern that
blocked the previous design).

- `_finalize_overlay_export` already freezes `slowmo_section` and INSERTs `final_videos`; the poster
  step runs after it returns and **before** the sync-then-announce barrier, so `poster_*` columns
  ride the existing `sync_export_db_to_r2`.
- Poster failure never fails export (`poster_filename` stays NULL; backfill or re-export heals).

**If box features are ever wanted later** (NOT this task): do not add a detection pass. Framing
export already makes ONE batched Modal T4 call — `calculate_detection_timestamps`
(`multi_clip.py:700`) samples 4 timestamps per clip at 0/0.66/1.33/2.0s, flattened into a single
`call_modal_detect_players_batch`. Appending open-play timestamps to that existing list is marginal
inference on an already-warm container. Blocker: framing export runs *before* `slowmo_section` is
frozen, so the window is not known there yet.

### 3. Poster marker on the OVERLAY timeline (the aesthetic last mile)

When the user opens **overlay**, the timeline shows a **poster marker** at the frame that will become
the cover — defaulting to the window midpoint. The user can **drag it** to any frame, or hit "use
current frame as cover", or **upload their own image**. The choice persists pre-export via a
surgical, gesture-triggered call, and finalize grabs that frame.

Why this beats the post-export modal it replaces:

| | Overlay marker | Post-export modal (CUT) |
|---|---|---|
| Discoverability | On the timeline the user already scrubs | A new draft-card action — **the exact pattern behind T6180 and T6300** |
| New UI | Marker + drag on an existing timeline | A whole modal with its own `<video>` + scrubber |
| When | In-flow, while finishing the reel | A separate post-hoc chore |
| Re-export | Choice is pre-export, **survives naturally** | Was open question #7, unresolved |

The user's marker is **honoured verbatim, not clamped to the window** — if they deliberately want a
spotlight frame, that is a decision, not an error. The gate is a default, not a rule.

Consumers (`shares.py::_resolve_poster` / `_serve_poster_jpeg`, edge og:image, and the T4890
follow-on email thumbnail) are **unchanged** — the override overwrites the same deterministic key.

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
**L-tier**: backend selection change + capture-point move + schema/migration + overlay-timeline marker UX + backfill. Architect design gate required (**where the pre-export marker time is stored** is the live open decision). Migration agent for the new column(s). UI Designer for the timeline marker.

*Scope note: the 2026-08-01 revision **removed** the detection work, the `PosterEditModal`, and the `ProjectManager.jsx` edit, and made the backfill cheap — this is materially smaller than the 2026-07-17 version.*

## Acceptance criteria — **REVISED 2026-08-01**
- [ ] Poster is selected from the open-play slow-mo window (first ~2s spotlight skipped, small end margin); **byte-size heuristic removed** from the reel path.
- [ ] **No new YOLO/detection call is added anywhere** — verify by inspection that the export path makes no Modal or CPU inference call.
- [ ] Poster object + `poster_filename`/`poster_frame_time`/`poster_source` land at overlay export, **before** the durable-sync barrier (T4110/T5280 invariants preserved; **poster failure never fails export**).
- [ ] Opening overlay shows a **poster marker** on the timeline at the frame that will become the cover, **visible without hovering** and reachable at coarse pointer.
- [ ] The user can **drag the marker** (or use "current frame as cover") and the choice is honoured verbatim at export — including a frame outside the open-play window.
- [ ] Upload-your-own-image works from the overlay panel; both paths write via a **gesture-scoped surgical call** (no reactive persistence).
- [ ] The marker choice **survives a re-export** without special-casing in finalize.
- [ ] **Multi-clip slow-mo reel:** marker time maps to the correct final-video frame (manual end-to-end evidence, not a single-clip check).
- [ ] Existing reels handled per the backfill strategy (no silent fallback; no-section → logged midpoint, never first-frame).
- [ ] Migration is the **first free profile_db version** (v032 as of 2026-08-01) — re-verified against master *and* unmerged branches.
- [ ] Tests: `open_play_window` + `select_poster_frame` units, endpoint tests, export-still-COMPLETE-on-poster-failure, edge/share poster still served. Real unfurl + email spot-check.

---

## Implementation Details

> Full design + rationale: [T5410-design.md](T5410-design.md). This section is the implementor's concrete change list. **REVISED 2026-08-01** (supersedes the 2026-07-17 Modal revision).

### Key architectural decisions (user-authoritative; see design §0, §4)
- **NO detection of any kind.** No new Modal call, no CPU YOLO, no detection cache dependency. The study's only strong signal (zone) is a *time-window* decision, computable from the already-frozen `slowmo_section` — see design §0 for the full effect-size table. Both the earlier Modal-at-export plan and the CPU-at-publish plan are OUT.
- **Poster select+generate MOVES from publish (T5280) to the overlay export/finalize step**, so the poster exists at export-complete. With detection cut this is one ffmpeg seek + one R2 upload — the same work T5280 did at publish, relocated. No per-export GPU cost.
- **The override is a draggable POSTER MARKER on the overlay timeline**, set *before* export. `PosterEditModal` and the draft-card "Edit preview image" action are **CUT** — so this task **no longer touches `ProjectManager.jsx`**; all frontend work is under `src/frontend/src/modes/overlay/`.
- **The user's marker is honoured verbatim, never clamped to the window.**
- **The `10*zone` weight is a candidate-window gate**, not a per-candidate term. Within the window: **midpoint**, deterministic — no ranking (all within-window features measured |Spearman| <= 0.23).
- **"Exclude the trailing outro" is a near no-op post-T3950** (stored finals carry no baked outro); keep only a small end-margin.
- **Override writes overwrite the deterministic R2 poster key** → consumers (`shares.py`, edge og:image) need zero changes.

### Backend — `src/backend/app/services/poster.py`
- Add constants: `SPOTLIGHT_SKIP_SECONDS=2.0`, `END_MARGIN_SECONDS=0.3`, `MIN_WINDOW_SECONDS=0.5`. (No sample count, class ids, or radius — nothing is detected.)
- Add pure/testable `open_play_window(section, final_duration) -> (start, end)` — **this is the whole algorithm**. Handles no-slow-mo, too-short-after-skip, end margin.
- Add `select_poster_frame(window, user_marker_time) -> time` — returns the marker if set, else `midpoint(window)`. Kept as a named function so the selection point is greppable and export/backfill share one definition.
- ~~`pick_subject` / `score_candidate` / `modal_detect_cached`~~ — **CUT.** All three existed only to rank within the window using detection.
- **Rename** `generate_poster_at_publish` → **async** `generate_poster_at_export(user_id, final_video_id, final_filename, section, final_duration, user_marker_time)`: `open_play_window` → `select_poster_frame` → ffmpeg grab → upload → set `poster_filename` + `poster_frame_time` + `poster_source` (`'overlay'` if the marker was set, else `'auto'`). Best-effort/never-raises unchanged. (`fps` drops out of the signature — with no detector there are no frame numbers, only final-timeline seconds.)
- Add `store_override_poster(...)` — shared writer for the uploaded-custom-cover path (overwrite deterministic key + set columns).
- Update `backfill_posters(force=..)`: recompute `open_play_window` from each published reel's **frozen `slowmo_section`** and grab the midpoint from its existing final object — **no GPU**; **skip `poster_source IN ('overlay','upload')`** even under force; heal `poster_frame_time`/`poster_source`. Add `poster_source` to the candidate SQL.
- `extract_clearest_frame_jpeg` stays ONLY for recap posters (T5180 path unaffected).

### Backend — export hook (`src/backend/app/routers/export/overlay.py`)
- Hook point: `_finalize_overlay_export` (overlay.py:111) already computes+freezes `slowmo_section` and INSERTs `final_videos` (returns `final_video_id`); the FINAL video is already in R2. In each **async** completion path that calls it (`_run_overlay_export_background`, no-keyframes copy, test path, `export_final`), `await generate_poster_at_export(...)` **after** finalize returns and **before** the sync-then-announce barrier, so `poster_*` columns ride the existing `sync_export_db_to_r2`. (Do NOT block the sync `_finalize_overlay_export` on an event loop.)
- Pass the render's known `duration` + the user's stored marker time into the poster call (avoid a redundant ffprobe; probe only as fallback).
- Poster failure → export still COMPLETE with `poster_filename` NULL (never fatal; T4110 barrier intact).

### Backend — publish (`downloads.py`, REVERSE T5280)
- `publish_to_my_reels` **no longer generates** the poster. Replace the `asyncio.to_thread(generate_poster_at_publish, ...)` block (downloads.py:~1291) with a cheap best-effort existence check (HEAD the deterministic key; log at info if absent). No ffmpeg at publish.

### Backend — schema/migration
- New `final_videos` columns: `poster_frame_time REAL` (nullable), `poster_source TEXT` (nullable; `'auto'|'overlay'|'upload'`, NULL=legacy/auto).
- Plus storage for the **pre-export marker time** — see the open decision below.
- Migration `src/backend/app/migrations/profile_db/v032_add_poster_frame_fields.py` (Migration agent): additive guarded `ALTER TABLE` (mirror v025); **no data backfill**; tuple-row-factory safe.

  > ⚠️ **VERSION CORRECTED 2026-08-01 — the old `v026` in this file was stale and would have been silently skipped.** Verified: `origin/master` profile_db head is **v029**; unmerged `feature/T5800-cross-profile-game-attribution` claims **v030**; unmerged `feature/T5725-teammates-team-only` claims **v031**. → **v032**. **Re-verify at implementation time** (`ls src/backend/app/migrations/profile_db/` *and* sibling unmerged branches): the runner only applies versions greater than the DB's current version, so a duplicate is silently skipped and the columns never exist.

- Add the new `final_videos` columns to `database.py::ensure_database` `CREATE TABLE final_videos` (after line 688).
- Migrations don't auto-run — trigger `POST /api/admin/migrate` after deploy, before backfill.

- **⚠️ OPEN DECISION (architect, wave 2): where the pre-export marker time lives.** Must be settled against real code, not assumed:
  - a `working_videos` column risks being dropped by `upsert_working_video` **versioning** on re-render — verify the semantics before choosing;
  - a project-level column is safer against that;
  - burying it in `working_videos.highlights_data` is rejected (poor greppability; one datum, one home).

### Backend — pre-export poster endpoints (gesture-scoped)
- `POST /api/overlay/{project_id}/poster-time` `{time | null}` → surgical write of the marker time (overlay/working-video seconds); `null` clears back to auto.
- `POST /api/overlay/{project_id}/poster/upload` (multipart image) → decode-verify + re-encode JPEG (cap long edge ~1440px), `store_override_poster(source='upload', frame_time=NULL)`.
- Both: current-profile ownership, **gesture-only** (fired from an explicit click/drag-end, never a `useEffect`).

### Frontend — poster marker in OVERLAY (`src/frontend/src/modes/overlay/`)
- **Timeline poster marker** at the current poster time; default = midpoint of the open-play window. **Draggable**; drag-end fires the surgical write. Must read as a *cover-photo* marker, distinct from the playhead and from highlight-region handles.
- Overlay panel: **"Use current frame as cover"** (sets marker to playhead) + **"Upload your own"** file input.
- Overlay hook: surgical `setPosterTime(projectId, time)` + `uploadPoster(projectId, file)`; update local state from the response, store raw, no derived flags. **No `useEffect` → API.**
- **UI Designer required** — this is a new timeline affordance on an already-crowded timeline (playhead + region handles). Style guide governs.
- **Discoverability is the point.** Visible without hovering, reachable at coarse pointer, >=44px targets. The app has shipped the hidden-affordance bug twice (T5910, T6300) — do not add a third.
- **Honest copy:** it picks the midpoint of the open-play slow-mo. Do not label it "AI-picked" or "smart".

### Backfill (existing reels)
- Admin force-regen via extended `backfill_posters(force=true)`: recompute `open_play_window` from the frozen `slowmo_section` + grab the midpoint from the existing final object. **No GPU, no Modal** — this is now a routine admin pass, not the expensive part of the task.
- Skip `poster_source IN ('overlay','upload')`; missing final → `skipped_gone` (logged); no frozen section → whole-clip-minus-margin midpoint (logged), never a silent first-frame.
- Staging → single prod pass → `verify_share_unfurl.py`. (Rejected: regenerate-on-next-export.)

### Tests
- Unit: `open_play_window` (slow-mo / none / too-short / end-margin / section past duration); `select_poster_frame` (marker honoured verbatim incl. outside the window; unset → midpoint). Pure — no mocking needed.
- Integration: finalize sets `poster_*` with `poster_source='auto'` (no marker) and `'overlay'` (marker set); **poster failure → export still COMPLETE (assert the barrier explicitly)**; poster-time endpoint persists + clears on `null`; upload rejects a non-image; backfill `force` skips overrides; publish no longer generates; `shares.py` still serves the overwritten poster.
- Frontend: marker renders at the auto default; drag-end fires **exactly ONE** POST; marker reachable without hover and at coarse pointer; `no-persistence-in-effects` clean.
- **Time-map verification (REQUIRED, manual):** on a **multi-clip, slow-mo** reel, set the marker at a visually distinctive moment → export → confirm the poster is that exact moment. A single-clip check is NOT sufficient evidence (the original identity-map spot-check was at 2.0s only).
- Manual: real unfurl + email thumbnail after staging backfill.

### Invariants preserved
Poster failure never fails export; poster set before the T4110 sync-then-announce barrier at finalize; gesture-based surgical persistence; poster served via the token-gated proxy (never presigned og:image, EPIC decision #5). T4175 expiry-sweep is NOT a `final_videos` writer → no poster hook needed there.

### Open questions (design §7)

**RESOLVED / dissolved:**
- **#1 detection compute** — RESOLVED 2026-08-01: **none.** CPU rejected (would overload the server); Modal-at-export also cut (buys only |Spearman| <= 0.23 features).
- **#3 edit surface** — RESOLVED 2026-08-01: **the overlay timeline marker.** `PosterEditModal` + draft-card action cut.
- **#6 export latency** — MOOT: no detection, so it is one ffmpeg seek. Run before the barrier.
- **#6b never-published-draft cost** — MOOT: no per-export GPU cost. This was the blocking concern.
- **#7 override survival across re-export** — DISSOLVED: the marker is stored pre-export, so re-export re-reads the same choice. No finalize special-casing.

**Still open for wave-2 implementation:**
2. "Exclude outro" is a no-op post-T3950 — OK to keep only an end-margin? Confirm no reel path bakes an outro into the stored object.
4. Upload validation: decode-verify + re-encode + cap long edge ~1440px, don't force aspect — OK?
5. `poster_frame_time` = NULL on upload — confirm the overlay UI makes it obvious a custom image is in use rather than the marker frame.
8. **NEW** — where the pre-export marker time is stored (`working_videos` column vs project-level). Verify `upsert_working_video` versioning semantics before choosing.
9. **NEW** — marker visibility on a timeline that already carries the playhead and highlight-region handles; must not collide with region drag targets.

### Progress Log

**2026-08-01**: Two user decisions reshaped the task during a /dotask wave-1 planning session.
(a) **No new YOLO** — user: *"I actually am nervous about new yolo calls."* Investigation confirmed
the current cost is ONE batched Modal T4 call per framing export sampling 4 timestamps/clip at
0/0.66/1.33/2.0s (`calculate_detection_timestamps`, `multi_clip.py:700`). Re-reading the study
showed the `10*zone` weight is a *time-window* decision needing no pixels, and every
detection-dependent feature was measured at noise — so the detection pass was cut entirely with
minimal quality loss. (b) **Override moved into overlay** — user: *"what if when the user opened
overlay there was an indication as to what frame was preselected... and the user had the option to
move it."* Verified feasible: the overlay timeline is the rendered working video (trim + slow-mo
already baked), and `highlight_transform.source_time_to_working_time` +
`poster.first_slowmo_section`'s `clip_offset` walk already provide any needed mapping. This cut
`PosterEditModal`, removed the `ProjectManager.jsx` edit, and dissolved open question #7. Migration
renumbered v026 → **v032** (v029 master head; v030/v031 claimed by unmerged branches).
Task deferred to wave 2.
