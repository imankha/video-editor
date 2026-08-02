# T6300: My Reels tile actions are invisible until hover — user could not find them

**Status:** WAITING ON USER — feature/T6300-reel-tile-visible-actions pushed, Branch CI green (30733762815); awaiting fetch/test/merge
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-31
**Updated:** 2026-07-31

## Problem

User report (2026-07-31, imankh): *"I can't actually access the kabob or do anything (copy link,
play, etc) with reels in myReels, the UI is gone."*

**The actions are not gone — they are `opacity-0` until hover.** Verified by driving the running
app (Playwright, real account, My Reels open, group expanded):

| state | opacity | pointer-events |
|-------|---------|----------------|
| at rest | **0** | **none** |
| hovering the tile | **1** | **auto** |

The kebab is present at a real 33x33 rect, and `elementFromPoint` at its centre returns the
kebab's own SVG — **nothing is intercepting the click**. The mechanism works. It is undiscoverable.

`ReelTile.jsx:137-139`:
```js
const actionsVisibility = isMobile
  ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
  : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
```

Compounding it: the actions sit at the tile's top-**left** over the poster (kebabs conventionally
sit top-right), and the tile is only 150x267, so there is no persistent affordance hinting they
exist.

### Second, worse case: touch Windows has no path at all

`isMobileDevice()` (`hooks/useWebShare.js:11-13`) matches only:
```js
/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent))
```
A **touchscreen Windows** device is therefore `isMobile === false`, which selects the
hover-only branch — but a touch device has no hover, and the long-press handler is only wired
when `isMobile` is true (`:146-148`). Those users cannot reach play, copy-link, or the kebab
**at all**. This is a functional dead end, not just a discoverability problem.

## Solution

Give the tile a persistent affordance, and fix the capability detection.

1. **Persistent affordance.** At minimum a always-visible kebab (or an always-visible primary
   action + kebab). Hover may still promote/expand the rest, but discovering that a reel *has*
   actions must not require hovering it.
2. **Detect capability, not device — the fix already exists in this codebase.** **T5910 fixed
   exactly this bug on `DraftTile`** and the hook it standardised on is
   `useIsMobile()` (`src/frontend/src/hooks/useIsMobile.js`), a live `matchMedia` query
   (`(max-width: 1023px), ((hover: none) ...)`) with a change listener. `ReelTile` never got the
   memo — it takes `isMobile` from `useWebShare()`, which is a **UA sniff**. Switch ReelTile's
   hover-vs-long-press selection to `useIsMobile()` (and/or `useIsCoarsePointer()`, also in that
   file) so it matches DraftTile. **Keep `useWebShare().isMobile` for the Share-vs-Copy-link
   choice** — Web Share API availability is a genuine platform question and that use is correct.
   The two concerns are currently conflated behind one flag; separating them IS the fix.
3. Keep every existing action working: Play, Copy link / Web Share, and the kebab's contents.

**This is a UI task with real design latitude — include the UI Designer and get the treatment
approved before implementing.** Match the existing style guide; do not invent a new visual
language.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/ReelTile.jsx` — `actionsVisibility` `:137-139`,
  long-press handlers `:126-136`, touch wiring `:146-148`, actions row `:215-235`, tile root
  with `group/tile` `:143-152`
- `src/frontend/src/hooks/useWebShare.js` — `isMobileDevice()` `:11-13`, `isMobile` memo `:55`,
  `capability` `:57-67`
- `src/frontend/src/components/DownloadsPanel.jsx` — passes `isMobile` to tiles `:221`, `:395`
- `src/frontend/src/components/collections/CollectionHeader.jsx` — its actions ARE always
  visible; the inconsistency the user noticed (collection header has visible buttons, the tiles
  below do not)

### Related Tasks
- **T5910** (DONE, deployed 2026-07-28) — *"Draft-tile action buttons don't appear on hover in a
  narrow desktop window"*. **The same bug, already fixed on the sibling component.** Its root
  cause was `DraftTile` picking hover-vs-long-press from the wrong signal; the fix was
  `useIsMobile()`'s media query. ReelTile has the identical defect with a worse signal (UA
  sniff). Read T5910's task file first and copy its approach rather than inventing one.
- **T6180** — *"a ready Draft Reel has no primary action"*, same user, same root pattern:
  the affordance existed but was undiscoverable. Read its treatment and stay consistent —
  these two surfaces should not diverge.
- **T5672 / T5673** (UI Pass epic) — introduced the poster-tile skin and this hover behaviour.
  `.claude/knowledge/annotate.md` carries the tile contracts.

### Technical Notes
- **Not caused by T6190/T6200.** The integration branch's diff touches zero files under
  `src/frontend/src/components/`; `ReelTile.jsx` was last changed by T5672.
- The kebab uses `createPortal` with viewport-aware positioning (added after a clipping bug) —
  do not regress that when changing the trigger's placement.
- Two-click delete confirmations inside a menu break if the menu closes on click; the same trap
  T6180 hit. Verify, don't assume.
- Coarse-pointer sizing already exists in `actionBtnClass` (`min-h-[44px]`) — keep >=44px targets.

## Implementation

### Steps
1. [ ] UI Designer: propose the persistent-affordance treatment; get approval
2. [ ] Implement always-visible actions (or primary + kebab) on ReelTile
3. [ ] Replace the hover/long-press gate with a `(hover: hover)` / `(pointer: fine)` capability check
4. [ ] Verify every existing action still works, incl. the portal-positioned kebab menu
5. [ ] Verify on a coarse-pointer emulation that actions are reachable without hover

## Acceptance Criteria

- [ ] A reel tile's actions are discoverable without hovering
- [ ] On a hover-less (touch) device the actions are reachable — verified with pointer emulation
- [ ] Play, Copy link / Web Share, and every kebab item still work
- [ ] Kebab menu still positions correctly (no clipping regression)
- [ ] Treatment is consistent with T6180's draft-tile decision
- [ ] Frontend unit tests pass
