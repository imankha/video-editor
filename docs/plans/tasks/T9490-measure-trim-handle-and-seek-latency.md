# T9490: Measure trim-handle and seek latency against the prior build

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B10, UX-06 (handoff E4-03)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Andrew reports that dragging timeline handles in the new build shows a delay before the video
updates, and feels less smooth than before. **No timings, recording, browser version or reproduction
were supplied, and no screenshot can establish motion latency.** This is a regression *candidate*,
not a confirmed regression.

## Solution

Investigation first, fix only if a regression is confirmed.

1. Compare the same file, device and browser on the current build and a prior build where available.
2. **Measure pointer-to-handle and pointer-to-preview separately** - handle rendering and video
   decode/seek are different problems with different fixes, and conflating them is how this kind of
   report goes unresolved.
3. Test long files, warm and cold caches.
4. Propose a measured response target, then fix any confirmed regression: keep handle feedback
   immediate, coalesce seeks during drag, settle accurately on release.
5. **If not reproducible, close with the tested conditions recorded** and say what evidence would be
   needed. Do not silently drop it, and do not attribute it to staging without diagnosis.

## Context

### Relevant Files
- `src/frontend/src/components/timeline/TimelineBase.jsx`
- `src/modes/annotate/components/ClipScrubRegion.jsx`
- `src/frontend/src/hooks/useVideo.js` - seek handling

### Related Tasks
- T9480 - exact entry gives an alternative to fighting the handle, independent of latency

### Technical Notes
Real-browser measurement only. Recorded project experience: jsdom gives false confidence on pointer
behavior (T5380). Use Playwright against a real browser.

## Acceptance Criteria

- [ ] Reproducible measurements exist with media, device, browser and build recorded
- [ ] Pointer-to-handle and pointer-to-preview are measured separately
- [ ] If a regression is confirmed: before/after numbers and an agreed response target
- [ ] If not reproducible: the report is retained with tested conditions and the evidence still needed
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
