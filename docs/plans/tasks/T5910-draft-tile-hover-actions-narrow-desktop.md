# T5910: Reel-draft tile action buttons don't appear on hover in a narrow desktop window

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-25

## Problem

User report 2026-07-25 (desktop, after resizing the browser window narrower):

> "after resizing i didn't get the button options when mousing over this done my reel (the selected one)"

Screenshot shows a ~478px-wide window, the "Brilliant Control" draft tile selected (cyan border,
"Ready" + "Done" badges) — but hovering it reveals **none** of the action buttons (preview, rename,
Framing, Overlay, delete). The tile is unusable by mouse at that width.

## Root cause (traced — this is a width-vs-input-type bug)

`DraftTile.jsx:283-286` picks the reveal mechanism from `isMobile`:

```js
// Desktop reveals actions on hover; mobile reveals them on long-press (actionsRevealed).
const actionsVisibility = isMobile
  ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
  : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
```

and `isMobile` comes from `useIsMobile()` (`hooks/useIsMobile.js`):

```js
const MOBILE_QUERY = '(max-width: 1023px), ((hover: none) and (pointer: coarse))';
```

That query is **width OR touch**. A narrow *desktop* window (< 1024px) matches on width alone, so
the tile switches to the long-press path — and long-press handlers are only wired for touch
(`onTouchStart`/`onTouchMove`/`onTouchEnd`, `DraftTile.jsx:303-305`). A mouse user therefore has
**no way at all** to reveal the actions: hover is disabled, and the replacement gesture cannot be
performed with a mouse.

**The codebase already documents this exact trap.** `useIsMobile.js` ships a sibling hook whose
comment describes the bug verbatim:

> `useIsCoarsePointer` — "Distinct from `useIsMobile`: a narrow *desktop* window is 'mobile' by width
> but still has a fine mouse pointer, and must keep the byte-identical direct-drag behavior."

This is the same lesson as **T5360** ("width != input type is the bug"), which added the
`coarse-pointer` / `fine-pointer` Tailwind variants for precisely this reason — and `DraftTile`
already uses `coarse-pointer:` for its button sizing (`:287`), just not for the reveal mechanism.

## Solution

Gate the **reveal mechanism** on pointer capability, not viewport width:

- Use `useIsCoarsePointer()` (already exported from `hooks/useIsMobile.js`) for the
  hover-vs-long-press decision in `DraftTile`.
- Fine pointer (mouse/trackpad) at ANY width -> hover reveal.
- Coarse pointer (touch) -> long-press reveal, unchanged.
- Keep `useIsMobile` for genuinely width-driven LAYOUT choices; only the interaction mechanism moves.
- Hybrid devices (touch laptops) report coarse — acceptable, and matches T5360's precedent.

### Audit the same mistake nearby
`ProjectManager.jsx:1456,1486,1601-1603,1628-1636` uses the identical `isMobile ? long-press : hover`
pattern for game cards. Check whether it has the same defect at narrow desktop widths and fix it the
same way. Report which surfaces were affected.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx:283-286` (reveal gate), `:303-305` (touch handlers), `:287` (existing coarse-pointer usage)
- `src/frontend/src/hooks/useIsMobile.js` — `useIsMobile` (width OR touch) vs `useIsCoarsePointer` (the right tool)
- `src/frontend/src/components/ProjectManager.jsx:1456+` — same pattern on game cards, audit
- `src/frontend/src/components/collections/ReelTile.jsx` — check its reveal path too

### Related
- **T5360** — "width != input type"; added the `coarse-pointer`/`fine-pointer` variants
- T5430 — Overlay touch targets (same family)

## Acceptance Criteria

- [ ] Mouse hover reveals the tile actions at narrow desktop widths (repro: ~478px window, mouse)
- [ ] Touch long-press reveal unchanged on real coarse-pointer devices
- [ ] Desktop behavior at wide widths byte-identical
- [ ] `ProjectManager` game cards (and `ReelTile` if affected) audited and fixed the same way; report
      which surfaces were affected
- [ ] Unit test: fine pointer at narrow width -> hover classes present, not the long-press branch;
      coarse pointer -> long-press branch
- [ ] Real-browser evidence at ~478px with a FINE pointer (the repro condition — a width-only test
      cannot catch this class of bug), plus a coarse-pointer emulation check
