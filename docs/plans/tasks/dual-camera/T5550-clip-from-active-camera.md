# T5550: Clip Extraction From the Active Camera

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

After T5540, a user toggles to the other parent's camera precisely because the moment looks
BETTER there — then creates a clip… and the export pipeline cuts the moment from their own
camera's far-side mush. The clip must capture the pixels the user was looking at.

## Solution

Stamp the active camera on the clip and honor it at extraction:

1. **Schema:** `raw_clips.camera INTEGER NOT NULL DEFAULT 0` (profile_db migration;
   existing rows 0 = primary, matching today's behavior). Clip start/end times REMAIN in
   primary-camera virtual time (EPIC decision 5) — `camera` only selects the pixel source.
2. **Write path:** clip create/update payloads carry `camera` (from `activeCamera` at the
   creation gesture); `save_raw_clip` / `update_raw_clip` persist it. The natural key
   `(game_id, end_time, video_sequence)` is unchanged.
3. **Read path / extraction:** wherever the export pipeline resolves a game clip's source
   video + local time (`resolve_clip_source` in clips.py and the export routers'
   game-source paths), a `camera != 0`... rather, `camera != <primary>` clip maps
   `(startTime, endTime)` through the shared wall-clock into the target camera's video +
   local times (same math as frontend `cameraTimeMap.js` — implement the Python twin
   `app/services/camera_time_map.py` with the SAME unit-test vectors so the two can't
   drift), then extracts from that camera's `games/{blake3}.mp4`.
4. **Guards (visible, not silent):** if the target camera lacks coverage for the mapped
   range, or offsets are NULL at export time (alignment redone/cleared after clip
   creation), FAIL the extraction with an explicit error naming the clip and reason —
   never silently substitute the primary camera (no-silent-fallback rule). The Annotate
   UI already prevents creating such clips (T5540 gap toast); this guard covers data that
   later became inconsistent.
5. **UI:** clip list rows and the clip editor show a small camera badge when
   `camera != primary` ("Sam's camera"); the T5540 toggle auto-switches to the clip's
   camera when a clip is selected (so reviewing a clip shows what it will export).
6. **Expiry interplay:** extraction from the other camera depends on THAT source being
   live; the T4175 preserved-extract path (`raw_clips.filename` fill at expiry sweep) must
   extract from the clip's `camera` source too — audit `_export_brilliant_clip`.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — raw_clips schema; `src/backend/app/migrations/profile_db/` — NEW migration
- `src/backend/app/routers/clips.py` — `save_raw_clip` (~911), `update_raw_clip` (~1052), `resolve_clip_source`
- NEW `src/backend/app/services/camera_time_map.py` (+ shared test vectors with the JS twin)
- `src/backend/app/routers/export/` — game-source resolution call sites (framing.py, multi_clip.py; Code Expert maps the exact set — this dir is 5,878 lines, touch ONLY source-resolution seams, no new pipeline logic in routers per audit rule)
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip` camera audit
- `src/frontend/src/containers/AnnotateContainer.jsx` — send `camera` on create/update gestures
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` / `ClipDetailsEditor.jsx` — camera badge + select-follows-camera

### Related Tasks
- Depends on: T5540 (activeCamera + time mapping), T5530 (offsets)
- Related: Export Write-Path epic T4370-T4410 (if landed, use its seams; if not, keep changes at resolve_clip_source-level only)

### Technical Notes
- Knowledge docs: [export-pipeline.md](../../../.claude/knowledge/export-pipeline.md), [annotate.md](../../../.claude/knowledge/annotate.md)
- L-tier (schema + export pipeline) → Architect design gate; Code Expert maps every
  game-source resolution site FIRST (the export dir has known duplication — missing one
  call site = clips that export the wrong camera only on some paths).
- Test-first: characterization test of current extraction for a camera-0 clip (byte-level
  or ffprobe-level), then the camera-1 path against a two-camera fixture game with known
  offsets.
- `boundaries_version` invalidation semantics are unaffected (times don't change meaning);
  a camera CHANGE on an existing clip should bump it though — framing crops were authored
  against the other camera's pixels. Design doc settles whether camera is even editable
  post-creation (recommend: yes, via clip editor, with the bump).

## Implementation

### Steps
1. [ ] Architect design doc (resolution call-site map, camera editability, T4175 interplay) — approval gate
2. [ ] Migration + schema + write path (`camera` on save/update)
3. [ ] `camera_time_map.py` with shared vectors; wire into resolve_clip_source + export call sites
4. [ ] Visible-failure guards (gap / NULL offsets at export)
5. [ ] Frontend: stamp camera at creation, badge, select-follows-camera
6. [ ] `_export_brilliant_clip` audit + fix
7. [ ] Tests: characterization (camera 0 unchanged), camera-1 extraction correctness, guard failures, migration

## Acceptance Criteria

- [ ] A clip created while viewing camera B exports camera B's pixels at the correct moment (verified on a real two-camera fixture)
- [ ] Camera-0 clips export byte-identically to pre-task behavior (characterization test)
- [ ] Missing coverage / NULL offsets fail loudly with a named reason — never a silent wrong-camera export
- [ ] Clip list/editor show the camera badge; selecting a clip shows its camera in the player
- [ ] Expiry-sweep preserved extracts honor the clip's camera
- [ ] Migration runs via admin endpoint; all tests pass
