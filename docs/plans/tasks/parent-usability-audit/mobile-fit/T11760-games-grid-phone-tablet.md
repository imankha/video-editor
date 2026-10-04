# T11760: Games grid uses phone and tablet width, 2-line titles

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Tier:** M (frontend only, ~4 files, ~90 LOC including tests)
**Created:** 2026-10-04
**Decision gate:** M2 (recommended: 1 column on phone, packed month groups at `sm`+, 2-line titles) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 3 of 4 in [Epic B: Fits on phones and tablets](EPIC.md). Runs before T11790 and T11820, which
also edit `components/ProjectManager.jsx`. Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/02](../../../ux/2026-10-04-parent-usability-audit/iphone/02-games-title-clipped-and-jargon.png),
[iphone/06](../../../ux/2026-10-04-parent-usability-audit/iphone/06-new-game-card-clipped-and-annotations-jargon.png),
[tablet/02](../../../ux/2026-10-04-parent-usability-audit/tablet/02-tablet-home-after-upload.png)
(this file is the tablet home). Game names are cut to "at Oceanside Breake...", which makes similar
games hard to tell apart. Each 1-game month shows one tile in the left half of the screen on both
phone and tablet.

## Solution

- **Phone (below `sm`):** one column (`grid-cols-1`). Tiles become ~358x200, room for a 2-line title.
- **`sm` and up:** columns N = `clamp(biggest group size, 2, 4)`. Small month groups sit side by side
  in one row, in chronological order:
  ```
  768: OCTOBER 2026 (1)          AUGUST 2026 (1)
       [tile Game uploaded Oct 4] [tile at Oceanside Breakers Aug 30]
       SEPTEMBER 2026 (3) ................................ (full row)
       [tile] [tile] [tile]
  ```
  Outer container `sm:grid sm:gap-x-3 sm:gap-y-6` + `GRID_COLS[N]`; each group `sm:col-span-{min(k,N)}`
  with an inner `grid grid-cols-{min(k,N)}`. Use **explicit class-map objects** (`GRID_COLS`,
  `COL_SPAN`), never computed class strings (Tailwind purges them, and greppability rule 6).
  No `grid-flow-dense` (keeps chronological order).
- **`lg`:** keep the existing group-label side rail, with packing inside it.
- **Title:** `GameTile.jsx:309` `truncate` -> `line-clamp-2 break-words leading-tight`. The meta row stays one line.

## Relevant Files (under `src/frontend/src/`)

- `components/ProjectManager.jsx:68-84` (`GAMES_GRID_CONTAINER_CLASS`, `GAMES_TILE_GRID_BY_COLUMNS`,
  `GAMES_GROUP_SECTION_CLASS`), `:394-397` (`gamesGridColumns`), `:1776` (`tileGridClass`), and the
  skeleton near `:2322`.
- `components/GameTile.jsx:297-309` (title and its single-line comment).
- `components/GamesListSkeleton.jsx` (shares the grid map, T6310).

## Implementation Steps

1. Change `gamesGridColumns` so phones get 1 column and `sm`+ get `clamp(biggest, 2, 4)`. Update its
   doc comment ("floored at 2 to match mobile" is no longer true).
2. Add the `GRID_COLS` and `COL_SPAN` maps and render month groups as packed grid items at `sm`+.
3. Apply the same maps in the skeleton **in the same commit** (T6310 grid/skeleton mismatch landmine).
4. Switch the tile title to `line-clamp-2`. Check that the scrim behind the text still covers 2 lines
   on the shortest tile.

## Acceptance Criteria

1. At 390: one tile per row; a long opponent name shows on up to 2 lines with no ellipsis for names up
   to ~40 characters.
2. At 768 with two 1-game months: both tiles in one row, each under its own month label.
3. At 1440: unchanged except titles may wrap to 2 lines.
4. Skeleton and loaded grid have the same column layout at every width (no jump on load).
5. No horizontal overflow at 320-768.

## Tests (red first)

- `ProjectManager.gameGrouping.test.jsx:386-404` (`groupsOf(1)` -> 2): change to the new rule and
  add cases for phone=1 and packed spans.
- `components/__tests__/GameTile.test.jsx:285` pins `truncate`; change to `line-clamp-2`.
- `GamesListSkeleton.test.jsx`, `ProjectManager.galleryGuard.test.jsx`.
- E2E (local): `e2e/T5681-games-poster-grid.spec.js`, `e2e/T6310-games-skeleton.qa.spec.js`.

## Landmines

- The count text "N annotations" on the tile is changed by T11850 (decision H3), not here.
- At 768 the "Upload game" button is not centered under the centered heading (separate small
  finding from the responsive designer). Fix it here only if it is a one-class change; otherwise note it.
