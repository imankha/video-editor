# T6420: TilePreviewVideo primitive + desktop hover preview (My Drafts + My Reels)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-03

Epic child 1/3 — see [EPIC.md](EPIC.md) for the design authority (YouTube/Netflix decisions
table), shared invariants, and placement rationale. This file does not repeat them.

## Problem

Draft and reel tiles are static posters; the only way to see a reel's content is the full
player (click-commit, modal, audio). No lightweight glance affordance exists.

## Solution

Build the shared `TilePreviewVideo` primitive and wire the fine-pointer (hover) activation
into both tiles. Coarse-pointer activation is T6430; this child must leave touch behavior
byte-identical (long-press action reveal untouched).

### Activation: warm early, reveal late (the perceived-speed requirement)

The intent delay gates the REVEAL, not the fetch — the user explicitly does not want a
visible wait:

| t (hover) | Action |
|-----------|--------|
| 0 | nothing (grace window — a straight-line mouse crossing must fire zero requests) |
| ~100ms | WARM: attach `src`, `preload="auto"`, muted, paused; poster untouched |
| ~450ms | REVEAL: `.play()`; crossfade video over poster on first rendered frame (`playing` event or `requestVideoFrameCallback`) |
| leave (any time) | teardown: pause, clear `src`, `load()`; poster fades back |

With the ~350ms buffering head start and R2's measured ~266ms TTFB (T3760), the frame is
typically ready at reveal time — target: reveal feels instant on a warm connection. If the
stream is not ready at t=450ms, keep showing the poster and crossfade whenever the first
frame lands (never a black box, never a spinner). Tune the two constants in one place.

- Gate on `useIsCoarsePointer()` (T5910/T6300 standard) — fine pointer only in this child.
  NEVER width or UA.
- Single-active registry (module-level) ships in this child, sized for T6430 to reuse.
- `prefers-reduced-motion` check ships here (invariant).

### Rendering

- `absolute` inside the tile, `object-cover`, same rounded clip as the poster; layered above
  poster, below actions/badges/kebab; the video element is `pointer-events-none` so the
  T5910 hover action reveal keeps working over the playing video.
- Do not portal (EPIC invariant; T5900).
- Do not disturb: poster lifecycle (`posterState` loading/shimmer/error — preview allowed
  even on branded-fallback tiles), unwatched styling, selection border, T6180 primary
  action, kebab `createPortal` positioning.

### Shared primitive

`TilePreviewVideo` (component) + `useTilePreview` (gesture timing, registry, teardown).
Two consumers is below the abstract-on-3rd-dup bar, but sibling tiles MUST NOT diverge
(T6300's history) — same justification as T6320's shared progress-track primitive. Props:
`streamUrl`, `active` (or the hook drives it), `onFirstFrame?`; the tile owns activation.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/TilePreviewVideo.jsx` — NEW primitive
- `src/frontend/src/hooks/useTilePreview.js` — NEW hook (timing, registry, teardown)
- `src/frontend/src/components/DraftTile.jsx` — poster block `:420-440`, hover transform
  note `:695`, preview-modal gate `:705`, stream URL `:727`; gate preview on
  `project.final_video_id`
- `src/frontend/src/components/collections/ReelTile.jsx` — poster block `:157-171`; do not
  regress kebab portal or long-press reveal
- `src/frontend/src/hooks/useIsMobile.js` — `useIsCoarsePointer()`
- Reference only: `MediaPlayer.jsx`, `collections/CollectionPlayer.jsx` (existing stream
  consumers), `DownloadsPanel.jsx:95-100` (watched-marking that must NOT be touched)

### Related Tasks
- Epic siblings: T6430 (touch), T6440 (setting)
- T5910/T6300 (action reveal gating on these tiles), T6180 (primary action), T5900
  (portal/containing-block lesson), T5672/T5673 (poster-tile architecture), T6320 (shared
  primitive precedent), T6290 (nothing preloads at rest)

### Technical Notes
- Knowledge docs: `.claude/knowledge/annotate.md` (tile contracts); check
  `export-pipeline.md` for the downloads/stream contract; verify `/stream` serves Range
  requests sanely for short-lived connections.
- StrictMode double-invokes effects in dev — warm/teardown must be idempotent; odd-vs-even
  request counting applies when verifying in dev (T6250).
- Tier: **M** (frontend-only, ~5 files, no schema). Reviewer yes; UI Designer only if the
  crossfade treatment needs visual judgment.

## Implementation

### Steps
1. [ ] Build `useTilePreview` (grace/warm/reveal timers, registry, teardown, reduced-motion)
2. [ ] Build `TilePreviewVideo` (poster-first crossfade, pointer-events-none, cover)
3. [ ] Wire DraftTile (gated on `final_video_id`) and ReelTile
4. [ ] Unit tests: fine/coarse gating, grace window fires no request, teardown clears src,
       single-active registry, no watched-marking call
5. [ ] Real-browser verification: desktop wide + ~478px narrow (T5910 repro width) +
       coarse-pointer emulation proving touch is untouched; network tab evidence

## Acceptance Criteria

- [ ] Hover on a Ready/Done draft tile or reel tile: warm at ~100ms, muted looping preview
      revealed at ~450ms, poster-first (no black flash, no spinner), leave restores poster
      and RELEASES the stream (network tab evidence)
- [ ] A straight-line mouse crossing of the grid fires zero video requests
- [ ] Reveal feels instant on a warm connection (first frame ready at reveal in the common
      case; evidence: screen recording)
- [ ] Drafts without a rendered video: no preview, no errors
- [ ] At most one tile previews at a time; grid at rest fires zero video requests
- [ ] Touch behavior byte-identical (long-press action reveal untouched)
- [ ] Actions, kebab portal, badges, selection, unwatched styling, full-player paths
      unaffected; `prefers-reduced-motion` disables the preview
- [ ] No writes of any kind from preview
- [ ] Frontend unit tests pass; real-browser evidence captured (T5380 lesson)
