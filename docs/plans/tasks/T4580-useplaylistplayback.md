# T4580: usePlaylistPlayback — One Playlist Engine (Recap / Highlights / Story)

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit item C6 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY] Sequential-playback ("virtual timeline over segments") is implemented three times: `components/recap/useRecapPlayback.js` (160 L) and `components/recap/useHighlightsPlayback.js` (196 L) return the SAME 15-key interface (`isPlaying, virtualTime, totalVirtualDuration, segments, activeClipId, activeClipName, currentSegment, playbackRate, seekToClip, togglePlay, restart, seekVirtual, seekWithinSegment, startScrub, endScrub, changePlaybackRate`) with line-identical `togglePlay`, scrub handlers, rAF tick, and play/pause listener wiring — differing only in segment sourcing (one video with virtual segments vs per-clip stream switching). `components/collections/useStoryPlayback.js` (111 L) repeats the rAF/togglePlay core a third time.

## Solution

`hooks/usePlaylistPlayback(videoRef, segments, { advanceStrategy })`:

- Core: rAF virtual-time tick, play/pause/restart, scrub start/end, rate, virtual↔segment seek math.
- `advanceStrategy` is the ONLY seam: `'virtual'` (same video, jump within it — recap) vs `'perClip'` (swap src on segment end — highlights/story). Encode the two existing behaviors; don't generalize further.
- The three hooks become thin adapters (segment building + strategy choice) or are deleted where the adapter is trivial.

## Context

- Consumers: `RecapPlayerModal`, highlights player, story/collections player — find each hook's mount sites first and E2E/manual-test those surfaces.
- Known care points (from the audit): `ended`-event advancement and pendingSeek-on-clip-switch — write these as explicit tests before migrating (they're where per-clip switching gets racy).
- Playback is user-perceptible: manual verification on dev (recap watch-through with scrubbing + rate change; story auto-advance; highlights clip transitions) is part of acceptance, not optional.

## Steps

1. [ ] Interface + behavior diff-table of the three hooks (Progress Log).
2. [ ] Core hook + unit tests (rAF tick with fake timers; both strategies; ended-advance; pendingSeek).
3. [ ] Migrate one consumer per commit: recap → highlights → story.
4. [ ] Manual playback pass on all three surfaces.

## Acceptance Criteria

- [ ] One playback core; three consumers via adapters or direct use
- [ ] ended-advance + pendingSeek covered by tests
- [ ] All three surfaces manually verified (scrub, rate, auto-advance)
- [ ] ~250+ duplicate lines removed
