# T5860: Reel player overlay is not modal — clicks pass through to tiles/carousel underneath

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-25

## Problem

User report 2026-07-25 (desktop), on the new My Reels layout:

> "when I hit play and watch a video from a reel, it's slow to open, i see a slice of video, then it
> opens completely and the underlying buttons (tiles) seem to keep interacting with my mouse."

Two defects, one of them a real interaction bug:

### A. The player is not modal (the reported bug)

`CollectionPlayer` — the shared story player used for BOTH single reels and collections — renders a
panel with **no backdrop**:

```jsx
// src/frontend/src/components/collections/CollectionPlayer.jsx:134
<div className="fixed inset-0 z-[70] bg-black flex flex-col select-none md:inset-12 md:rounded-xl md:overflow-hidden">
```

On mobile `inset-0` covers the viewport, so it behaves modally by accident. On **desktop (md+)
`md:inset-12` insets the panel 3rem from every edge**, leaving a gutter ring around the player where
the underlying My Reels tiles/carousel are fully exposed and interactive. Hovering/clicking in that
gutter hits `ReelTile`/`DraftTile` hover states, kebab menus, and click handlers *while a video is
playing on top* — exactly the reported symptom.

None of the three render sites supplies a backdrop either:
- `src/frontend/src/components/DownloadsPanel.jsx:522` (My Reels — the reported path)
- `src/frontend/src/components/ranking/RankingGame.jsx:264`
- `src/frontend/src/components/SharedCollectionView.jsx:113`

**The codebase already has the correct pattern twice** — copy it, don't invent one:
- `DraftTile.jsx:464-468` — backdrop `fixed inset-0 bg-black/80 z-[60]` + panel `z-[70]`
- `SharedVideoOverlay.jsx:160-163` — backdrop `fixed inset-0 bg-black z-[60]` + panel `z-[70]`

Beyond pointer events, the player is also missing the rest of the modal contract: no focus trap, no
background scroll lock, no `role="dialog"`/`aria-modal`, and background tiles stay in the tab order.

### B. Slow open / "slice of video" (secondary)

The player appears progressively — a horizontal *slice* of video renders before it expands to full
size. Likely the `<video>`/container being laid out before metadata (dimensions) are known, or the
panel animating in while the video element sizes itself. Investigate and make the open state
deterministic: reserve the correct aspect box up front and show a poster/skeleton until the video
can actually paint, rather than a partially-rendered frame. Do NOT fabricate a frame; a
poster/skeleton is the honest placeholder (no-silent-fallback standard).

## Scope decision

Fix `CollectionPlayer` itself (single fix, all three consumers benefit) rather than adding a
backdrop at each call site — the component owns its own modality. Prefer extracting/using a shared
modal-shell primitive **only if one already exists**; otherwise match the existing two-element
backdrop+panel idiom rather than introducing a new abstraction for the 3rd occurrence
(abstract-on-3rd rule — judgment call at implementation; a small shared `<ModalShell>` is defensible
here since this is the third copy).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — the fix (root at :134)
- `src/frontend/src/components/collections/CollectionPlayer.test.jsx` — existing tests to extend
- `src/frontend/src/components/DownloadsPanel.jsx:522` — My Reels render site (reported path)
- `src/frontend/src/components/ranking/RankingGame.jsx:264`, `SharedCollectionView.jsx:113` — other sites
- `src/frontend/src/components/DraftTile.jsx:464-468`, `SharedVideoOverlay.jsx:160-163` — the correct pattern
- `src/frontend/src/components/BrandedEndCard.jsx:11` — already reasons about CollectionPlayer's z-[70]; keep consistent

### Related
- UI Pass epic (T5671-T5683) introduced the poster tile/carousel layout this regressed against
- **No backdrop-click-to-close**: project standard is that modals never close on backdrop click
  (misclicks must not dismiss). The backdrop must SWALLOW the event, not close the player.

## Implementation

### Steps
1. [ ] Add a backdrop beneath the panel (`fixed inset-0 z-[60]`, opaque/dimmed) inside
       `CollectionPlayer`, so no gutter exposes the content underneath at any breakpoint
2. [ ] Backdrop swallows pointer events (no pass-through) and does NOT close on click
3. [ ] Complete the modal contract: `role="dialog"` + `aria-modal="true"`, focus trap, background
       scroll lock, background content removed from tab order; Escape closes (existing behavior)
4. [ ] Fix the progressive "slice" open: reserve the aspect box / show poster-or-skeleton until the
       video can paint
5. [ ] Playwright regression spec (see below) + unit tests

### Playwright reproduction / regression (required)
Deterministic assertion — with the player open, a point in the desktop gutter must NOT hit a tile:

```js
// desktop viewport (e.g. 1280x800) so md:inset-12 applies
await openReelPlayer(page);
const hit = await page.evaluate(() => {
  const el = document.elementFromPoint(8, window.innerHeight / 2); // gutter, outside the panel
  return { tag: el?.tagName, cls: el?.className?.toString().slice(0, 120) };
});
// FAIL (pre-fix): resolves to a ReelTile/DraftTile button underneath
// PASS (post-fix): resolves to the backdrop element
```
Also assert: hovering the gutter does not trigger a tile hover/reveal state, and a click there does
not navigate or open a tile menu. Prove it fails before the fix and passes after.

## Acceptance Criteria

- [ ] With the reel player open on desktop (>= md), no pointer event reaches tiles/carousel behind it
- [ ] `document.elementFromPoint` in the gutter resolves to the backdrop, not a tile
- [ ] Backdrop does not close the player on click (project standard)
- [ ] Player is a proper modal: role/aria-modal, focus trapped, background scroll locked and untabbable
- [ ] Opening shows a poster/skeleton in the correct aspect box — no partially-rendered "slice"
- [ ] All three consumers (My Reels, RankingGame, SharedCollectionView) fixed by the single change
- [ ] Playwright spec fails pre-fix and passes post-fix; unit tests pass
