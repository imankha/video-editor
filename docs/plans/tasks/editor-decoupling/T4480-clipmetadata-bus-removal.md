# T4480: One loader for Spotlight data

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

The Spotlight editor loads its saved data through two near-identical 70 line blocks, one used right after a fresh render and one on a plain open. Every new Spotlight setting has had to be added to both, 17 fields so far, and a setting added to only one would silently go missing in the other case. Keep one loader that both use. Runs after T16480 and T11260, which edit the same blocks.

## Implementer details

- Both loaders are in `src/frontend/src/screens/OverlayScreen.jsx`. The real differences are three lines: `resetHighlightRegions()` first, duration from `data.video_duration`, and no wait for video metadata.
- Extract one `applyOverlayData(data, duration)` called by both triggers, about 70 lines removed.
- Replace the `clipMetadata` store field (now written only by the export gesture in `FocusScreen.jsx`, and acknowledged by `setOverlayClipMetadata(null)` in an effect) with a one-shot 'fresh export' marker.
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`.

## Acceptance Criteria

- [ ] One function applies loaded Spotlight data; both the fresh-render and the plain-open case call it.
- [ ] A test loads the same saved data both ways and gets the same editor state.
