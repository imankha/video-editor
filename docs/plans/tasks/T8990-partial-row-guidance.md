# T8990: Partial-row guidance - keep the tab guide until the first row fills

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

T8980 shipped `EmptyTabGuide`, but it only renders while a tab is completely empty. The
moment the first game / clip / reel exists, the guide vanishes and the rest of the first row
is dead space: one game tile beside an empty grid cell, one 260px clip tile beside 800px of
nothing. That is exactly the moment the funnel evidence says people stall (T8120-T8140:
between upload and first clip), and the space that could carry the next-step coaching is
blank.

User's framing (2026-09-08): "instead of just showing the text we defined when the category
is empty, show it until a full row is completely populated - use the unused space to train
the user a bit better."

## Analysis (2026-09-08, from the code)

"A full row" means a different thing on each tab, and that decides the design:

### Games: a real grid, and the only partial state is ONE game

`GAMES_TILE_GRID_BY_COLUMNS` (`ProjectManager.jsx:69-73`) is a CSS grid: 2 columns below
`sm`, 3 at `sm`, and 2-4 at `lg` derived from the data by `gamesGridColumns`
(`:368-371`, T7330: biggest month group, clamped 2..4, floor 2 "to match mobile"). So:

| games | desktop cols | first-row empty cells |
|-------|--------------|-----------------------|
| 1 | 2 | 1 |
| 2 | 2 | 0 |
| 3 | 3 | 0 |
| 4+ | 4 | 0 |

With 3 games on a phone (2-up) the SECOND row is half empty, but the first row is full, and
the rule is "the first row". So the Games condition is simply `games.length === 1`: no
measuring, no resize listeners, one empty `aspect-video` cell beside the tile, at every
breakpoint. This is also the single most valuable coaching moment in the product ("you
uploaded a game, now open it and tap Add Play"), and it costs the least. Do this first.

Wrinkles: the uploading rail (`:1610`) shares the same grid; month groups each own a grid
(a one-game account has one group); `is_reference` games render `ReferenceGameCard` in the
same cell shape.

### Clips, Reels, Published: not grids, carousels

All three render `CardCarousel` rows (`shared/CardCarousel.jsx`): `flex overflow-x-auto
snap-x` with FIXED-width tiles (`DraftTile.sizeClass` `:373-375`: `sm:w-[260px]` landscape /
`sm:w-[168px]` portrait, `72vw`/`40vw` below `sm`; `ReelTile` the same shape). There is no
column count. "Unused space" is `containerWidth - naturalTileWidth`: at the Clips container
(`max-w-6xl`, 1152px) one landscape tile leaves ~880px, two leave ~600px, four leave ~50px.
On a phone one tile already fills the row (72vw), so a partial guide never shows there,
which is fine: the phone got the flow-strip dots in the empty state.

`CardCarousel` already measures `tileW`, `containerW` and `children.length` after every
render (`computeGap`, for the peek gap) and has a `ResizeObserver`. The clean hook is a
`fillerSlot` render prop: the carousel mounts the filler as its LAST child only while
`naturalWidth(tiles) + MIN_FILLER_WIDTH <= containerW`, and hides it the moment tiles
would overflow. The filler must not itself trigger the peek/overflow logic (exclude it from
`computeGap`'s child count) and must match the row's tile height. Clips has several rows
(one carousel per stage x aspect bucket, `DraftStageRows`, plus the By-Phase compact
clusters): the guide attaches to the tab's FIRST rendered row only, never one per row.

Published: `CollectionsTab` -> `GameCollectionGroup` -> `CardCarousel` of `ReelTile`, same
mechanism; smart collections render above the game groups and stay untouched.

### The copy has to change, not just the gate

The approved T8980 copy is written for absence ("Every highlight starts with a game",
"Clips are the plays you cut from a game") and reads wrong beside a real tile. The partial
state needs NEXT-STEP framing: what to do with the thing you just made. Draft below; it
needs the same approval gate T8980's copy had.

### Invariants this touches

- `clips-add-video` tutorial target on exactly one node (T8380): in the partial state the
  non-empty Add Video action row (`ProjectManager.jsx:1456-1466`) is ALREADY rendered, so the
  Clips partial guide must NOT render another Add Video button. The empty guide keeps it.
- No persisted view state: the guide retires itself when the row fills; if a dismiss is
  wanted it is session-only React state, never stored (recommendation: no dismiss at all).
- Games grid math: the guide cell is not a game; it must not feed `gamesGridColumns` or the
  month grouping, and it must not appear while the uploading rail is showing (an upload tile
  already occupies that attention; recommendation: hide while `uploads.length > 0`).
- No em dashes in copy; capability queries only, no UA sniffing (unchanged from T8980).

## Solution

`EmptyTabGuide` grows a `variant="partial"` (compact, fills a tile-shaped slot) beside the
existing full-panel empty variant, driven by a second copy set `PARTIAL_TAB_GUIDE` in
`emptyStates.js`. Two mechanisms, matching the two layouts:

1. **Games (grid cell).** When `games.length === 1` and no upload is in flight, render the
   partial guide as the second cell of the single month group's grid: `aspect-video`,
   `self-stretch`, same rounded/border chrome as a tile, flow strip in its compact dots form,
   headline + one sentence + one CTA. CTA opens that game (`onLoadGame(game.id)`), landing
   the user in Annotate where Add Play lives.
2. **Carousels (filler slot).** `CardCarousel` gains `fillerSlot` (a render prop or node):
   mounted as the last child only while it fits (`naturalWidth + MIN_FILLER_WIDTH <=
   containerW`), sized `flex-1 min-w-[280px] max-w-[420px]`, height matched to the row's tile
   via `self-stretch`, excluded from the peek-gap child count. Clips / Reels / Published each
   pass the partial guide as the filler of their FIRST row. On phones it never fits, so it
   never renders below `sm` (by construction, no breakpoint code).

Disappearance rule, stated once: **Games - retire at 2 games. Carousels - retire when the
filler no longer fits beside the tiles (width-based), which lands at 3-4 landscape tiles on
desktop.** No count cap needed: the container's `max-w` bounds the width, so an ultra-wide
monitor cannot keep it alive forever.

### Partial copy (LOCKED 2026-09-08, binding)

| Tab (partial) | Headline | Body (one sentence) | Action | Footer |
|---|---|---|---|---|
| Games (1 game) | Now cut your first play | Open your game and tap Add Play at each moment worth keeping; each play becomes a clip on In Progress Clips. | **Open game** (loads it) | Clips are step 2 of 4. |
| In Progress Clips (row not full) | Give each clip a Focus pass | Open a clip to follow your athlete and add an optional Spotlight, then publish it on its own or build several into a reel. | none (the tile is the action; Add Video already sits in the row above) | Published clips show up on the Published tab. |
| In Progress Reels (row not full) | Finish your reel and export once | Put the plays in order, export, then Publish moves it to the Published tab with a link you can share. | none (Build New Reel is already pinned above the row) | Finished reels move to Published when you share them. |
| Published (row not full) | Share it | Every published reel gets its own link; send it to coaches, family and recruiters from the player or the card. | none | Publish more clips to see them grouped by game here. |

Vocabulary: T8130's approved nouns and `displayNames.js`; no new terms.

### Decisions (LOCKED 2026-09-08, all six on the filed recommendations)

1. **Scope**: all four tabs, Games implemented FIRST (Games is the cheap, high-value half;
   the carousel filler is the reusable half). If the carousel half turns out to be more than
   it looks, Games alone is still a shippable increment - say so in the Progress Log rather
   than half-doing both.
2. **Partial copy**: the table above, verbatim.
3. **Games CTA**: yes, "Open game" loading that single game into Annotate. The tile's own
   affordance is a poster, not an instruction.
4. **Hide the Games guide while an upload is in flight**: yes.
5. **Carousel retire rule**: width-based (the filler hides when it no longer fits beside the
   tiles). It is literally "until the row is full" and needs no per-tab constant.
6. **Dismissible**: no. It retires itself; a dismiss adds session state and a control to test
   for no user benefit.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/shared/EmptyTabGuide.jsx` - add `variant="partial"` (compact, tile-shaped); keep the empty variant byte-identical
- `src/frontend/src/config/emptyStates.js` - add `PARTIAL_TAB_GUIDE` copy set
- `src/frontend/src/components/shared/CardCarousel.jsx` - `fillerSlot` prop: mount-while-it-fits logic next to `computeGap` (`:140-151`), exclude the filler from the peek child count, `self-stretch` sizing
- `src/frontend/src/components/ProjectManager.jsx` - Games: render the guide cell in the month-group grid when `games.length === 1` (`:1646` region, the group `tileGridClass` loop); Clips: pass the filler to the first `DraftStageRows` / `DraftPhaseAspectRows` carousel; Reels: filler on the single carousel (`:2022`)
- `src/frontend/src/components/collections/GameCollectionGroup.jsx` (`:133`) + `CollectionsTab.jsx` - Published: filler on the first game group's carousel; plumb `draftClipCount`/`accountGamesCount` if the copy needs them
- `src/frontend/src/components/shared/EmptyTabGuide.test.jsx`, `CardCarousel.test.jsx` (or new), `ProjectManager.fourTabIA.test.jsx` - tests
- `src/frontend/e2e/` - T8980's specs assert the empty guide only in empty states; specs that seed one game/clip and then assert on tile text must be checked for collisions with the new headline copy

### Related Tasks
- Follows: T8980 (empty-state guide, the component and copy this extends)
- Related: T7330 (data-derived games columns, the reason Games needs no measurement), T5672 (CardCarousel peek logic, the measurement this reuses), T8380 (tutorial-target uniqueness), T8120-T8140 (the funnel evidence)

### Technical Notes
- Games condition is `games.length === 1 && uploads.length === 0 && filteredPending.length === 0` (decision 4); it is a pure function of already-loaded data, nothing persisted.
- The carousel filler must be measured by the carousel, not by the tab: the tab does not know the container width, and `useIsMobile`-style breakpoint checks would be wrong for tablets and split views (T8980 learned this for tap targets).
- `CardCarousel` runs `computeGap`/`recompute` after EVERY render; the filler decision belongs in that same pass (read `naturalWidth` from the non-filler children) so it reacts to tiles being added/removed without a resize event. Guard the setter so it cannot loop.
- The filler's own width must not change the overflow verdict: decide from the tiles' natural width, then mount the filler into the remaining space.
- Heading levels: the guide cell is an `aside` with an `h3` inside a group that already has an `h2` (Games month headers, Clips game headers).
- Analytics (optional, not required): a `partial_tab_guide` impression via the T7515 impression pipeline (`impressionKey`, as `ConfirmationDialog` uses) would tell us whether the coaching gets tapped; aggregates only.

## Implementation

### Steps
1. [x] Decisions locked 2026-09-08 (user "proceed" on the six filed recommendations)
2. [ ] Branch `feature/T8990-partial-row-guidance`
3. [ ] `PARTIAL_TAB_GUIDE` copy + `EmptyTabGuide variant="partial"` (compact tile-shaped layout; empty variant unchanged, pinned by the existing tests)
4. [ ] Games: guide cell at `games.length === 1`, hidden during uploads; CTA loads the game
5. [ ] `CardCarousel fillerSlot`: fits-check in the measurement pass, filler excluded from peek math, `self-stretch`
6. [ ] Clips / Reels / Published: filler on each tab's first row; Clips partial variant renders NO Add Video button (tutorial-target invariant)
7. [ ] Tests: variant render + copy per tab; Games cell appears at 1 game, not at 0 (empty variant instead), not at 2, not during an upload; carousel filler mounts when it fits and unmounts when tiles overflow (jsdom cannot measure - use the exported pure fits-check function like `pickPeekGap`); tutorial-target uniqueness across empty/partial/full Clips states; e2e: seed one game and assert the cell + CTA, seed two and assert it is gone, at 390 / 768 / 1280
8. [ ] Reviewer pass on the diff, commit

### Progress Log

**2026-09-08**: Filed from the user's idea after T8980 landed. Code analysis done: Games
is a grid whose only partial-first-row state is exactly one game (T7330's data-derived
columns), the other three tabs are fixed-width-tile carousels where "unused space" is a
measurement `CardCarousel` already makes. Draft partial copy + 6 decisions recorded above.

**2026-09-08 (same day)**: user replied "proceed" - all six decisions locked on the filed
recommendations, copy table binding, implementation started (container worker).

## Acceptance Criteria

- [ ] Games tab with exactly one game shows the partial guide in the empty grid cell beside the tile at 390 / 768 / 1280; with two games it is gone; while an upload is in flight it is hidden
- [ ] The Games CTA opens the game (lands in Annotate)
- [ ] Clips / Reels / Published show the partial guide as a filler beside a short first row on desktop and tablet, and it disappears once the tiles fill the row
- [ ] Below `sm` the partial guide never renders (the empty guide still does)
- [ ] The empty-state guide (T8980) is byte-identical: existing EmptyTabGuide/fourTabIA tests untouched and green
- [ ] Partial copy matches the approved table; no em dashes
- [ ] `clips-add-video` tutorial target on exactly one node in the empty, partial and full Clips states
- [ ] No persisted state; no UA sniffing; carousel filler decided by measurement, not breakpoint
- [ ] Unit + affected e2e green; Branch CI green
