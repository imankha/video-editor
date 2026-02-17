# T82: Multi-Video Games (First Half / Second Half)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

Currently, a game is associated with a single video file. In real sports scenarios, games are often recorded as multiple files:

- First half / Second half
- Multiple quarters
- Camera angles that need to be switched between
- Recording that was split due to storage limits

Users need to be able to treat these as a single logical "game" while the system handles multiple underlying video files.

## Solution

Allow a game to have multiple video files with ordering/labeling:

1. **Game-to-video relationship:** Change from 1:1 to 1:many
2. **Video ordering:** Support sequential ordering (half 1, half 2) or labeled segments
3. **Clip timestamps:** Clips reference which video segment + timestamp within that segment
4. **UI support:**
   - Upload multiple videos to same game
   - Add video to existing game
   - Navigate between segments in Annotate mode

## Context

### Relevant Files
- `src/backend/app/database.py` - Game and video models
- `src/backend/app/routers/games_upload.py` - Upload endpoints
- `src/frontend/src/stores/uploadStore.js` - Upload state
- `src/frontend/src/modes/AnnotateModeView.jsx` - Video navigation
- `src/frontend/src/containers/AnnotateContainer.jsx` - Clip extraction

### Related Tasks
- Depends on: T80 (global game storage structure)
- Related to: T81 (hash each video segment)
- Blocks: None

### Technical Notes
- Database schema change: games have many videos
- Each video needs: order/label, duration, R2 path
- Clips need to reference video_id, not just game_id
- Consider: should timeline be continuous across segments or separate?

## Implementation

### Steps
1. [ ] Design database schema for game-video relationship
2. [ ] Update backend models and migrations
3. [ ] Update upload flow to support adding videos to existing game
4. [ ] Update Annotate UI to show/navigate multiple segments
5. [ ] Update clip model to reference specific video segment
6. [ ] Handle edge cases (delete one segment, reorder, etc.)

### Progress Log

*No progress yet*

## Acceptance Criteria

- [ ] Can upload multiple videos to a single game
- [ ] Can add a video to an existing game
- [ ] Videos display in correct order in Annotate mode
- [ ] Can navigate between video segments
- [ ] Clips correctly reference their source video segment
- [ ] Timestamps make sense across segments (continuous or labeled)
