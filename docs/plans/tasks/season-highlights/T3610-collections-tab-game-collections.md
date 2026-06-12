# T3610: Collections Tab + Game Collections in My Reels

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-06-12

## Problem

My Reels is the only surface in the app where game context disappears: it groups published reels by date, while everything upstream (home screen, Reel Drafts) is game-centric. There is no way to watch or act on "all the reels from Saturday's game" as a unit -- which is the container every share/stitch/season feature in this epic hangs off.

## Solution

Restructure DownloadsPanel into two tabs: **Collections (default)** and **All** (today's date view, unchanged, keeps the existing source-type filter pills -- note the "star" pill is a Brilliant Clips filter, not favorites). Collections renders game groups with a reusable **CollectionHeader** component and an in-app **story player**.

See [EPIC.md](EPIC.md) decisions #1, #2, #11. Layout mockup in spec section 3.

### Game group (CollectionHeader)

- Identity: derived game display name + date (backend already computes `group_key` / `game_names`, [downloads.py:117-164](../../../../src/backend/app/routers/downloads.py)), reel count, total duration (sum of stamped durations; NULL-duration reels excluded from the sum and the time math but still listed).
- Aspect-ratio pills ("Portrait 5 / Landscape 2") that filter the group's cards and scope the header verbs. Default = dominant ratio.
- Verbs: **Play all** (story player) now; **Share** and **Video** buttons land in T3620/T3680 -- build the header with a verbs slot so they drop in.
- Reels spanning >1 game (`game_ids.length > 1`) and reels with no resolvable game go to a "Mixes & compilations" group at the bottom; excluded from game groups.
- Per-card actions (play, copy link, kebab) unchanged.

### Story player (new component, e.g. `CollectionPlayer`)

- Plays the group's reels (scoped to selected ratio) sequentially with auto-advance; segmented progress bar (one segment per reel); brief title overlay per reel.
- Blueprint: [RecapPlayerModal.jsx](../../../../src/frontend/src/components/RecapPlayerModal.jsx) (auto-advance hooks, sidebar, PlaybackControls). Playback URLs via existing `getStreamingUrl()` proxy (`/api/downloads/{id}/stream`).
- 9:16 -> vertical story layout; 16:9 -> standard layout with up-next strip. This component is reused by the public viewer in T3620 -- keep it presentational (URLs + metadata in, no store coupling).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DownloadsPanel.jsx` - tab restructure, Collections rendering (current grouping at 521-564)
- `src/frontend/src/hooks/useDownloads.js` - grouping selectors for game collections + ratio scoping (date grouping at 248-278)
- `src/frontend/src/components/collections/CollectionHeader.jsx` - NEW shared header (game/smart/season reuse it)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` - NEW story player
- `src/frontend/src/components/RecapPlayerModal.jsx` - reference for auto-advance patterns (do not modify)
- `src/frontend/src/components/shared/CollapsibleGroup.jsx` - group expand/collapse reuse
- `src/frontend/src/config/themeColors.js` - REEL palette for collection accents
- `src/backend/app/routers/downloads.py` - ensure game_ids/game_names/aspect_ratio/duration/tags all present per item (mostly done by T3600)

### Related Tasks
- Depends on: T3600's `duration` + `aspect_ratio` columns on final_videos (ratio pills, group totals)
- Blocks: T3620 (Share verb + viewer reuses CollectionPlayer), T3640 (Season section reuses CollectionHeader), T3670 (smart sections reuse both)

### Technical Notes
- Frontend conventions: tech-notes section 6 (MVC split, data-always-ready, Button API, no backdrop close for the player modal).
- Grouping is pure derivation from item fields -- no new backend state, no new store state beyond UI (selected tab/ratio are transient component state; do NOT persist reactively).
- Mockup reference: spec section 3.

## Implementation

### Steps
1. [ ] Extend useDownloads with collection grouping selectors (by game, by ratio; mixes bucket)
2. [ ] Build CollectionHeader (identity line, ratio pills, verbs slot, Play all)
3. [ ] Build CollectionPlayer (sequential playback, segmented progress, auto-advance, title overlays)
4. [ ] Restructure DownloadsPanel tabs: Collections default, All = existing view
5. [ ] Vitest: grouping selectors (multi-game exclusion, NULL-duration exclusion, dominant-ratio default)
6. [ ] E2E: publish two reels for one game -> Collections shows the game group -> Play all advances through both

### Progress Log

## Acceptance Criteria

- [ ] Collections tab (default) groups published reels by game, newest game first, most recent expanded
- [ ] Ratio pills filter the group and scope Play all
- [ ] Play all plays the group sequentially with segmented progress and auto-advance
- [ ] Multi-game and game-less reels appear under "Mixes & compilations"
- [ ] All tab preserves today's behavior exactly (date groups, filter pills, card actions)
- [ ] Frontend unit + E2E tests pass
