# T11800: "Done for now" re-selects the play and confirms

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Tier:** M (frontend only, ~5 files + tests, ~140 LOC). Bug part needs a red-first reproduction.
**Created:** 2026-10-04
**Decision gate:** S3 (recommended C2: stay on Annotate, fall back to C1 when the edit did not start on Annotate) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 2 of 5 in [Epic C](EPIC.md). Runs before T11840 (same `AnnotateContainer.jsx`). Milestone rules:
[README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/07](../../../ux/2026-10-04-parent-usability-audit/desktop/07-done-returns-to-empty-annotate.png).
After an 8-credit render the parent chose "Done for now" and landed on the game's Annotate screen
with nothing selected, the playhead at 0:00, Frame Highlight and Add Spotlight locked, and a toast
saying "publish it from here". It looks like the work disappeared.

Two parts:
1. **Bug:** the play should have been re-selected. `handleAddSpotlightLater`
   (`screens/FocusScreen.jsx:1115-1140`) sets `setPendingGame(origin.gameId, null, origin.sourceClipId)`,
   but the consumer effect (`containers/AnnotateContainer.jsx:1408-1456`, armed at `:1219`) either
   finds no match (drops it with `console.warn` at `:1450`) or a later auto-deselect undoes it.
   **Which one is unverified. Reproduce first** and look for that warning.
2. **Confirmation:** a toast that disappears is not enough proof after a paid render.

## Solution (C2)

1. Fix the re-selection so Play 1 is selected on arrival: its row gets `bg-gray-800 ring-1 ring-cyan-500/60`
   and the mode tabs unlock.
2. Replace the toast with a consume-once banner above the video:
   - Container: `bg-gray-800 border border-cyan-500/40 rounded-lg p-3 flex items-start gap-3`
   - `CheckCircle2` 16 `text-green-400`
   - Title `text-sm font-medium`: **{Play name} is framed**
   - Body `text-xs text-gray-400`: **It's in Clips as a draft. Add a spotlight or finish it any time.**
     (If S2 keeps "Publish": "...Add a spotlight or publish it any time.")
   - Buttons: **Add spotlight** (primary cyan, opens Spotlight for that clip) and **View in Clips**
     (ghost, goes to Clips with the card ringed, see fallback below), plus an X with aria-label **Dismiss**.
   - At 390: banner pinned under the header; buttons full width, stacked, 44px.
   - Memory-only marker. Cleared on dismiss, on selecting another play, or on leaving the screen.
3. **Fallback (C1)** when the Focus session did not start from Annotate (no `peekAnnotateOrigin`, e.g.
   an uploaded clip with no game): go to the Clips tab (`sessionStorage 'projectManagerTab' = 'projects'`,
   read at `ProjectManager.jsx:1183-1188`), scroll the new tile into view and ring it for 2.5s, reusing
   the Games tab's `highlightGameId` pattern (`ProjectManager.jsx:603, 1304-1311`). Add `data-project-id`
   to DraftTile for the target.
4. "Done for now" button weight on the ready screen: secondary button, centered under the tiles,
   `h-10 px-5 rounded-lg border border-gray-600 text-sm font-medium text-gray-200 hover:bg-gray-800`;
   full width `h-11` at 390. (Component: `components/FocusPublishActionBar.jsx:222-224`.)

## Relevant Files (under `src/frontend/src/`)

- `screens/FocusScreen.jsx:1115-1140` (`handleAddSpotlightLater`), `:1408` (wiring)
- `utils/pendingNavigation.js:177` (`peekAnnotateOrigin`); set at `AnnotateScreen.jsx:254, 290`
- `containers/AnnotateContainer.jsx:1219, 1408-1456`
- `stores/galleryStore.js:30-67` - the T11580 consume-once marker pattern to copy (`justPublished`,
  `consumeAutoExpand`). Add a `justFramed` marker `{ projectId, clipName, gameId }`.
- `components/FocusPublishActionBar.jsx`, `config/displayNames.js:569-575` (`FOCUS_PUBLISH_LATER_TOAST`)
- Keep consistent: `screens/OverlayScreen.jsx:1705-1708` and `components/DraftReelPreview.jsx:174-177`
  use the same "return to Annotate" path; they should get the same re-selection fix.

## Implementation Steps

1. **Reproduce (red):** write `AnnotateContainer.doneForNowReselect.test.jsx` that sets a pending
   selection for an existing region and mounts the container through the real load path; assert the
   region is selected after load. Watch it fail; note which branch (no match vs. later deselect).
2. Fix the consumer so the selection lands after regions and `videoDuration` are ready, and is not
   undone by auto-deselect. Keep it consume-once.
3. Add the `justFramed` marker to the store; set it **inside** `handleAddSpotlightLater` (gesture
   handler), never in an effect.
4. Render the banner in Annotate when the marker matches the selected play; clear it per the rules above.
5. Implement the C1 fallback for the no-origin case.
6. Remove the old toast copy or update it so it never says "from here".

## Acceptance Criteria

1. Frame a play, Generate, Done for now: Annotate opens with that play selected, mode tabs unlocked,
   and the banner naming the play.
2. "Add spotlight" in the banner opens Spotlight for that clip; "View in Clips" shows the Clips tab
   with that tile ringed.
3. Banner disappears on dismiss, on selecting another play, or after navigating away; it never
   reappears on reload.
4. A Focus session started from an uploaded clip (no game) lands on Clips with the tile ringed.

## Tests

- Red-first test from step 1. Plus `screens/__tests__/focusPublishExit.test.jsx:200` (asserts the
  Annotate return; keep it, add the selection assertion), `overlayPublishExit.test.jsx:250`,
  `pendingNavigation.test.js:159-190`, `AnnotateContainer.pendingSelection.test.jsx`.
- Pattern reference: `CollectionsTab.justPublished.test.jsx`.

## Landmines

- T8990: auto-expand/ring must be consume-once, never derived from a value that stays truthy.
- The Clips tab's initial-tab logic (`ProjectManager.jsx:1181-1215`, T10310) can bounce to Games.
- Drafts under "Legacy reels" (T11220) render through a different path; test the ring there or note it.
- If S3 = C1 for everything, skip the banner and always use the fallback path (still fix the
  re-selection bug, because Overlay and DraftReelPreview share it).
