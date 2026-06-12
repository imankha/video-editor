# T3610: Collections Tab + Game Collections in My Reels

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-06-12

## Problem

My Reels is the only surface in the app where game context disappears: it groups published reels by date, while everything upstream (home screen, Reel Drafts) is game-centric. There is no way to watch or act on "all the reels from Saturday's game" as a unit -- which is the container every share/stitch/season feature in this epic hangs off.

## Solution

Restructure DownloadsPanel into two tabs: **Collections (default)** and **All** (today's date view, unchanged, keeps the existing source-type filter pills -- note the "star" pill is a Brilliant Clips filter, not favorites). Collections renders game groups with a reusable **CollectionHeader** component and an in-app **story player**.

See [EPIC.md](EPIC.md) decisions #1, #2, #11, #13 (summary-first data), #14 (mobile parity). Layout mockup in spec section 3.

### Data layer: summary-first (EPIC decision #13)

- NEW `GET /api/collections/summary`: single GROUP BY pass over final_videos (uses T3600's published/ratio index) returning per-game aggregates `{game_id, game_name, game_date, reel_count, ratio_counts: {'9:16': n, '16:9': n}, total_duration, latest_published_at, has_null_durations}`, a mixes bucket count (multi-game/game-less), season totals per ratio, and per-tag duration sums per ratio (consumed by T3640/T3670 -- shape them now, one endpoint for the whole tab). Response is O(games) -- a 500-reel profile returns ~30-40 rows.
- Group members fetched **on expand**: `GET /api/downloads?game_id={id}` (extend the existing endpoint with the filter; `aspect_ratio` param optional for ratio-pill scoping). The auto-expanded most-recent game fetches one group, not the world.
- The **All tab keeps the existing full-list fetch** and is the only consumer of it. Client code must NOT derive group aggregates from the full list (decision #13) -- delete/avoid any temptation to reduce over `downloads[]` for Collections.

### Game group (CollectionHeader)

- Identity: from the summary endpoint (game display name derivation already exists at [downloads.py:117-164](../../../../src/backend/app/routers/downloads.py) -- reuse it server-side), reel count, total duration (NULL-duration reels excluded from sums but still listed when expanded; `has_null_durations` drives a subtle marker).
- Aspect-ratio pills ("Portrait 5 / Landscape 2") that filter the group's cards and scope the header verbs. Default = dominant ratio.
- Verbs: **Play all** (story player) now; **Share** and **Video** buttons land in T3620/T3680 -- build the header with a verbs slot so they drop in.
- Reels spanning >1 game (`game_ids.length > 1`) and reels with no resolvable game go to a "Mixes & compilations" group at the bottom; excluded from game groups.
- Per-card actions (play, copy link, kebab) unchanged.

### Story player (new component, e.g. `CollectionPlayer`)

- Plays the group's reels (scoped to selected ratio) sequentially with auto-advance; segmented progress bar (one segment per reel); brief title overlay per reel.
- Blueprint: [RecapPlayerModal.jsx](../../../../src/frontend/src/components/RecapPlayerModal.jsx) (auto-advance hooks, sidebar, PlaybackControls). Playback URLs via existing `getStreamingUrl()` proxy (`/api/downloads/{id}/stream`).
- 9:16 -> vertical story layout; 16:9 -> standard layout with up-next strip. This component is reused by the public viewer in T3620 -- keep it presentational (URLs + metadata in, no store coupling).
- **Touch-first controls** (EPIC decision #14): tap right/left thirds = next/previous, swipe = navigate, tap center = pause/resume; desktop adds keyboard (arrows/space) on top. Full-screen takeover on mobile widths.

### Mobile (EPIC decision #14)

- Panel is full-width at <=428px (it slides over content today -- verify and fix overflow at 360px).
- Ratio pills, tab buttons, verbs: >= 44px touch targets; verbs may collapse to icon-only with the existing Button `iconOnly` prop on narrow widths.
- Test at 360/390/428px per `.claude/skills/responsiveness` before calling the task done.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/collections.py` - NEW summary endpoint (or extend downloads.py router; one GROUP BY query)
- `src/backend/app/routers/downloads.py` - `game_id`/`aspect_ratio` filters on the list endpoint
- `src/frontend/src/components/DownloadsPanel.jsx` - tab restructure, Collections rendering (current grouping at 521-564)
- `src/frontend/src/hooks/useDownloads.js` - summary fetch + per-group member fetch; All-tab list unchanged (date grouping at 248-278)
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
- Frontend conventions: tech-notes section 6 (MVC split, data-always-ready, Button API, no backdrop close for the player modal). Responsive patterns: `.claude/skills/responsiveness`.
- Summary endpoint is read-only derivation -- no new stored state. UI state (selected tab/ratio, expanded groups) is transient component state; do NOT persist reactively.
- Mockup reference: spec section 3. Scale rationale: EPIC decision #13.

## Implementation

### Steps
1. [ ] Summary endpoint (GROUP BY incl. season/tag sums) + game_id/aspect_ratio filters on the list endpoint
2. [ ] useDownloads: summary fetch + lazy member fetch per expanded group
3. [ ] Build CollectionHeader (identity line, ratio pills, verbs slot, Play all)
4. [ ] Build CollectionPlayer (sequential playback, segmented progress, auto-advance, tap/swipe + keyboard)
5. [ ] Restructure DownloadsPanel tabs: Collections default, All = existing view; mobile pass at 360/390/428px
6. [ ] Backend tests: summary aggregates (multi-game exclusion, NULL-duration exclusion, ratio counts); Vitest: lazy-fetch flow
7. [ ] E2E: publish two reels for one game -> Collections shows the game group -> Play all advances through both (run at desktop + 390px viewport)

### Progress Log

## Acceptance Criteria

- [ ] Collections tab (default) groups published reels by game, newest game first, most recent expanded
- [ ] Opening the tab transfers O(games) summary data; members load per group on expand (network-asserted in a test)
- [ ] Ratio pills filter the group and scope Play all
- [ ] Play all plays the group sequentially with segmented progress, auto-advance, and tap/swipe navigation on touch
- [ ] Multi-game and game-less reels appear under "Mixes & compilations"
- [ ] All tab preserves today's behavior exactly (date groups, filter pills, card actions)
- [ ] No horizontal overflow and >= 44px touch targets at 360px width
- [ ] Frontend unit + backend + E2E tests pass
