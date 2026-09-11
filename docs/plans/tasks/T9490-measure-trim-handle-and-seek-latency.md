# T9490: Measure trim-handle and seek latency against the prior build

**Status:** STAGING
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

## Progress Log

### 2026-09-11 - Measured (real Chromium), symptom reproduced, fix applied

**Method.** Real-browser Playwright + Chromium harness (NOT jsdom, per T5380). A 90s /
1080p / ~6 Mbps / 10s-GOP file (generated with ffmpeg; heavier than Andrew's 45.8 MB /
1:29 file, so an upper bound), served locally, throttled to 8 Mbps / 40 ms RTT for the
COLD case and fully buffered for WARM. A 70-move end-handle trim drag over ~1.6 s. The
two mechanisms were measured SEPARATELY. Harness + full numbers archived in
`docs/plans/tasks/T9490-perf-harness/`.

**Pointer-to-handle (render latency): NOT the problem.** p95 0.2-0.6 ms in every mode /
cache combination -- far inside any feel-good budget. The green handle tracks the pointer
immediately.

**Pointer-to-preview (seek latency): the real issue, reproduced.** The current code calls
`onSeek` on every pointermove (`ClipScrubRegion.handlePointerMove` -> `videoController.seek`
-> `video.currentTime = t`, `AnnotateContainer.jsx:322`). The browser collapses the 71
rapid `currentTime` writes into a SINGLE completed seek, so the seeked frame does not paint
for ~1177 ms cold / ~1240 ms warm on average (p95 ~2.2 s, max ~2.4 s) -- the preview
effectively freezes for the whole drag and only catches up at release. This is exactly the
"delay before the video updates" report. It reproduces even WARM (fully buffered), so it is
decode-bound, not just a network/cold-cache effect.

**Regression vs candidate.** This is NOT a code regression against a prior build of this
component -- per-move seeking has existed since T650 (the ClipScrubRegion that replaced the
old duration slider); T690 only made it optional for the sidebar. "Less smooth than before"
most likely compares against that pre-T650 duration slider, which never live-seeked at all.
But the absolute preview lag (1.2-2.4 s) is clearly outside a reasonable budget, so per the
kickoff's step 3 ("or clearly outside a reasonable feel-good budget") the fix path applies.

**Fix (applied).** Coalesced drag-seek in `ClipScrubRegion.jsx`: the handle still renders
every pointermove (immediate feedback, unchanged), but the SEEK is coalesced to at most one
in flight -- a RAF pump issues only the newest target, and only once the previous seek has
completed (`el.seeking === false`); pointerup settles exactly on the released handle
position (preserving the T8960 clamp: playhead lands inside the green span). In the harness
this turns the single frozen settle into a smooth step-through (each buffered seek completes
in single-digit ms). CI guard: `ClipScrubRegion coalesced drag-seek (T9490)` (jsdom asserts
the coalescing LOGIC deterministically; felt latency is measured only in the real browser).

**Still needed for a like-for-like confirmation of Andrew's exact experience.** His browser /
OS / device, the in-app (Codex) browser build, and a screen recording -- none were supplied.
The harness confirms the mechanism and the fix on an upper-bound synthetic file; it does not
prove his device hit the same numbers.

**Tests.** `ClipScrubRegion.test.jsx` 18/18 green (incl. the new T9490 guard). Curated
relevant set via `vitest related` on the changed file: 31 files / 218 tests green.
