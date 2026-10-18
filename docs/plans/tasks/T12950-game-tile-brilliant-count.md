# T12950: Game tile shows the brilliant count beside plays and finished

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend only, ~3 files)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Keep Only Marked Plays (independent of the epic; same Games-tab surface)

## Problem

The game tile's secondary line reads "{n} plays • {r} finished" (`GameTile.jsx` ~85-90, `countsLabel`).
The number a parent actually scans for is how many **brilliant** (5-star) plays the game holds: that
is what becomes highlights. The backend already computes it (`games.py::_compute_athlete_stats` emits
`brilliant_count`, line ~1724, in every `GET /api/games` row) and the frontend never renders it.

## Solution

- Render a third segment between plays and finished: **"{n} plays • ★ {b} • {r} finished"**, where the
  star is lucide `Star` (10px, filled) in the rating-5 gold (`RATING_BADGE_COLORS[5]`, `#F5B700`,
  `components/shared/clipConstants.js`) and `{b}` is `game.brilliant_count`. Accessible name
  "{b} brilliant" via `aria-label`/`title` (the word "brilliant" matches `RATING_ADJECTIVES[5]`).
- Segment omitted when `b === 0` (same rule as the finished segment). Order: plays, brilliant, finished.
- Build it in the ONE place `countsLabel` is built (the T8260 comment asks for exactly that), as a small
  `GameTileCounts` fragment since it now mixes an icon with text.
- Phone width: the line is `whitespace-nowrap` beside the date on a ~358px tile; the glyph form keeps the
  worst case ("12 plays • ★ 3 • 2 finished") under ~190px at `text-xs`. Verify at 390px in the e2e grid spec.

### Decision D7 (DECIDED 2026-10-18: athlete-only count, no backend change)
`brilliant_count` is **athlete-layer only** (`my_athlete` true or NULL), while `clip_count` is every layer.
Decision: ship the athlete-only count (no backend change; "my athlete's brilliants" is what the
parent cares about). The all-layer alternative was declined.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx` - `countsLabel` -> `GameTileCounts`
- `src/frontend/src/config/displayNames.js` - `GAME_CARD.BRILLIANT_COUNT`
- `src/frontend/src/components/GameTile.counts.test.jsx` - new (no GameTile unit tests exist today)
- `src/frontend/e2e/T5681-games-poster-grid.spec.js` - optional width check at 390px

### Related Tasks
- Related: T8260 (counts line), T12930 (plays-only chip shares the tile; no conflict, different row), T10120 (derived counts)

### Technical Notes
- Knowledge docs: `annotate.md` (GameTile T5681/T8260 notes).
- Copy rule: "brilliant" is the rating adjective; the finished product is a "highlight".
- No em dashes in shipped copy.

## Implementation

### Steps
1. [ ] Failing test: `brilliant_count: 3` renders the gold star + "3" with accessible name "3 brilliant"; `0` renders no segment
2. [ ] Implement `GameTileCounts`
3. [ ] 390px width check

### Progress Log

**2026-10-18**: Filed.

## Acceptance Criteria

- [ ] Tile line reads plays, brilliant (gold star + count), finished; brilliant and finished segments omitted at 0
- [ ] Accessible name includes "{b} brilliant"
- [ ] No overflow at 390px with two-digit counts
- [ ] Curated frontend tests pass; CI green
