# T5600: Player-detection data survives region delete (project-level detection store)

**Status:** TODO (design-gated — Architect design doc required before implementation)
**Impact:** 4
**Complexity:** 6
**Created:** 2026-07-20
**Tier:** L (schema change + backend + frontend + migration)

## Problem

Reported 2026-07-20 (imankh, mobile): deleting a highlight region in Overlay mode
also destroys the player-tracking squares (detection data) for that span. The user's
decision (chosen from options): **"Protect tracking only"** — deleting a region should
remove the spotlight span + its circle keyframes, but the player-detection squares must
survive, and re-creating a region over the same time span should re-show them.

## Why this is a data-model change (audit findings — do NOT re-audit)

Detection "tracking squares" are computed **once at framing/multi-clip export**, sampled
at 4 evenly-spaced timestamps in each clip's first ~2s, and stored **only** inside each
region's `detections` array within the `working_videos.highlights_data` blob. There is
**no project-level copy anywhere**.

- Region `detections` populated ONLY on restore-from-backend: `useHighlightRegions.js:205-216` (line 212 `detections: saved.detections || []`).
- `addRegion` does NOT set detections: `useHighlightRegions.js:309-324`.
- Batch detection produced + embedded per region: `multi_clip.py:741-899` (region dict `multi_clip.py:880-892`), persisted into `working_videos.highlights_data` at `multi_clip.py:1386-1414` (INSERT 1411-1414).
- `/overlay-data` embeds detections inside each region: `overlay.py:1593-1681` (box counts 1662); frontend consumes at `OverlayScreen.jsx:453-470` → `restoreHighlightRegions`.
- **Delete destroys it:** backend `delete_region` does `del highlights[idx]` → detections gone: `overlay.py:514-524`. Frontend path: `OverlayScreen.jsx:605-612` → `useHighlightRegions.js:336-352` → `overlayActions.js:72-74`.
- **Create returns empty:** backend `create_region` hardcodes `"detections": []`: `overlay.py:496-512` (line 509). Frontend: `OverlayScreen.jsx:590-602` → `addRegion` `useHighlightRegions.js:272-331` → `overlayActions.js:60-64`.
- A second, UNRELATED store exists: R2 per-frame cache `detections/{filename}/frame_{N}.json` (`detection.py:65-74`), written ONLY by on-demand single-frame scrubbing `POST /api/detect/players` (`detection.py:424`) — the batch export does NOT write it, so it does not hold the tracking-square data.
- Detection entry shape: `{ timestamp, frame, boxes[] }`; regions also carry `videoWidth`/`videoHeight`/`fps` used for coordinate scaling at render (`overlay.py:862-875`) and marker navigation — any preserved/re-sliced detection MUST keep those or scaling breaks.

## Recommended approach (for the Architect to design)

**Option A — retain detections at the working-video level.** Store the batch detection
result once per working video, decoupled from regions:
- Producer/persist: `multi_clip.py:880-897` + `multi_clip.py:1407-1414` — write a
  video-level detection copy (new `working_videos.detections_data` column, or reuse the
  R2 per-frame cache by having the batch path call `cache_detection_result`).
- Delete: `overlay.py:514-524` — unchanged (only removes the region); detections remain.
- Create: `overlay.py:496-512` — slice video-level detections by `[start_time, end_time]`
  into the new region's `detections`; frontend `addRegion` shows markers immediately or
  on next `/overlay-data` load.

(Option B — a project-level "orphaned detections" pool moved aside on delete — is more
stateful/error-prone; the Architect should compare but Option A is recommended.)

## Constraints / decisions the design must resolve

1. **Schema track:** `working_videos` lives in profile_db (`src/backend/app/database.py` `ensure_database()`); new column needs `_SCHEMA_DDL`/`ensure_database` update + a versioned migration (`src/backend/app/migrations/profile_db/vNNN_*.py`). Confirm the track and version number.
2. **Backfill:** existing exports have no video-level copy. Decide: backfill from the
   current per-region detections (one-time migration that hoists the union of all regions'
   detections up to the video level), or accept "old reels don't recover, new exports do".
   Recommend backfill-from-regions since the data still exists in `highlights_data` today.
3. **Coordinate metadata:** the video-level store must retain `videoWidth`/`videoHeight`/`fps`
   (or per-detection frame/timestamp) so re-sliced detections scale correctly.
4. **Persistence rule:** keep it gesture-based (CLAUDE.md). Do the slice inside the
   `create_region` backend handler / `addRegion` gesture path — NO reactive `useEffect`
   re-sync. See [gesture-based-sync] + [persistence-model] backend skills.
5. **Encoding:** `highlights_data` is an encoded blob (msgpack-family). A new
   `detections_data` column should follow the same on-disk encoding convention.
6. **Wire format:** `/overlay-data` currently JSON with detections embedded per region —
   decide whether video-level detections ride the same response or a new field.

## Acceptance Criteria (design must enable; implementation task will verify)

- [ ] Deleting a highlight region does NOT destroy its detection data.
- [ ] Creating a region over a span that had detections re-populates its tracking squares.
- [ ] The spotlight span + circle keyframes ARE removed on delete (only tracking is protected).
- [ ] Coordinate scaling of re-populated detections is correct (videoWidth/height/fps preserved).
- [ ] Existing exports handled per the backfill decision; new exports get the video-level copy.
- [ ] No reactive-persistence violation; all writes trace to a gesture.

## Knowledge docs

`.claude/knowledge/keyframes-framing.md`, `backend-services.md`, `persistence-sync.md`,
`export-pipeline.md`. Backend skills: gesture-based-sync, persistence-model, database-schema.
