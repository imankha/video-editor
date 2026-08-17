# Tile Video Preview (My Drafts + My Reels)

**Status:** MERGED 2026-08-17 into [Preview Video Improvements](../preview-video-improvements/EPIC.md)
**Started:** —

**This epic is merged, not standalone anymore.** T6420/T6441 shipped (DONE, archived) and
remain the foundation. T6440 (autoplay setting) moved unchanged into the new epic folder.
T6430 (touch: in-viewport autoplay) is SUPERSEDED by the new epic's T7160 (tap-to-select) —
see that file for why. Kept here for history; new work happens in
[preview-video-improvements/](../preview-video-improvements/EPIC.md).

## Goal

Tiles come alive: glancing at a draft or reel tile plays its video inline — muted, looping,
in place — instead of a static poster. Desktop = hover; touch = in-viewport autoplay while
scrolling. Motion + professionalism is a core product value; the celebration surfaces should
feel like video, not a photo album.

## Design authority: prior art (user-directed 2026-08-03)

Design questions resolve against YouTube and Netflix, deliberately:

| Decision | Adopt | Reject | Why |
|----------|-------|--------|-----|
| In-place preview at tile size | YouTube | Netflix's 1.5x expansion card | Expansion would fight our kebab portal, hover-scale transform, and action overlay for large build cost |
| Muted, always, no unmute | YouTube (muted) | Netflix (sound-on) | Netflix's sound-on previews are their most-complained-about behavior; they had to add a global off switch |
| Intent delay before reveal (~450ms) | Both (~0.5–1s) | instant-on | Mousing across a grid must not strobe |
| **Warm early, reveal late** | YouTube | fetch-at-reveal | Users hate waiting: attach `src` + buffer at ~100ms hover (grace beats transient crossings), `.play()` + crossfade at ~450ms — the stream gets a ~350ms head start so the reveal is typically instant (R2 TTFB ~266ms, T3760) |
| Touch = in-viewport autoplay of the single most-visible tile | YouTube/Netflix/Instagram | long-press | NEITHER product uses long-press; hidden gestures are the exact discoverability failure T6300 documented on these tiles. Also leaves the existing long-press = reveal-actions gesture (T5910/T6300) completely untouched |
| Global "autoplay previews" off switch | Netflix (added under user pressure) | — | Child 3; a real preference, persisted gesture-based |

Poster-first reveal everywhere: the poster stays until the video renders a real frame — no
black flash, no spinner. The poster IS the loading state.

## Placement note

Deliberately AFTER the T5140 tutorial reshoot (user decision 2026-08-03): a preview that is
merely absent from recordings contradicts nothing on screen — users discover it naturally.
The milestone's touch-up rule covers it if a quest ever needs to showcase it.

## Tasks

Order = dependency: the primitive ships with desktop hover first; touch rides the same
primitive; the setting gates both.

| ID | Task | Status |
|----|------|--------|
| T6420 | [Preview primitive + desktop hover](T6420-preview-primitive-desktop-hover.md) | DONE |
| T6430 | [Touch: in-viewport autoplay](T6430-touch-in-viewport-autoplay.md) | SUPERSEDED by [T7160](../preview-video-improvements/T7160-mobile-tap-select-plays-preview.md) |
| T6440 | [Autoplay-previews setting + data-saver](../preview-video-improvements/T6440-autoplay-setting-data-saver.md) | MOVED to [Preview Video Improvements](../preview-video-improvements/EPIC.md) |
| T6441 | [Extend hover preview to "In Overlay" drafts](T6441-hover-preview-in-overlay-drafts.md) | DONE |

## Shared invariants (bind every child)

- Source: `/api/downloads/{id}/stream` (final video) is the primary source, same endpoint both
  current players already use. **T6441 adds a fallback** to `/api/projects/{id}/working_video/
  stream` for drafts that have a working video but no final video yet (same proxy shape/
  rationale). Still no source-clip fallback for a draft with neither (Not Started/Framing) —
  explicitly rejected 2026-08-10, not obviously useful.
- `<video muted playsInline loop>` — audio never.
- **At most ONE active preview** app-wide (shared registry); activating B force-stops A.
- Teardown RELEASES the stream (pause, clear `src`, `load()`) — leave, scroll-out
  (IntersectionObserver), unmount, full player opening. Never a lingering connection.
- Grid at rest fires ZERO video requests (`preload="none"` until warmed) — T6290's lesson.
- Ephemeral only: no writes, no watched-marking (that stays in the real player's
  `onReelChange`, `DownloadsPanel.jsx:95`), no achievements.
- `prefers-reduced-motion: reduce` disables autoplay previews.
- Absolute-positioned inside the tile, never portaled (T5900 containing-block trap is
  `fixed`-only; portaling would detach the video from the hover scale).
- Real-browser evidence required for every child (jsdom false confidence — T5380).

## Completion Criteria

- [ ] Desktop hover previews on both tile types, warm-early/reveal-late, poster-first
- [ ] Touch in-viewport autoplay, single most-visible tile, scroll-settle gated
- [ ] Setting + data-saver guardrails live
- [ ] No regression to tile actions (T5910/T6300), kebab portal, badges, selection,
      unwatched styling, full-player paths
- [ ] Knowledge doc (`annotate.md` tile contracts) updated
