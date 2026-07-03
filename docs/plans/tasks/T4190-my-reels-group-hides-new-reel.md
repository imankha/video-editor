# T4190: My Reels — Game Group Hides New Reels (badge says new, nothing visible)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

Reproduced on staging (imankh, 2026-07-03): user framed + exported + published a new portrait reel
for the Legends 59' clip (raw_clip 134 -> project 53 -> final_video 38). The backend list
(`GET /api/downloads`) returns it correctly, but in My Reels the reel "just disappeared":

1. **Game group headers are anonymous.** The new reel maps to game 6 via
   `raw_clips.auto_project_id -> game_id` (downloads.py `brilliant_clip_games`), so the frontend
   files it under a "Game Highlights" group — but the header says only "Game Highlights · 1 reel ·
   33s", with no opponent/date. With reels from two games, the user sees two identical
   "Game Highlights" cards (the "phantom 2nd card" noted during T4110 was this, not a phantom).
2. **No NEW indicator on a collapsed group.** The unwatched reel sits inside the collapsed group;
   the group header shows no new-count, so nothing on screen looks new.
3. **Badge counts hidden reels.** The home/panel badge said "1 new" (unwatched fv 38) while no
   visible card was marked new — the T3900 unwatched count and the visible-card new-markers
   disagree whenever a new reel is group-nested.
4. (Cosmetic, related) When a clip's draft is re-created (auto_project_id repoints, e.g. 46 -> 53),
   the OLD project's published reel loses its game mapping (no raw_clip points at project 46
   anymore) and falls out of its group to a flat card — group membership is derived from the
   clip's CURRENT auto_project_id instead of the reel's own frozen game_ids.

## Solution (proposed)

- Group header: "vs {opponent} - {date}" (game name/date already fetched for grouping) instead of
  the bare "Game Highlights".
- Group header shows an unwatched count chip ("N new") when it contains unwatched reels; opening
  the group preserves per-card new markers.
- Grouping should use the reel's frozen `game_ids` (v008) with the `brilliant_clip_games`
  auto_project chain only as fallback — that also fixes (4).
- Keep the T3900 badge as-is (it's correct); the fix is making hidden-new visible, not changing
  the count.

## Context

### Relevant Files
- `src/frontend/src/components/...` My Reels panel + group card component (locate via "Game Highlights" string)
- `src/backend/app/routers/downloads.py` — list endpoint (`brilliant_clip_games` grouping data, ~315-460)
- `src/backend/app/routers/downloads.py` — `/count` (T3900 unwatched)

### Related Tasks
- T3900 (badge = unseen count), T3605 (frozen game_ids — use them for grouping), T4110 (incident
  where the "phantom" duplicate group was first seen)

## Acceptance Criteria

- [ ] Game groups are labeled with opponent + date
- [ ] A collapsed group containing unwatched reels shows a new-count on its header
- [ ] Badge count always has a visible on-screen counterpart
- [ ] Published reels stay in their game's group after their clip's draft is re-created
