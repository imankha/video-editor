# T12930: Frontend: "Keep only marked plays" action, plays-only tile, Watch plays routing, Restore

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (frontend, ~8 files, new tile state + new confirm sheet; ui-designer for the tile skin and sheet copy)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Keep Only Marked Plays](EPIC.md)

## Problem

The user has no gesture to declare a game finished, and nothing on the Games tab distinguishes a game
they still intend to mark from one they only keep for its plays.

## Solution

### 1. The gesture (GameTile kebab)
- New kebab row **"Keep only marked plays"** (lucide `Scissors` or `ListVideo`), shown only when
  `!isExpired && !isUploadFailed && game.plays_only !== true && hasAnnotations && !game.source_profile_id`
  (owned, live, at least one play, not a reference card; pool games excluded while T7300 is open).
- Tap opens a confirm sheet (same portal / bottom-sheet pattern as the kebab; **never closes on backdrop
  click**, per house rule). Copy (draft, ui-designer finalizes, no em dashes):
  - Title: **Keep only the marked plays?**
  - Body: "The full game video stays until {available until date} and you can restore it until then.
    After that only your {n} plays remain. Plays can still become highlights."
  - Primary: **Keep plays only**. Secondary: **Cancel**.
- Confirm fires the gesture handler `keepOnlyMarkedPlays(gameId)` -> `POST /api/games/{id}/plays-only`
  (surgical, from the click; no effect-driven write), then refetches games. Toast: "Only the marked
  plays are kept. Restore the full video any time before {date}."

### 2. Plays-only tile state (`game.plays_only === true`)
- Poster stays in color (NOT the expired grayscale/dim skin). Top-left chip **"Plays only"**
  (`ListVideo` 10px, neutral cyan/gray family, distinct from the yellow expiry chip and the rose fail chip).
  The chip REPLACES the expiry chip (T12940 owns the never-nag rules).
- Counts line unchanged ("{n} plays • {r} finished", T12950 adds brilliants).
- **Tile tap opens Watch plays** (`onPlayRecap`), never Annotate (D1). Enter/Space same.
- Kebab for a plays-only game: Watch plays, Share game, **Restore full video** (only while
  `game.storage_status === 'active'`), Delete game. Hidden: Add video, Extend storage, Keep only marked plays.
- `preservation_status === 'pending' | 'failed'` is NOT a blocking state for the user: Watch plays
  works through game-video seek-through meanwhile. Show nothing for `pending`; for `failed` show a
  small "Plays not backed up yet" caption under the chip (visible, not a silent fallback) and keep Restore available.

### 3. Restore
- Kebab "Restore full video" -> confirm sheet ("Restore the full video? You can mark more plays again.
  Keep-only can be chosen again later.") -> `restoreFullVideo(gameId)` -> `DELETE /api/games/{id}/plays-only`
  -> refetch. A 409 `source_expired` from the backend surfaces as a toast and refetches (the UI was stale).

### 4. Watch plays modal (`RecapPlayerModal`)
- For a plays-only game: hide the Highlights-tab "jump to Annotate" button (it would open the editor);
  per-play **Create clip** stays (that is how plays become highlights).
- Footer line while restorable: "Want to mark more plays? **Restore full video**" (same restore handler).

### 5. Annotate entry guard
- A deep link or stale breadcrumb into `/annotate` for a plays-only game: `AnnotateContainer.applyGameData`
  reads `gameData.plays_only`; `AnnotateModeView` renders a panel in the `isSourceExpired` family with
  plays-only copy ("This game keeps only its marked plays. Restore the full video to mark more.") and a
  Restore button; Mark play disabled. Reuse the yellow panel structure, different copy and icon.
  Do not add a redirect loop; the panel is the state.

### 6. State and copy
- `gamesDataStore.js`: `keepOnlyMarkedPlays`, `restoreFullVideo` (gesture handlers, surgical calls).
- `displayNames.js`: `GAME_CARD.PLAYS_ONLY_CHIP`, `LIBRARY_ACTIONS.KEEP_ONLY_PLAYS`,
  `LIBRARY_ACTIONS.RESTORE_FULL_VIDEO`, sheet copy. Vocabulary: "play" for a marked moment, "highlight"
  for the finished product, never "reel" for one.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx` - kebab rows, chip, tap routing (no unit tests exist today; add `GameTile.playsOnly.test.jsx`)
- `src/frontend/src/components/ProjectManager.jsx` - wires `onKeepOnlyPlays` / `onRestoreFullVideo`, confirm sheets
- `src/frontend/src/components/RecapPlayerModal.jsx` - hide jump-to-Annotate, footer restore line
- `src/frontend/src/stores/gamesDataStore.js` - gesture handlers
- `src/frontend/src/containers/AnnotateContainer.jsx`, `src/frontend/src/modes/AnnotateModeView.jsx` - plays-only panel (next to the `isSourceExpired` panel, ~line 756)
- `src/frontend/src/config/displayNames.js` - copy
- `src/frontend/e2e/T12930-keep-only-plays.spec.js` - new (tile -> confirm -> Watch plays -> Create clip -> Restore)

### Related Tasks
- Depends on: T12920
- Blocks: T12940 (chip precedence)
- Related: T12850 ("Available until" date; the confirm sheet reuses its date rendering if it lands first), T2410 (old playback-mode viewer idea, superseded for v1 by D1)

### Technical Notes
- Knowledge docs: `annotate.md` (GameTile T5681/T8260 notes, kebab pattern, T10800 player sizing), `export-pipeline.md` (RecapPlayerModal, recap-data kinds), `guidance.md` (if a guide step anchors on the tile).
- Playwright specs are not run by Branch CI; the e2e spec is local evidence, the unit tests are the CI gate.
- Phone: the confirm sheet is a bottom sheet; the kebab already switches on `useIsMobile`.
- `UploadingGameTile.jsx` mirrors the failed skin only; no plays-only mirror needed (an uploading game cannot be kept-only).

## Implementation

### Steps
1. [ ] ui-designer: chip, sheet, panel copy and classes (reuse T7490 chip geometry)
2. [ ] Failing tests: kebab row visibility matrix; confirm -> store handler -> POST; plays-only tap opens Watch plays; Restore gated on storage active; Annotate panel
3. [ ] Implement tile + sheets + store handlers + modal + panel
4. [ ] e2e spec on the local stack
5. [ ] Knowledge docs

### Progress Log

**2026-10-18**: Filed.

## Acceptance Criteria

- [ ] "Keep only marked plays" appears only for owned, live, non-reference games with >=1 play
- [ ] Confirm sheet never closes on backdrop click; Cancel writes nothing
- [ ] After confirm the tile shows "Plays only", stays in color, and tap opens Watch plays
- [ ] Every play in Watch plays can still become a highlight (Create clip)
- [ ] "Restore full video" present until the storage expiry, absent after; restoring returns the tile to normal and Annotate opens again
- [ ] Deep link into Annotate for a plays-only game shows the plays-only panel, Mark play disabled
- [ ] Curated frontend unit tests pass; e2e spec passes locally; CI green
