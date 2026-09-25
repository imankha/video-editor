# T11300: Reels v2 - stitch published highlights into a college highlight reel

**Status:** ICE (not in the next version, user 2026-09-24)
**Impact:** 8
**Complexity:** 8
**Created:** 2026-09-24
**Updated:** 2026-09-24

## Problem

Parents want one assembled college / recruiting reel. The old Reels feature assembled RAW clips
into a multi-clip EDITABLE project, which forced Framing and Spotlight to handle multiple clips.
It is being removed (epic [single-clip-editor](single-clip-editor/EPIC.md)).

## Solution (vision, user's words 2026-09-24)

"Reels" comes AFTER Published: a place to stitch PUBLISHED clips together, control transitions,
add interstitial text frames, and make a college highlight reel. Framing and Spotlight stay
single-clip forever.

## Context

Reuse, don't rebuild (audit 2026-09-24): collections already provide ordered play-as-one
(`CollectionPlayer` / `IntroStoryPlayer` composite scrubber), stitched download (T4945 Modal
`stitch_members`, `ffmpeg_concat.py`, T4947 cache), intro cards + branded outro
(`serve_time_video.compose_serve_time_dispatched`), collection share links and Glicko rank
ordering. Transitions and interstitial text frames would extend `card_compose_plan` / compose.
Note: Modal never rendered dissolve/fade in the old pipeline; real transitions are new work.

Needs a design gate (Architect + ui-designer) when thawed.

## Acceptance Criteria

- [ ] To be written at design time
