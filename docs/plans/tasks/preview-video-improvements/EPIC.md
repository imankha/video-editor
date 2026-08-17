# Preview Video Improvements

**Status:** TODO
**Started:** —

## Goal

Continues the "tiles come alive" work: draft/reel tiles play their video inline — muted,
looping, in place — instead of a static poster. This epic **absorbs and supersedes** the
former [Tile Video Preview epic](../tile-video-preview/EPIC.md) (design settled 2026-08-03):
its desktop-hover primitive (T6420) and drafts-in-overlay fallback (T6441) already shipped and
are the foundation this epic builds on; its autoplay-setting child (T6440) carries forward into
this epic unchanged; its touch design (T6430, in-viewport scroll autoplay) is **replaced** by a
tap-to-select model per user direction 2026-08-17. One epic, not two — see "Merge note" below.

## Why now / trigger

User feedback 2026-08-17, two concrete asks:
1. The hover-preview's reveal has a perceptible delay before playback starts — remove it.
2. On mobile, the first tap that selects a reel tile should start the inline preview
   immediately, rather than requiring a separate reveal gesture or waiting for the in-viewport
   scroll-settle T6430 planned but never built.

## Design authority: what carries forward vs. what changes

Baseline is [Tile Video Preview EPIC.md](../tile-video-preview/EPIC.md)'s design-authority
table (YouTube/Netflix prior art, 2026-08-03). Changes made by this epic:

| Decision | Old (2026-08-03) | New (this epic, 2026-08-17) | Why |
|----------|-------------------|------------------------------|-----|
| Touch trigger | In-viewport autoplay while scrolling (YouTube/Netflix/Instagram precedent); explicitly rejected tap as a "hidden gesture" | Tap-to-select plays the preview immediately — the first tap that selects a tile IS the trigger, no separate reveal step | User direction 2026-08-17: a direct, visible tap beats an ambient scroll-triggered effect. Full redesign scope + open questions live in [T7160](T7160-mobile-tap-select-plays-preview.md) — touch behavior on both tile types today does not actually match the requested scheme yet, so this is new design, not a wire-up. |
| Desktop reveal delay | Deliberate ~450ms floor (`PREVIEW_REVEAL_DELAY_MS`) — "mousing across a grid must not strobe" | Floor removed — reveal fires as soon as content is ready (same content-ready race T6820 built, floor = 0) | User direction 2026-08-17: any perceptible delay before the preview plays reads as sluggish. Flicker risk from a fast hover-pass is re-verified in real-browser testing, not assumed away — see [T7170](T7170-remove-preview-reveal-delay.md). |
| Everything else | — | Unchanged | Muted/looping/no-unmute, single-active registry, poster-first reveal, teardown-releases-stream, `prefers-reduced-motion` off-switch, in-place (no Netflix-style expansion) all carry forward as-is |

## Merge note (2026-08-17)

This epic occupies the PLAN.md slot the single task T7020 used to hold — T7020 itself
(unrelated: game video faststart remux) was renumbered to
[T7140](../T7140-game-video-faststart-remux.md), which frees nothing about ITS scope, just the
ID. Separately, and at the same time, the standalone Tile Video Preview epic is merged into
this one so the project doesn't carry two epics for the same feature surface:

- **T6420** (preview primitive + desktop hover) — DONE, shipped 2026-08-13. Foundation; see
  [PLAN-archive.md](../../PLAN-archive.md).
- **T6441** (hover preview extended to "In Overlay" drafts) — DONE, shipped 2026-08-13. Archived.
- **T6820** (hover preview for Not Started drafts + generalized the reveal-delay race) — DONE,
  shipped 2026-08-16. Archived. [T7170](T7170-remove-preview-reveal-delay.md) reuses its
  content-ready race, just zeroes the floor.
- **T6430** (touch: in-viewport autoplay) — TODO, never implemented. **SUPERSEDED** by
  [T7160](T7160-mobile-tap-select-plays-preview.md); file kept in place
  (`../tile-video-preview/T6430-touch-in-viewport-autoplay.md`) marked superseded, not deleted,
  since it documents real rejected-alternative rationale.
  T7160 depends on T6420, not T6430.
- **T6440** (autoplay-previews setting + data-saver) — TODO, not superseded. Moved into this
  epic folder unchanged in scope; its touch dependency now points at T7160 instead of T6430.

## Tasks

Order = dependency: delay removal touches the shared primitive first (both tile types,
desktop-visible immediately); mobile tap-to-play builds the new touch trigger on top of it; the
setting/data-saver child gates both.

| ID | Task | Status |
|----|------|--------|
| T7170 | [Remove preview reveal delay](T7170-remove-preview-reveal-delay.md) | TODO |
| T7160 | [Mobile: tap-to-select plays preview](T7160-mobile-tap-select-plays-preview.md) | TODO |
| T6440 | [Autoplay-previews setting + data-saver](T6440-autoplay-setting-data-saver.md) | TODO |

## Shared invariants (bind every child — inherited from Tile Video Preview, unchanged except
where the design-authority table above says otherwise)

- Source: `/api/downloads/{id}/stream` (final video) primary; `/api/projects/{id}/working_video/
  stream` fallback (T6441); source-clip window fallback for Not-Started drafts (T6820). No
  further fallback.
- `<video muted playsInline loop>` — audio never.
- **At most ONE active preview** app-wide (shared registry); activating B force-stops A.
- Teardown RELEASES the stream (pause, clear `src`, `load()`) — deselect, scroll-out, unmount,
  full player opening. Never a lingering connection.
- Grid/list at rest fires ZERO video requests (`preload="none"` until warmed) — T6290's lesson.
  T7170 keeps the 100ms WARM dwell specifically to preserve this.
- Ephemeral only: no writes, no watched-marking, no achievements from the preview itself.
- `prefers-reduced-motion: reduce` disables preview playback (both trigger types).
- Absolute-positioned inside the tile, never portaled (T5900 containing-block trap).
- Real-browser evidence required for every child (jsdom false confidence — T5380).

## Completion Criteria

- [ ] Desktop hover reveals with no artificial delay beyond real content-load time
- [ ] Mobile: the tap that selects a tile also starts its inline preview, no separate reveal step
- [ ] Setting + data-saver guardrails live, gating both trigger types
- [ ] No regression to tile actions (T5910/T6300), kebab portal, badges, existing open/selection
      behavior
- [ ] Knowledge doc (`annotate.md` tile contracts) updated
