# T13280 Design: one control for the videos of a multi-video game in Annotate

**Status:** APPROVED, Option C picked by the user 2026-10-22; implemented on feature/T13270-T13280-footage-added-annotate-shows
**Author:** UI Designer agent, 2026-10-21
**Branch examined:** `feature/T13270-T13280-footage-added-annotate-shows` at `C:\work\tasks\g-t13270-2`
**Mocks:** `docs/plans/tasks/T13280-mocks.html` (static, 390 and 1440, sequential and overlap cases)

## The problem in one line

A game with two videos gives the user no at-rest answer to "which video am I watching, what else is there, and how do I get to it", because every existing cue is positioned proportionally on the time axis (and so vanishes when one video is 19s and the other 85 minutes) or appears only while the playhead happens to sit inside an overlap.

User words (2026-10-22): "now i dont see any indicator that there is a different source for footage" and "nothing should be hard to see... switching should be intuitive on conflicted regions and easy across all screen sizes."

## Hard requirements (user signal, 2026-10-22, via the orchestrator)

The user tapped the T13280 chip for video 2 in their real game and said "nothing happens, it doesn't let me switch to it". Their mental model: tapping a video marker SWITCHES to that video and the player visibly confirms it.

Why it read as nothing: the chip's handler is `onSeek(seg.virtualStart)` (`AnnotateTimeline.jsx:303`). With the playhead already inside the 85-minute video 2, tapping video 2's chip seeks back to 0:19 of the same footage; no readout exists, the chip has no selected state, and the picture is the same camera a few seconds earlier. A bare seek with no readout change IS "nothing happened".

**Measured repro (orchestrator, account `empty-f1@test.local`, game 1):** video 1 = 18.84s, video 2 = 5116.9s appended at 18.84s, both 1024x1024 (square). At 1280 wide the chips render at x=541 (w=96) and x=543 (w=92); chip 2 completely covers chip 1 and `elementFromPoint` returns `video-label-2` at every point of chip 1, so video 1 is unreachable. At 390 the same (x=101 vs x=104). Tapping chip 2 inside video 2 seeks to 0:18 with no readout change; tapping again at 0:18 changes nothing. Square footage means the player is letterboxed with wide black bars at 1440, so an over-video readout anchored to the stage corner sits on black, far from the picture.

Every option below must therefore satisfy:

- **(a) Always-legible active source.** For a game with 2+ videos, something in or directly next to the player names the video being shown at ALL times, not only inside an overlap and not only on the time axis. It must not depend on 16:9 chrome: with square footage the stage is letterboxed at 1440 and nearly square on phone, so the readout's home must be a fixed surface (the controls area), or, if it is over the stage, it must be understood that it lands on the letterbox bar.
- **(b) Immediate visible feedback on tap.** The readout changes to the tapped video's name, the tapped marker takes the selected state (`aria-pressed`), and on an overlap the picture changes in place. The feedback must not depend on where the playhead was, and it must happen even when the tapped video is already the active one (pulse + readout; the active control is visibly checked at rest so the user is never guessing).
- **(c) Reachability regardless of duration share.** Video 1 = 19 seconds, video 2 = 85 minutes. Every video must be reachable with one tap at 390 and 1440, so the switcher cannot be purely time-proportional. A timeline-only marker for video 1 is a few pixels wide at every width and zoom and is no longer acceptable as the only affordance; the mocks use these exact numbers.

### Tap feedback contract (all options)

| Moment | What the user sees | Mechanism |
|---|---|---|
| Tap a video that is NOT the active one | Selected state moves to it (`aria-pressed`), readout reads its name, playhead jumps to its start (sequential) or picture switches in place (overlap), a 1.5s notice "Now watching {name}" | existing `fallbackLabel` state generalized to `sourceNotice` (string, 1.5s timer, same code path as "Back to main camera") |
| Tap the video that IS already active | Selected state is already on it (`aria-pressed="true"`, filled); the segment/block flashes a 300ms ring (`ring-2 ring-white/70`, `transition` out), the readout still swaps to "Now watching {name}" for 1.5s, and the playhead jumps to that video's start (a useful "restart this video"). Alternative if the user prefers a no-op: keep the ring and readout but skip the seek; never a silent tap | `usePulseHighlight` (`modes/annotate/hooks/usePulseHighlight.js`), the same helper the angle bar uses on Fix timing Done |
| Auto-fallback leaves an angle | Readout flips to "Main camera", notice "Back to main camera" | unchanged `AnnotateContainer.jsx:479-493` |

"Now watching" always names the video, even when the tap was a pure seek, so the sequential case gets the same confirmation as the overlap case. The notice is a text swap inside the readout (no toast, no new surface).

## Current state (observed)

| Surface | File:line | What it does | Why it failed |
|---|---|---|---|
| Boundary line | `src/frontend/src/modes/annotate/AnnotateTimeline.jsx:312-320` | `w-px bg-gray-300/70` full-height line at each `boundaryOffsets` entry, `pointer-events-none` | 1px, no label, no affordance |
| Video chips (T13280, this week) | `AnnotateTimeline.jsx:296-310` | `absolute bottom-0` button per video at `leftCalc(virtualStart)`, `text-[10px]`, `Film` or amber `Clock` icon, tap seeks to start | Proportional placement with no collision handling: in the user's game video 1 is ~4px wide at 1440 (19s / 5119s), video 2's chip starts 4px to the right and paints over it; chips sit under the green clip marker; 10px text is below the touch floor |
| Angle strip | `src/frontend/src/modes/annotate/AngleLanes.jsx` | Violet bars per angle lane above the clip lanes; click seeks and activates; long-press / right-click opens Fix timing. Mobile: one merged `h-3.5` strip with 9px icons | Overlap games only. It is the map of "conflicted regions" and should stay, but it is not a readout |
| Over-video pill | `src/frontend/src/modes/annotate/AngleSwitcherBadge.jsx:38-48, 56` | `absolute bottom-2 right-2`, segmented `Main camera | {angle}` for 2 sources, chevron popover for 3+, returns `null` unless `sources.length >= 2` | Only exists inside an overlap. Outside it the player says nothing. Text over video, bottom-right, small |
| Fix timing | `src/frontend/src/modes/annotate/FixTimingStrip.jsx`; opener `AnnotateContainer.jsx:520-533` | Yellow mode-swap strip under the canvas; nudges one angle's offset; `openFixTiming` returns early for non-overlap games | Fine. Entry points are the hidden long-press / right-click and the 3+ popover |
| Controls row | `src/frontend/src/modes/annotate/components/AnnotateControls.jsx:138-140` | `flex flex-wrap items-center justify-between gap-y-1 px-2 lg:px-4 py-2 bg-gray-800 rounded-b-lg` | Nothing to do with sources today; it is the natural home for a persistent readout |

Data already available in `AnnotateContainer.jsx`: `videoSegments` (sequential, L370-374), `fullTimeline.sourcesAt(t)` and `sourcesAtPlayhead` (L435-441), `switchToSource(seq, t)` (L456-466), `currentVideoSequence` (L423), `openFixTiming` (L520), `fallbackLabel` (L444). Names come from `videoDisplayName` (`useVirtualTimeline.js:359`, 14-char middle ellipsis: "oct-5-2024-10-05" renders as "oct-5-2…-10-05"; the mocks show that real output).

## Issues identified in existing patterns

1. **Proportional-only labels** (`AnnotateTimeline.jsx:296-310`). Any label whose position and width come only from the time axis will disappear at extreme duration ratios. Recommendation: labels that must be found live OFF the proportional axis (a bar) or get collision-resolved minimum widths (a lane). This is the root cause of the user's report.
2. **Conditional at-rest readout** (`AngleSwitcherBadge.jsx:38`). The style guide's "discoverable, never hover-only" rule (ui-style-guide § Discoverable) is violated in spirit: the control appears only in a region the user cannot see from outside it. Recommendation: the readout exists whenever the game has 2+ videos; its switching ability is what changes with the playhead.
3. **Copy literals outside `displayNames`** (`AnnotateContainer.jsx:439, 447`; `AngleSwitcherBadge.jsx:125, 139`). `'Main camera'`, `'Back to main camera'`, `'Watching: '`, `'Fix timing: '` are inline. Recommendation: move to `ANNOTATE` keys in this task (single-source rule, T9520). Fix as part of this task (the component that owns them is being replaced).
4. **Mobile angle strip below the touch floor** (`AngleLanes.jsx:263`, `h-3.5` = 14px bars). Not fixed by any option below; the bar makes it non-essential for switching. Recommend a separate task if the user still taps the strip on phone.
5. **Task file acceptance criterion conflict.** `docs/plans/tasks/T13280-annotate-no-way-to-see-or-jump-between-videos.md` AC 4 says "Overlap games keep the angle pill and strip unchanged". Options A and C retire the pill (its job moves into the bar). The orchestrator should reword AC 4 to "Overlap games keep the angle strip and Fix timing reachable" if A or C is picked.

## Shared vocabulary and tokens (all options)

- **Blue = main footage.** The timeline's Video layer label is already `Film` in `text-blue-400` (`AnnotateTimeline.jsx:126`), and `blue-600` is the style guide's selected state. Sequential videos and the overlap backbone use `Film` + blue.
- **Violet = extra angle.** Unchanged from T8890 (`AngleLanes.jsx:39-43`, `angleClasses`). Angles use `Video` + violet.
- **Amber `Clock` = added at the end** (no usable filmed-at time), unchanged from T13270; it replaces the `Film` glyph on that video and carries `ANNOTATE.appendedFootageTitle(name)`.
- **`ArrowLeftRight` (12px) = "you can switch to this one right here".** Shown on a non-active segment or block that covers the playhead. On a sequential game it never appears, so the user learns: swap glyph = conflicted region, no glyph = jump to start.
- Surfaces: `bg-gray-800` bar, `bg-gray-700` inactive chips, `border-gray-700/60` rules. No new colors.
- Copy: never "reel"; "Main camera" is the backbone; "added at the end" for appended footage; no em dashes.

### Copy keys to add to `src/frontend/src/config/displayNames.js` `ANNOTATE`

```js
// T13280: the Videos control for a game with 2+ videos (bar and/or lane).
VIDEOS_LABEL: 'Videos',
MAIN_CAMERA: 'Main camera',                       // moves the literal out of AnnotateContainer.jsx:439
BACK_TO_MAIN_CAMERA: 'Back to main camera',       // moves AnnotateContainer.jsx:447
videoPosition: (i, n) => `Video ${i} of ${n}`,
watchingSource: (name) => `Watching ${name}`,     // at-rest readout (replaces the badge's 'Watching: ')
nowWatching: (name) => `Now watching ${name}`,    // 1.5s tap confirmation, same slot as BACK_TO_MAIN_CAMERA
jumpToVideoTitle: (name) => `Jump to the start of ${name}`,
switchHereTitle: (name) => `Switch to ${name} at this moment`,
FIX_TIMING: 'Fix timing',
fixTimingFor: (name) => `Fix timing: ${name}`,    // moves AngleSwitcherBadge.jsx:125
VIDEOS_HELP: 'The videos in this game. Tap one to watch it. Where two cover the same moment, tapping switches cameras without moving.',
PREV_VIDEO: 'Previous video',
NEXT_VIDEO: 'Next video',
```

`videoLabelAria` and `appendedFootageTitle` stay (the latter is reused by the amber glyph; the former is retired with the chips in A, reused by the lane in B/C).

### Shared data shape (container -> view), all options

```js
// null when gameVideos.length < 2 (single-video DOM untouched)
sourceBar = {
  videos: [{ sequence, name, kind: 'main' | 'angle', virtualStart, virtualEnd,
             placedAtEnd, coversPlayhead }],   // sorted by virtualStart, ties main first
  activeSequence,        // sequential: currentVideoSequence; overlap: activeSourceSequence ?? backbone at playhead
  index, count,          // "Video 2 of 2"
  notice,                // transient text: 'Now watching {name}' after a tap, 'Back to main camera' on auto-fallback (generalized fallbackLabel, 1.5s)
  pulseSequence, pulseNonce,   // 300ms ring on the tapped marker (usePulseHighlight)
  onPick(sequence),      // coversPlayhead && overlap -> switchToSource(seq, t); else seek(virtualStart) (+ switchToSource for an angle); ALWAYS sets notice + pulse
  onFixTiming,           // openFixTiming, overlap games only, else undefined
}
```

Every action is a seek or a source switch through the existing `effectiveSeek` / `switchToSource`. Nothing persists. Sequential videos come from `videoSegments` (already derived); overlap videos from `fullTimeline.domain` (`type:'video'`) plus `fullTimeline.angles`; `coversPlayhead` from `fullTimeline.sourcesAt(t)` (overlap) or `activeSequence === sequence` (sequential).

---

## Option A (recommended): a persistent Videos bar under the player controls

**Where it lives.** A new `modes/annotate/SourceBar.jsx`, rendered as the sibling directly after `<AnnotateControls>` in `AnnotateModeView.jsx` (both the `!mobileFs` block at L958 and the mobile fullscreen transport at L1117), only when `sourceBar != null`. It shares the controls' surface: `bg-gray-800 border-t border-gray-700/60 rounded-b-lg px-2 lg:px-4`; `AnnotateControls` gains `flushBottom` (drops `rounded-b-lg`), default false so single-video output is byte-identical. Desktop fullscreen uses the controls' compact style (`py-0.5 bg-gray-900/90`).

**What it shows at rest (2 or 3 videos).**

```jsx
<div data-testid="source-bar" role="group" aria-label={ANNOTATE.VIDEOS_HELP}
     className="flex items-center gap-2 px-2 lg:px-4 py-1 min-h-[40px] coarse-pointer:min-h-[52px] bg-gray-800 border-t border-gray-700/60 rounded-b-lg">
  <Film size={14} className="shrink-0 text-blue-400" aria-hidden />
  <span className="hidden sm:inline text-xs font-medium text-gray-400 whitespace-nowrap">
    {fallbackLabel ?? ANNOTATE.videoPosition(index, count)}
  </span>
  <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0,1fr))` }}>
    {videos.map(v => <Segment key={v.sequence} ... />)}
  </div>
  {onFixTiming && active.kind === 'angle' && (
    <button type="button" data-testid="source-bar-fix-timing"
            aria-label={ANNOTATE.fixTimingFor(active.name)} title={ANNOTATE.fixTimingFor(active.name)}
            className="p-2 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] rounded text-yellow-300 hover:bg-gray-700">
      <Clock size={16} />
    </button>
  )}
</div>
```

Segment (one per video, the whole game, not only the sources at the playhead):

```jsx
<button type="button" data-testid={`source-seg-${v.sequence}`} aria-pressed={isActive}
        title={v.coversPlayhead && !isActive ? ANNOTATE.switchHereTitle(v.name) : ANNOTATE.jumpToVideoTitle(v.name)}
        onClick={() => onPick(v.sequence)}
        className={`flex items-center justify-center gap-1 px-2 min-h-[32px] coarse-pointer:min-h-[44px] rounded text-xs font-medium truncate transition-colors
          ${v.kind === 'angle'
            ? (isActive ? 'bg-violet-600 text-white ring-1 ring-inset ring-violet-300' : 'bg-gray-700 border border-violet-500/40 text-violet-200 hover:bg-gray-600')
            : (isActive ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-300'   : 'bg-gray-700 border border-blue-500/30 text-blue-100 hover:bg-gray-600')}`}>
  {v.placedAtEnd ? <Clock size={12} className="shrink-0 text-amber-300" />
    : v.kind === 'angle' ? <Video size={12} className="shrink-0" /> : <Film size={12} className="shrink-0" />}
  <span className="truncate">{v.name}</span>
  {v.coversPlayhead && !isActive && <ArrowLeftRight size={12} className="shrink-0 opacity-80" aria-hidden />}
</button>
```

**While playing inside each video.** The active segment follows the playhead (sequential: `currentVideoSequence`; overlap: the active source). The readout reads "Video 2 of 2" at `sm`+; the highlighted segment is the readout on phone. This satisfies hard requirement (a): the bar is directly under the player, exists whenever the game has 2+ videos, and is a fixed-width surface, so square (letterboxed) footage changes nothing about where it sits or how wide it is. Requirement (c) is met by construction: segments share the row equally, so the 19s video gets the same tap target as the 85-minute one.

**On tap (hard requirement b).** The tapped segment takes the selected fill immediately (optimistic from the gesture, not from a later playhead tick), the readout text swaps to "Now watching {name}" for 1.5s (`data-testid="source-notice"`, the same span that shows "Back to main camera" on auto-fallback), and the segment gets the 300ms `ring-2 ring-white/70` pulse. On an overlap inside the conflicted region the picture switches in place; everywhere else the playhead jumps to the video's start. Tapping the already-active segment still pulses and still jumps to its start, so no tap is ever silent.

**Switching on an overlap.** Inside the conflicted region both segments show as switchable: the non-active one carries the `ArrowLeftRight` glyph; tapping it calls `switchToSource(seq, t)`, same wall moment, picture changes in place. Outside the region the Sideline segment has no glyph; tapping it jumps to the start of Sideline and activates it. The violet angle strip stays as the map of where the conflict is.

**Jumping on a sequential game.** Tap the other segment: seek to its `virtualStart`. No glyph ever appears, so the bar reads as a simple "which video" selector.

**4+ videos.** Segments give way to a trigger + chevrons: `[ChevronLeft 44px] [Film] Watching oct-5-2…-10-05 [ChevronDown] [ChevronRight 44px]`; the popover lists every video with the same segment anatomy plus a `border-t border-gray-700` block of `Fix timing: {angle}` rows (moved from the badge). Portal the popover to `document.body` (the T5700/T8600/T8900 transformed-ancestor landmine, see `AngleLanes.jsx:232-254`). Prev/next move through the sorted list (seek to start). Prev/next are NOT shown for 2-3 videos: tapping a segment is the jump, and a second way to do the same thing is noise.

**Timeline changes.** The 10px chips are removed (their job moved to the bar). The boundary line becomes a visible flag: `w-0.5 bg-gray-300/80` full height plus a 10x6px downward triangle at the top of the Video track (`border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-300`), still `pointer-events-none`, rendered only when `boundaryOffsets.length > 0` (single-video DOM unchanged). It marks WHERE, the bar says WHAT.

**Degradation at 390.** Bar is a single row, `min-h-[52px]` on coarse pointers (44px segments + 4px padding). The "Video 2 of 2" readout is `hidden sm:inline` (the highlighted segment already says which). Two segments are ~150px each, three ~95px (icon + 8-9 chars before truncation). Fix timing is icon-only everywhere (44x44 on coarse). The timeline below is untouched in height.

**Removed.** `AngleSwitcherBadge` (the pill) is deleted; `AnnotateModeView.jsx:884-892` renders `null`. Its tests move to `SourceBar.test.jsx`.

**Tradeoffs.** +44-52px of vertical chrome on phone for every multi-video game, even while scrubbing. Names are not ON the timeline (only flags are); a user who wants to read names off the track has to look one row up. Active colors differ by kind (blue for main, violet for angle), which is a deliberate reuse of two existing meanings, not a new palette, but it is one more thing to learn than a single accent.

**LOC estimate.** New `SourceBar.jsx` ~160, container derivation ~50, view wiring ~20, timeline flag ~15, chip removal -20, badge removal -146, copy keys ~15, tests ~200.

---

## Option B: a labelled Videos lane in the timeline

**Where it lives.** A new `modes/annotate/VideoLane.jsx`, mounted as the FIRST layer child in `AnnotateTimeline.jsx` (where `AngleLanes` mounts today, L212), for every multi-video game. It generalizes `AngleLanes`: lane 0 is the main footage (one block per sequential video, or per backbone segment in an overlap game), lanes 1-3 are the existing angle rows. The left label column gets a matching label (`Film size={14} text-blue-400` + "Videos", same shape as the Angles label at L131-143). `totalLayerHeight` grows by the lane's height only when it exists.

**Blocks.** Same anatomy as the bar's Segment, but positioned on the axis with the shared `leftCalc`/`widthCalc` and a collision-resolved minimum width:

```js
const MIN_BLOCK_PX = isMobile ? 44 : 56;
let cursor = 0;
blocks = videos.map(v => {
  const trueLeft = usableWidth * v.virtualStart / duration;
  const left = Math.max(trueLeft, cursor);                       // pushed right of the previous block
  const width = Math.max(usableWidth * (v.virtualEnd - v.virtualStart) / duration, MIN_BLOCK_PX);
  cursor = left + width + 2;
  return { ...v, left, width };
});
```

`trackWidth` comes from a `ResizeObserver` as in `AngleLanes.jsx:70-76`. The boundary flag stays at the TRUE position, so the axis never lies; only the label block is pushed. Classes: main block `h-6 lg:h-6 rounded px-1 flex items-center gap-1 text-[11px] truncate` with the blue inactive/active pair from Option A; angle blocks keep `angleClasses`.

**At rest.** Desktop: `Videos` lane `h-6` + `mt-1` above the Angles rows (overlap) or directly above Plays (sequential). Mobile: `h-8` block row (32px, with a transparent `before:-inset-y-1.5` hit extension to reach 44px) plus, for overlap games, the existing merged `h-3.5` angle row.

**While playing.** The block under the playhead is the active (filled) one; the others are outlined. The readout stays over the video and becomes mandatory (hard requirement a): `AngleSwitcherBadge` renders at rest for ALL multi-video games, as a `Watching {name}` chip (`Film`/`Video` icon, `bg-gray-900/85 text-xs`, bottom-right) when one source covers the playhead and as its existing segmented / popover forms when 2+ do. It is the only always-visible readout in this option; on the 19s + 85min game it is what tells the user which video is playing, since video 1's block is 44-56px of pushed label, not a proportional span. **Letterbox caveat:** the chip is anchored to the stage box corner. With the user's square footage the box is letterboxed at 1440, so the chip sits on the black bar ~300px right of the picture; on phone the box is nearly square and the chip overlaps footage. Legible in both, but not next to the picture on desktop. Requirement (c) is met only by the `MIN_BLOCK_PX` rule.

**On tap (hard requirement b).** Same contract: the block takes the selected fill immediately, the over-video chip swaps to "Now watching {name}" for 1.5s, the block pulses, and the player seeks (sequential) or switches in place (overlap). The 19s video 1 block is always at least `MIN_BLOCK_PX` wide, so it is tappable on both widths.

**Switching on an overlap.** Tap an angle bar (existing behavior, now also with the `ArrowLeftRight` glyph when it covers the playhead and is not active) or the pill. Fix timing entry points are unchanged (long-press / right-click a bar, 3+ popover rows).

**Jumping on a sequential game.** Tap a block: seek to its start.

**Degradation at 390.** Timeline grows from 88px to ~124px (sequential) or ~142px (overlap). Blocks at 3x zoom scroll with the track, so a block for a video far to the right is off-screen until the user scrolls; the pill is the only always-visible readout and it is the surface the user already missed.

**Tradeoffs.** Names live on the timeline where the user looks for them, and the map and the control are one object (good). But the lane is inside the horizontally scrolling 3x phone track, so "see all the sources" is not guaranteed at a glance; the readout stays over video (text over footage, bottom-right, the surface the user already missed once); blocks with minimum widths overlap neighbours' true spans (mitigated by the flags, but a reviewer will ask); the mobile timeline, already called tight, gets taller. Fix timing stays behind a long-press. Against hard requirement (c), the 19s block is legible only because of the minimum-width rule, which makes it a label rather than a span.

**LOC estimate.** New `VideoLane.jsx` ~200 (absorbs most of `AngleLanes`), timeline label/height ~30, badge at-rest readout ~25, chip removal -20, tests ~180.

---

## Option C: A's bar everywhere plus B's lane at `lg`+

The bar (Option A, exact spec) is THE control on every width. On desktop (`lg`+, where a 19s block at 56px is visible and the screen is tall) the Videos lane (Option B spec) is added as a map whose blocks call the same `onPick`. Phone keeps only the boundary flags on the timeline, so its pixel cost equals Option A.

**Tradeoffs.** Best legibility on desktop (names on the track and in the bar); one behavior (both tap the same handler), but two places to tap, which the "one control" brief asks to avoid; the largest change set (~+120 LOC over A), two components to keep in step, and the lane needs a second `MIN_BLOCK_PX` collision pass that A does not. Justified only if the user says names must be ON the desktop timeline.

---

## Recommendation

**Option A.** It is the only option whose visibility does not depend on the duration ratio of the videos, which is the exact mechanism that made both the chips and the pill invisible, and its readout and its control are the same row directly under the player, so the "Now watching" confirmation lands where the user's eyes already are after a tap. Option B keeps the map and the control on the same object but stays chained to the proportional axis and the phone's scrolling track and leaves the readout over the footage, and C buys desktop names at the cost of a second tap target and the biggest diff.

## Implementation plan (Option A)

1. `displayNames.js`: add the `ANNOTATE` keys above; replace the literals at `AnnotateContainer.jsx:439, 447`.
2. `AnnotateContainer.jsx`: generalize `fallbackLabel`/`showFallbackLabel` (L444-450) to `sourceNotice`/`showSourceNotice(text)`; derive `sourceBar` (memo over `gameVideos`, `fullTimeline`, `effectiveCurrentTime`, `activeSourceSequence`, `currentVideoSequence`, `sourceNotice`, `pulseSequence`); `onPick` branches on `isOverlapTimeline` and `coversPlayhead`, then ALWAYS calls `showSourceNotice(ANNOTATE.nowWatching(name))` and `pulse(sequence)`; return `null` for < 2 videos. Drop `angleSwitcher` and `videoSegments` from the return (keep `videoSegments` derivation if B/C is picked later; otherwise delete with its test).
3. New `modes/annotate/SourceBar.jsx` with the segment / 4+ popover branches; popover portalled to `document.body`.
4. `AnnotateControls.jsx`: `flushBottom` prop (class only).
5. `AnnotateModeView.jsx`: render `<SourceBar>` after both `AnnotateControls` sites (L958 windowed/desktop-fullscreen, L1117 mobile fullscreen); delete the badge mount at L884-892 and its import; stop threading `videoSegments`.
6. `AnnotateTimeline.jsx` (+ the `AnnotateMode.jsx` pass-through, see the T13280 landmine in `annotate.md`): remove the chip block L292-310; upgrade the boundary marker L312-320 to the flag.
7. Delete `AngleSwitcherBadge.jsx`; move its tests.
8. Tests (curated set): a Playwright repro on the measured game (`empty-f1@test.local`, game 1, or a fixture with an 18.84s + 5116.9s pair of square videos) asserting that `elementFromPoint` at the centre of each `source-seg-*` returns that segment at 390 and 1280 (the exact failure that was measured on the chips), that tapping video 1 moves `currentTime` to 0 and the readout to "Now watching IMG_4412", and that tapping the active video 2 at 0:18 still produces the notice; new `SourceBar.test.jsx` (sequential names/active/tap seeks; overlap swap glyph only on covering non-active segment, tap switches at the same time; 4+ popover + prev/next; fix-timing button only when active is an angle; `null` sourceBar renders nothing; tap on the ACTIVE segment still seeks to its start and shows "Now watching"; the notice clears after 1.5s under fake timers), `AnnotateTimeline.angleStrip.test.jsx` (single-video equality still passes), `AnnotateMode.videoSegments.test.jsx` (retire or repoint), `AnnotateModeView.toolbar.test.jsx` (controls DOM unchanged for single video), a Playwright check at 390 that every `source-seg-*` is >= 44px tall and that tapping the inactive segment on a seeded overlap game changes the active source without moving `currentTime` by more than 0.1s.
9. `annotate.md`: replace the T8890 badge entry and the T13280 chip entry with the bar; note that the pill is gone and that Fix timing has a visible entry point.

## Acceptance criteria (proposed rewording for the task file)

- [ ] A game with 2+ videos shows a Videos bar under the player controls at 390, 768 and 1440, naming every video and highlighting the one playing; single-video games render byte-identically (existing equivalence tests pass)
- [ ] On the measured game (18.84s + 5116.9s, square footage) every video is reachable with one tap at 390 and 1280: `elementFromPoint` at each segment's centre returns that segment, and the bar's position and width do not change with the footage aspect
- [ ] Tapping a video that does not cover the playhead jumps to its start; tapping one that does (overlap) switches cameras at the same moment, and that segment shows the swap glyph beforehand
- [ ] Every tap gives visible feedback: the tapped video takes the selected state, the readout says "Now watching {name}" for ~1.5s, and on an overlap the picture changes; this holds when tapping the already-active video and when the playhead was already inside the tapped video (the user's "nothing happens" case)
- [ ] Each video boundary is a visible flag on the timeline
- [ ] Overlap games keep the angle strip; Fix timing is reachable from the bar when an angle is active and from the existing strip gestures
- [ ] No write path is touched: jumping and switching are seeks / source switches only
- [ ] Touch targets in the bar are >= 44px on coarse pointers
- [ ] A frontend test covers the bar's names, the jump, the switch, and the single-video null case

## Risks

1. **Vertical budget on phone.** +52px above an already-tight timeline. Mitigation in the spec: `hidden sm:inline` readout, icon-only Fix timing, no prev/next below 4 videos. If the user still finds it heavy, the fallback is `min-h-[44px]` with `py-0` (segments flush to the bar edges).
2. **Overlap-game semantics outside the conflicted region.** Tapping "Sideline" while the playhead is outside Sideline jumps to Sideline's start AND activates it; the auto-fallback effect (`AnnotateContainer.jsx:479-493`) will revert to the main camera the moment the playhead leaves Sideline's span again. That is existing behavior, but a user who taps Sideline expecting it to "stick" may be surprised. The swap glyph is the only cue that distinguishes the two outcomes; if it is missed, the segment's `title` is the backup on desktop only.
3. **4+ videos path is untested in prod.** No real account has 4 videos in one game today; the popover branch will ship on unit tests alone.
4. **Mobile fullscreen.** The bar must mount under the mobile fullscreen transport too (L1117), or phone users in fullscreen lose both the pill and the bar. Easy to miss; it is in the plan.

## Consistency notes

- Matches the controls bar surface (`AnnotateControls.jsx:138-140`) and the Angles label icon/size idiom (`AnnotateTimeline.jsx:131-143`).
- Reuses `angleClasses` colors for angle segments (`AngleLanes.jsx:39-43`) and the style guide's `bg-blue-600` selected state for main footage.
- Follows "discoverable, never hover-only" (ui-style-guide § Discoverable): the control is at rest whenever it exists.
- Differs from the T8890 pill in that it is never conditional on the playhead; that is the point.
