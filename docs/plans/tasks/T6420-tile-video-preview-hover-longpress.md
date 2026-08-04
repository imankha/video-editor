# T6420: Play video preview on hover / long-press for My Drafts and My Reels tiles

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-03

## Problem

Draft and reel tiles are static posters. The user wants the tile itself to come alive —
hovering a tile (desktop) or long-pressing it (touch) should play the reel's video inline in
the tile, YouTube-thumbnail style. Motion + professionalism is a core product value
(animation-polish direction, 2026-07): the celebration surfaces should feel like video, not a
photo album.

Today the only way to see a reel's content is the full player (DraftTile's portaled preview
modal, or the story player for published reels) — a click-commit, modal, with audio. There is
no lightweight "glance" affordance.

## Solution

Inline, muted, looping video preview rendered INSIDE the tile, replacing the poster after the
first frame is ready. One shared primitive used by both tiles.

### Scope

- **DraftTile (My Drafts):** preview only when `project.final_video_id` exists (Ready/Done
  drafts — same condition that gates the existing preview modal, `DraftTile.jsx:705`). Drafts
  with no rendered video get NO preview (nothing exists to play; do not invent a source-clip
  fallback).
- **ReelTile (My Reels):** always (published = rendered by definition).
- Video source: `${API_BASE}/api/downloads/{id}/stream` — the SAME endpoint both existing
  players already use (`DraftTile.jsx:727`; story player `streamUrl`). No new backend work
  expected; verify the endpoint serves Range requests sanely for short-lived connections.

### Activation model (the design decisions)

| Input | Gesture | Notes |
|-------|---------|-------|
| Fine pointer | Hover with intent delay (~400ms) | Instant-on feels twitchy while mousing across the grid; delay also avoids firing an R2 stream per tile crossed. Gate on `useIsCoarsePointer()` (T5910/T6300 standard), NEVER width or UA. |
| Coarse pointer | Long-press | **CONFLICT: long-press already reveals the tile actions** on both tiles (`DraftTile.jsx:303-305`; ReelTile post-T6300). Recommended resolution: long-press does BOTH — reveal actions AND start the muted preview beneath them (one gesture, no new gesture to learn, no regression to T5910/T6300). Confirm at Stage 1 what T6300's shipped treatment left long-press doing (commit 57e07b89) before locking this in. |

- **Deactivation:** pointer leave / touch elsewhere / tile leaves viewport
  (IntersectionObserver) / component unmount / the full player opening. Teardown = pause,
  clear `src`, call `load()` — actually release the connection, don't just pause.
- **Single active preview** at any moment. A mouse guarantees this; touch does not. Keep it
  structural: a tiny module-level "current preview" registry (or parent-owned id) so
  activating tile B force-stops tile A.
- **`prefers-reduced-motion: reduce`** disables hover-autoplay entirely (poster stays).

### Playback + rendering details

- `<video muted playsInline loop preload="none">` — muted is mandatory for autoplay policy;
  loop because previews are glances, not viewings.
- **Poster-first reveal:** keep the poster visible until the video actually renders a frame
  (`playing` event or `requestVideoFrameCallback`), then crossfade video over poster. Never
  show a black box while the stream warms up. On teardown, poster fades back. No spinner —
  the poster IS the fallback state.
- **Position `absolute` inside the tile, `object-cover`, same rounded clip as the poster.**
  Do NOT portal: the tile's hover `transform`/`filter` containing-block trap (documented at
  `DraftTile.jsx:695`, T5900) only bites `position: fixed` descendants; an absolute child is
  safe and portaling would detach the video from the tile's hover-scale.
- Layering: preview sits above poster, below the action buttons / badges / kebab. Action
  hover-reveal (fine pointer) continues to work over the playing video — buttons keep
  `pointer-events`; the video element itself gets `pointer-events-none`.
- Do not disturb: poster load lifecycle (`posterState` loading/shimmer/error — preview is
  allowed even when the poster 404'd to the branded fallback), unwatched styling, selection
  border, the kebab's `createPortal` positioning, T6180's primary action.

### What this must NOT do

- **No persistence, no side effects.** Preview is ephemeral UI state only. It must NOT mark
  the reel watched (watched-marking stays exclusively in the real player's `onReelChange`
  path, `DownloadsPanel.jsx:95`), must not fire achievements, must not write anything.
- **No preloading across the grid.** `preload="none"` until activated; a 25-tile grid must
  fire zero video requests at rest (T6290's lesson: the poster batch already competes with
  boot — don't add a video batch).
- No audio, ever, in the tile.

### Shared primitive

One `TilePreviewVideo` (component + small hook for the gesture/teardown/registry logic),
consumed by both `DraftTile` and `ReelTile`. Two consumers is normally below the
abstract-on-3rd-dup bar, but this is behavior that MUST stay identical across the sibling
tiles (T6300's history shows what divergence costs) — same justification as T6320's shared
progress-track primitive. Props: `streamUrl`, `active`, `onFirstFrame?`; the tile owns when
`active` flips.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx` — poster block `:420-440`, touch/long-press
  handlers `:303-305`, hover transform note `:695`, preview modal gate `:705`, stream URL `:727`
- `src/frontend/src/components/collections/ReelTile.jsx` — poster block `:157-171`,
  long-press/reveal wiring, kebab portal (do not regress)
- `src/frontend/src/components/collections/TilePreviewVideo.jsx` — NEW shared primitive
- `src/frontend/src/hooks/useIsMobile.js` — `useIsCoarsePointer()` (the gate; T5910/T6300)
- `src/frontend/src/components/DownloadsPanel.jsx` — passes tile props; watched-marking path
  to stay untouched `:95-100`
- Reference only: `src/frontend/src/components/MediaPlayer.jsx`,
  `src/frontend/src/components/collections/CollectionPlayer.jsx` (existing stream consumers)

### Related Tasks
- **T5910 / T6300** — hover-vs-long-press capability gating on these exact tiles; this task
  must compose with their shipped treatments, not fight them
- **T6180** — ready-draft primary action; preview must not shadow it
- **T5900** — the containing-block/portal lesson for video inside these tiles
- **T5672 / T5673** — the poster-tile architecture (tile contracts in
  `.claude/knowledge/annotate.md`)
- **T6320** — precedent for a shared tile primitive
- **T6290** — why nothing preloads at rest

### Technical Notes
- Knowledge doc: `.claude/knowledge/annotate.md` (tile contracts); check
  `.claude/knowledge/export-pipeline.md` for the downloads/stream contract.
- React StrictMode double-invokes effects in dev — the activate/teardown pair must be
  idempotent (T6250's odd-vs-even counting applies if verifying request counts in dev).
- Long-press must cancel on `touchmove` (scroll) — the existing reveal handlers already do
  this; the preview trigger inherits it by riding the same gesture.
- Suggested tier: **M** (2 tiles + 1 new primitive + hook, frontend-only, no schema). Include
  the Reviewer; UI Designer optional — interaction is specified here, but if the crossfade
  treatment needs visual judgment, get it approved before implementing.

## Implementation

### Steps
1. [ ] Stage 1: confirm T6300's shipped long-press/persistent-affordance behavior on ReelTile
       (commit 57e07b89) and lock the touch-gesture resolution
2. [ ] Build `TilePreviewVideo` + activation hook (intent delay, registry, teardown,
       reduced-motion, IntersectionObserver)
3. [ ] Wire into DraftTile (gated on `final_video_id`) and ReelTile
4. [ ] Unit tests (gesture gating fine/coarse, teardown releases src, single-active registry,
       no watched-marking call)
5. [ ] Real-browser verification (see below) at desktop + coarse-pointer emulation + narrow
       desktop width (~478px, T5910's repro condition)

## Acceptance Criteria

- [ ] Fine pointer: hovering a Ready/Done draft tile or a reel tile plays a muted looping
      inline preview after ~400ms; leaving restores the poster and RELEASES the stream
      (verify in the network tab — no lingering connections)
- [ ] Coarse pointer: long-press starts the preview without breaking the T5910/T6300 action
      reveal or scrolling; touch elsewhere stops it
- [ ] Poster stays visible until the first video frame; no black flash, no spinner
- [ ] Drafts without a rendered video show no preview and no errors
- [ ] At most one tile previews at a time
- [ ] Zero video requests fired by a grid at rest (network tab evidence)
- [ ] Preview never marks a reel watched and performs no writes
- [ ] Action buttons, kebab (portal positioning), badges, selection, unwatched styling, and
      the full-player paths all unaffected
- [ ] `prefers-reduced-motion` disables hover autoplay
- [ ] Real-browser evidence (jsdom is insufficient for pointer/hover work — T5380 lesson):
      desktop wide + ~478px narrow + coarse-pointer emulation, screen recording or
      screenshots of poster→video→poster cycle
- [ ] Frontend unit tests pass
