# T11220: Legacy multi-clip data - keep drafts reachable, block re-edit/restore of multi-clip reels

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

After Reels removal, no user may lose access to a draft or published video they had. Two gaps:
1. In-progress multi-clip drafts (`is_auto_created = 0`) are only visible in the Reels tab. Worst
   case: an exported-but-unpublished draft whose render the user paid for; its only surfaces are
   `DraftTile` and `DraftReelPreview` (Download via `useDownloads().downloadFile(final_video_id)`).
2. Published multi-clip reels: `CollectionPlayer.jsx:566` shows Re-edit for any reel with a
   `project_id`, and `restore-project` (`downloads.py:2245`) would restore a multi-clip project
   into an editor that no longer supports it.

## Solution (per R3 / R4; recommended option A shown)

- **Drafts (option A, readable-only):** multi-clip drafts appear in Clips (or a clearly labelled
  legacy group there). Spotlight and publish still work on drafts that already have a working
  video (Spotlight edits the concatenated `working_videos` row; no multi-clip code needed).
  Re-framing is refused with a clear message (`/render` already returns 400 for >1 clip; the UI
  must say why before the user tries). Download of an exported final stays available.
- **Published multi-clip reels (R4):** stay under Published -> "Mixes & compilations"
  (`CollectionsTab.jsx:14,280-293`, `collection_metadata.py:72`; that group also holds game-less
  single clips and `clip_count` NULL rows, so it must stay). Hide Re-edit when `clip_count > 1`;
  `restore-project` refuses multi-clip projects loudly (no silent fallback).
- **Highlight carry:** `highlight_carry._transform_multi_clip` is what keeps a legacy multi-clip
  draft's highlights alive on re-export. It stays until this task is done; T11260 removes it only
  if option A never re-exports multi-clip (re-framing refused), which makes it dead.

If R3 rules **B (split migration)**: profile_db JIT migration creating N single-clip drafts by
copying `crop_data` / `segments_data`, keeping the original row as the anchor for
`final_videos.project_id` (T4800 orphans); archived JSON projects are unreachable by migrations.
Include the Migration agent; L-tier with Architect gate. If **C**: requires explicit user approval
of the data loss and a credits decision.

## Context

### Relevant Files
- `src/frontend/src/components/ProjectManager.jsx` (Clips filter :565)
- `src/frontend/src/components/DraftTile.jsx:368-379`, `DraftReelPreview.jsx`
- `src/frontend/src/components/CollectionPlayer.jsx:566`
- `src/backend/app/routers/downloads.py:2245` (`restore-project`)
- `src/backend/app/services/collection_metadata.py:60-74`

### Related Tasks
- Depends on: T11200 (counts), R3, R4
- Blocks: T11230, T11260

## Acceptance Criteria

- [ ] Red-then-green: a multi-clip draft fixture is reachable from Clips after the Reels tab is gone
- [ ] Re-edit hidden and restore refused for a `clip_count > 1` published reel (test each)
- [ ] Exported-unpublished multi-clip draft can still be downloaded and published
- [ ] Live-driven with a real multi-clip fixture account on dev
