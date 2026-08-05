# T6610: Overlay text elements — drag to reposition, and a delete button you can actually hit

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Follows:** [T5225](player-intro/T5225-overlay-text-layer.md) (built the text layer)
**Sibling:** [T6480](T6480-overlay-text-editor-contrast.md) — same rail, contrast pass; do together

User, 2026-08-05, with screenshots of the overlay timeline and the Edit Text rail:

> I expect to be able to add, remove and drag to reposition text elements in a particular text
> region, and the "edit text" dialog will be for the selected text element. Also it's currently hard
> to click delete for the text box, can we get some padding before the scroll bar.

## Read the current state before building anything

**Most of the expectation is already implemented** — do NOT rebuild it:

| Capability | State |
|---|---|
| Multiple text elements per region | **Works** — `TextLayer` maps over `blocks` |
| Add | **Works** — click the lane, `OverlayScreen.jsx:947` `addText(clickTime, DEFAULT_TEXT_SPEC)` |
| Remove | **Works** — `onDeleteText` / `Trash2` (but see item 2) |
| Select → editor edits that element | **Works** — `selectedTextId` / `onSelectText`; adding auto-selects |
| Resize the time range | **Works** — start/end levers with boundary snapping (`SNAP_PX = 10`) |
| **Drag the whole element to reposition** | **MISSING — this is the task** |

Confirm each row yourself in a real browser before touching code. If any row is actually broken
rather than missing, say so and fix that instead of adding a new idiom.

## 1. Drag the element to reposition it

Today only the two **levers** (edges) drag, via `draggingLever = { blockId, type: 'start' | 'end' }`
(`TextLayer.jsx:28`). Grabbing the **body** of a block does nothing but select it, so moving a text
element in time means dragging one edge, then the other — and its duration changes as you do it.

Add a body drag that moves start and end **together**, preserving duration:

- Reuse the existing pointer-event mechanics and the existing `computeSnappedTime` /
  `SNAP_PX` boundary snapping — this is not a new drag idiom (the T5225 design says so explicitly).
- The **leading edge** should be what snaps to a clip boundary / reel start, matching lever behaviour.
- Clamp to the region so a block cannot be dragged outside its text region or off the timeline.
- Do not break the levers: a pointerdown on a lever must still resize, not move. The lever hit areas
  overlap the block body, so hit-testing order matters.
- **Persistence is gesture-based**: fire ONE surgical write on drag END, never during the drag and
  never from a `useEffect`. There is an existing move/persist path for the levers
  (`onMoveTextStart` / `onMoveTextEnd`) — extend it, do not add a second write path.
- Keyboard equivalent for accessibility, consistent with how the levers behave today.

## 2. The delete button is hard to click

The delete control sits directly above the timeline's horizontal scrollbar, so the pointer lands on
the scrollbar instead. Add padding/space below the text lane so the control has clear separation from
the scroll region, and give it a hit box that meets the 44px coarse-pointer floor used elsewhere
(`PosterMarkerLayer` uses `isCoarsePointer ? 44 : 32` as precedent).

Check the same crowding for the other per-block controls (visibility toggle) and for the region's own
controls — the screenshot shows at least two small red buttons stacked near the scrollbar.

## 3. Contrast — belongs to T6480, not here

The user also reported: *"the background here is too light for 'size', 'shadow blur' and 'stroke
width' texts to be white."* That is exactly [T6480](T6480-overlay-text-editor-contrast.md), which is
open and already names the same rail and the same class of defect. **New evidence has been added to
T6480** (`TextSpecEditor.jsx:55,71` — `text-gray-400` uppercase labels on the Overlay host's
light-purple panel). Fix it there, in the same worker session, as a separate commit.

## Relevant files
- `src/frontend/src/components/timeline/TextLayer.jsx` — blocks, levers, `draggingLever`, delete
- `src/frontend/src/screens/OverlayScreen.jsx:947` — add path; `onMoveTextStart` / `onMoveTextEnd`
- `src/frontend/src/api/overlayActions.js` — surgical writes (`deleteText` at `:249`)
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — the rail (T6480's subject)
- `src/frontend/src/modes/OverlayModeView.jsx` — the Overlay host

## Classification hint
M-tier, frontend only, no schema. **Real-browser verification is mandatory** — drag/pointer work
cannot be proven in jsdom (T5380). Parse Playwright's own summary, not the wrapper exit code.
Reviewer required. Watch the gesture-persistence rule: one surgical write per completed drag.

## Acceptance criteria
- [ ] A text element can be dragged by its body to a new time, duration preserved, snapping to clip
      boundaries on the leading edge.
- [ ] Levers still resize; a lever press never moves the block, and a body press never resizes it.
- [ ] A block cannot be dragged outside its region or off the timeline.
- [ ] Exactly ONE persist call fires per completed drag, on drag end — verified by counting requests.
- [ ] Delete is comfortably clickable, clear of the scrollbar, 44px on coarse pointers.
- [ ] Add / remove / select-drives-the-editor confirmed still working (regression check, not rebuild).
- [ ] Real-browser evidence at desktop and 375px.
