# T7160: Mobile — tap-to-select plays the preview

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-08-17

Epic child 2/3 — see [EPIC.md](EPIC.md) for the design authority (supersedes T6430) and shared
invariants. Depends on T6420 (`TilePreviewVideo` + the single-active registry) and T7170
(zero-delay reveal — land first so this inherits it instead of migrating the timing twice).

**Supersedes** [T6430](../tile-video-preview/T6430-touch-in-viewport-autoplay.md) (in-viewport
scroll autoplay) — that file is marked SUPERSEDED and kept in place, not deleted, since it
documents real rejected-alternative rationale (YouTube/Netflix/Instagram precedent, "hidden
gesture" concern) worth keeping visible.

## Problem

Touch devices have no hover, so the desktop preview trigger (`useTilePreview`'s
`enabled = ... && !isCoarsePointer`) is fully disabled on coarse pointers today — mobile tiles
never preview inline, full stop. T6430 planned to fix this with in-viewport scroll-autoplay but
was never implemented.

User direction 2026-08-17: prefer a tap-driven model instead — "there is a 2-click selection
scheme on mobile, the first click that selects the reel should play the preview." Investigated
current touch behavior on both tile types and **neither currently has that scheme as
described** — this task is introducing it, not wiring it up:

- **ReelTile** (`My Reels`): no selection step at all today. The persistent Play button is a
  single tap straight to the full player (`onPlay`); the kebab is always visible. No inline
  preview ever plays on touch.
- **DraftTile** (`Reel Drafts`): a ready-to-publish tile's body tap already opens a preview
  immediately (no reveal step) — but it's the full `MediaPlayer` modal (`startPreview`/
  `isPreviewing`), not the inline `TilePreviewVideo` primitive (`previewStreamUrl` is forced
  `null` while that modal is open). A NOT-ready tile requires a 500ms long-press to reveal its
  action row (`actionsRevealed`), then a second tap on a small Play icon within that row to open
  the same modal preview.

## Solution (needs Architect design-gate — open questions below)

Target shape, to be finalized at Stage 2:
- On coarse-pointer devices, the FIRST tap on an eligible tile (has a streamable preview source
  — same eligibility T6430 defined) both **selects** it (a visible marker, e.g. a ring —
  DraftTile already has this idiom for `isCurrentProject`) and **starts the inline
  `TilePreviewVideo`** via the same WARM→REVEAL machinery `useTilePreview` already drives for
  desktop hover, just triggered by `touchstart`/`click` instead of `pointerenter`. Same
  single-active registry — selecting tile B force-stops tile A, exactly like today's hover.
- A SECOND tap on the already-selected (already-previewing) tile proceeds to the tile's existing
  "open" action — ReelTile: `onPlay` (full player); DraftTile: its existing `handleCardClick`
  routing, reconciled per open question 2 below.
- Tapping a DIFFERENT tile while one is selected switches selection (single-active registry)
  rather than acting on the new tile.
- Tapping outside any tile (or scrolling away, or the full player/modal opening) deselects and
  tears down the preview, mirroring hover's `onPointerLeave`/teardown semantics.

### Open design questions (Stage 2 / Architect)
1. **ReelTile behavior change**: today one tap = instant full player. This task makes that two
   taps (select+preview, then open) on touch. Confirm with the user this tradeoff (discoverable
   preview vs. one more tap to reach playback) is intended before implementing — it's a real
   regression in tap-to-play speed for a user who already knows what they want to watch.
2. **DraftTile reconciliation**: the ready-state's current "tap previews immediately" (modal, no
   selection step) already satisfies "first tap plays something." Decide whether it moves to the
   new inline-preview-on-select model (consistent with ReelTile) or keeps its modal-preview
   shortcut as a deliberate exception. Also decide whether long-press-to-reveal (non-ready
   state) is replaced outright or kept for the actions row specifically — only the PREVIEW
   gesture is in scope here, the action-reveal system (T5910/T6300) must stay intact per shared
   invariants.
3. Visual treatment for "selected" — reuse `isCurrentProject`'s accent-ring pattern, or hand to
   UI Designer if it needs to read as visually distinct from that.
4. Selection persistence across scroll/re-render, and interaction with T6440's future
   data-saver/off-switch gate.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useTilePreview.js` — extend the activation trigger beyond
  `onPointerEnter`/`onPointerLeave` for the coarse-pointer path; reuse WARM/REVEAL phases and the
  registry as-is
- `src/frontend/src/components/collections/ReelTile.jsx` — currently: persistent always-visible
  Play (`onClick={(e) => { preview.stop(); onPlay(e, download); }}`) on coarse pointers; needs
  the select-then-open two-step
- `src/frontend/src/components/DraftTile.jsx` — `handleCardClick`, `handleTouchStart`/
  `handleTouchMove`/`handleTouchEnd` (long-press), `actionsRevealed`, `startPreview`/
  `stopPreview`/`isPreviewing` — reconcile per open question 2
- `src/frontend/src/hooks/useIsMobile.js` — `useIsCoarsePointer()`
- `../tile-video-preview/T6430-touch-in-viewport-autoplay.md` — superseded design; read for
  what NOT to rebuild (the IntersectionObserver/coordinator machinery is not needed — tap
  doesn't require viewport ranking)

### Related Tasks
- Supersedes T6430 (EPIC.md's merge note documents why)
- T6420 (hard dependency — primitive + registry), T7170 (land first — zero-delay reveal)
- T5910/T6300 (long-press = reveal-actions gesture on DraftTile) — must not silently break; open
  question 2 above scopes the overlap explicitly
- T6440 (depends on this instead of T6430 for its touch gating)

### Technical Notes
- iOS Safari: `playsInline` + muted autoplay-on-tap is well-supported — unlike T6430's
  scroll-momentum autoplay concern, touch-initiated playback here is a direct user gesture, so
  autoplay policy is not a blocker.
- StrictMode double-mount: touch handlers idempotent, same bar as T6420's pointer handlers.
- Tier: **L** (new interaction pattern, touches shared invariants + two tile types, has open
  design questions above). Architect design gate required before implementation.

## Acceptance Criteria
- [ ] On a touch device, tapping an eligible tile selects it and starts its inline preview with
      no separate reveal gesture
- [ ] A second tap on the selected/previewing tile opens it (full player / editor, per tile type)
- [ ] Tapping a different tile switches selection (single-active registry, same as desktop)
- [ ] Deselect (tap outside / scroll away / full player opens) tears down the preview, releases
      the stream
- [ ] Long-press action-reveal (T5910/T6300), kebab, badges remain functional per Stage 2's
      resolution of open question 2
- [ ] `prefers-reduced-motion` disables it; T6440's setting/data-saver gate applies here too
- [ ] Real-browser + real-device evidence (touch emulation minimum, real device pass
      recommended — T5380)
- [ ] Frontend unit tests pass
