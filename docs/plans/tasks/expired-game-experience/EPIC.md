# Epic: Expired Game Experience

**Status:** IN_PROGRESS
**Started:** 2026-05-03
**Completed:** —

## Goal

Rich viewing experience for expired games. Instead of a plain video player with a concatenated recap, expired games open in a read-only playback mode with annotations, clip navigation, and the option to watch just the highlights. Brilliant clip exports are always accessible via My Reels.

## Why

The current RecapPlayerModal is a bare HTML5 `<video>` tag playing a single concatenated recap. It doesn't show clip names, ratings, timestamps, or let users navigate between clips. Users annotated their game carefully — the expired experience should honor that effort and look like the playback mode they're already familiar with.

Additionally, the brilliant clip exports (5-star auto-exports) should be discoverable through the normal My Reels filters, not hidden.

## Tasks

| # | ID | Task | Status | Description |
|---|---|---|---|---|
| 1 | T2410 | [Playback-Mode Recap Viewer](T2410-playback-mode-recap-viewer.md) | TODO | Replace RecapPlayerModal with read-only playback mode showing annotations |
| 2 | T2420 | [Annotations + Highlights Tabs](T2420-annotations-highlights-tabs.md) | TODO | Two video modes: all clips with annotations, or just 5-star highlights |
| 3 | T2430 | [Brilliant Clips in My Reels](T2430-brilliant-clips-in-my-reels.md) | TODO | Ensure auto-exported 5-star clips are filterable and always accessible in My Reels |

## Dependencies

- **T1583** (Auto-Export Pipeline) must be complete — provides the recap video, brilliant clip exports, and `final_videos` rows
- **T2400** (Grace Period) is related but independent — it extends the window for storage extension, this epic improves the viewing experience

## Completion Criteria

- [ ] Expired game card click opens a playback-mode viewer (not a plain video player)
- [ ] Annotations (clip names, ratings, timestamps) visible during playback
- [ ] User can switch between "Annotations" (all clips) and "Highlights" (5-star only) views
- [ ] Brilliant clip exports appear in My Reels and are filterable by source type
- [ ] All tasks complete and tested
