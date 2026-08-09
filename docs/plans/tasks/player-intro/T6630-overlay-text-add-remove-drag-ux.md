# T6630: Text elements — add, remove and drag in the most obvious way

**Status:** TODO
**Impact:** 8 | **Complexity:** 4
**Follows:** [T6610](T6610-overlay-text-element-manipulation.md) (built the body drag), [T5225](T5225-overlay-text-layer.md) (built the lane)
**Related:** [T6590](../T6590-preview-image-marker-linkage-and-occlusion.md) (same lane, occlusion)

User, 2026-08-06, with a screenshot of the Overlay timeline at 500% zoom:

> what is supposed to happen when i click the text region? Also the little eye does nothing
>
> the requirement is to be able to add and remove text elements from a text layer in the most
> obvious and intuitive way and to be able to move each element via drag.

T6610 shipped believing add/remove already worked and only the body drag was missing. The user
cannot do any of the three. **The capabilities exist in code; they are undiscoverable and partly
unreachable.** This task is a UX task, not a rebuild — do NOT re-implement `addText`,
`onDeleteText` or the body drag. Make them obvious, reachable, and prove they work.

## Confirmed root causes (verified in code 2026-08-06 — do not re-derive, but confirm)

1. **The add target is a 40px strip inside a 112px lane.** The lane container is `h-28`
   (`TextLayer.jsx:264`) but the only element carrying `onClick={handleTrackClick}` is
   `.text-track`, which is `h-10` (`TextLayer.jsx:267`). The lower ~72px is visually identical
   dark lane and is completely inert — it exists only to reserve room for the per-block controls
   that render at `top-full` (T6610 item 2). A click low in the lane cannot do anything.
2. **The only affordance disappears after the first block.** "Click to add text" is gated on
   `blocks.length === 0` (`TextLayer.jsx:272`). With one block present nothing indicates the lane
   is clickable, and there is no other add control anywhere on the screen.
3. **Drag is fully wired but unproven on the real screen.** `wrappedMoveTextBody`
   (`OverlayScreen.jsx:982`) -> `OverlayModeView:808` -> `OverlayMode:276` -> `TextLayer`
   `draggingBody`. T6610's verification was **harness-only** (`/textdiag.html` + a
   `skipOnDeployedTarget` spec), which is exactly how two criteria shipped falsely green on
   2026-08-05. The user reports drag does not work at **500% zoom**. Treat "drag is broken" as
   unconfirmed-but-reported: reproduce it on the real screen at that zoom BEFORE changing drag code.

The eye toggle is NOT in scope — already fixed on `feature/T6620-shadow-blur-inert-and-title-override`.

## Design

### A. Add — make it obvious, then make it reachable

1. **An explicit "Add Text" button.** The Overlay screen already has a prominent full-width
   `+ Add Spotlight` button below the timeline; mirror it exactly (same placement, same visual
   weight, same idiom) with `+ Add Text`. It adds a block at the **current playhead time** and
   selects it, reusing `wrappedAddText` — no second add path, no new persistence path. **This is
   the primary discoverable route** and the main thing the user is missing.
2. **Fix the dead zone.** A click anywhere in the lane's empty area must add — not just the top
   40px. Keep `.text-track` as the geometry/positioning reference (blocks and levers are
   positioned against its rect); extend only the *click target*. Clicks on a block, a lever, or a
   control must keep their current meaning (`handleTrackClick` already guards `button` and
   `.lever-handle` — preserve those guards exactly).
3. **A persistent hint.** Replace the `blocks.length === 0` gate with a hint that remains visible
   in empty lane space regardless of block count (dimmer when blocks exist so it doesn't shout).

### B. Remove — put it where the user already is

1. **A "Delete text" action in the Edit Text rail.** The rail is already open for the selected
   element and already has a `Done` control, so this is the most discoverable place. Destructive
   styling per the UI style guide; it deletes the selected block and clears the selection.
2. **Keep the per-block trash button** — it is the fast path. Verify it stays clear of the
   timeline's horizontal scrollbar at high zoom (T6610 item 2 raised the lane to `h-28` for this;
   confirm it actually holds at 500% zoom, where the user's screenshot shows the controls sitting
   close to the scrollbar).
3. **Keyboard:** `Delete` / `Backspace` removes the focused block (the block body is already
   `tabIndex={0}` with `role="slider"` and arrow-key nudging from T6610).

### C. Drag — prove it, then make it feel draggable

1. **Reproduce first at 500% zoom on the real screen** with an existing DB-loaded block. If it
   works, say so plainly and move on — do not "fix" working code.
2. If broken, fix the real cause. Leads, **not conclusions**: the pointer-capture interaction with
   the timeline's horizontally-scrolling container at zoom; the block's re-render on each
   `commit=false` move; `pixelToTimeValue` measuring `trackRef` while the container is scrolled.
3. **Visible grab affordance** on hover so the block reads as draggable (`cursor-grab` is already
   set; add a hover state that makes it legible).

### Invariants that must not regress
- **Gesture-based persistence**: exactly ONE surgical write per completed drag, on drag end. No
  writes mid-drag, none from a `useEffect`. Add/delete each fire their own single surgical write.
- A lever press still resizes; a body press still moves; a click still selects (the
  `BODY_DRAG_THRESHOLD_PX = 4` click-vs-drag rule stays).
- Do not add a second add/delete/move path — extend the existing handlers.

## Relevant files
- `src/frontend/src/components/timeline/TextLayer.jsx` — lane, click target, hint, controls
- `src/frontend/src/modes/overlay/OverlayMode.jsx:267` — TextLayer mount + `getTotalLayerHeight()`
  (**keep the lane height and the left-hand label in sync**; the label is `h-20 lg:h-28` at
  `OverlayMode.jsx:182` while the lane is an unconditional `h-28` — they disagree below `lg`)
- `src/frontend/src/modes/OverlayModeView.jsx` — Overlay host; where `+ Add Spotlight` lives
- `src/frontend/src/screens/OverlayScreen.jsx:947` `wrappedAddText`, `:982` `wrappedMoveTextBody`
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — the Edit Text rail (delete action)
- `src/frontend/src/modes/overlay/hooks/useTextOverlays.js` — model; do not change the contract

## Classification hint
M-tier, frontend only, no schema. **Real-browser verification is mandatory and harness-only
verification is explicitly rejected** (T5380; the 2026-08-05 false green). Reviewer required.

## Acceptance criteria
- [ ] A first-time user can add a text element without discovering that a lane is clickable —
      an explicit, visible control exists.
- [ ] Clicking empty lane space adds a block **anywhere in the lane's height**, including the
      lower region that is inert today; verified by clicking low in the lane, not just the top strip.
- [ ] An affordance indicating the lane is clickable is visible even when blocks already exist.
- [ ] A text element can be removed from the Edit Text rail, from the per-block control, and via
      Delete/Backspace on the focused block.
- [ ] Each element can be moved by dragging its body, duration preserved, **verified at 500% zoom
      and at default zoom** on the real Overlay screen with an existing DB-loaded record.
- [ ] Levers still resize, a click still selects, and exactly ONE persist fires per completed drag
      (verified by counting requests).
- [ ] Per-block controls remain clear of the horizontal scrollbar at 500% zoom.
- [ ] Real-browser evidence at desktop and 375px for every criterion above.
