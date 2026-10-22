# T13280: Annotate gives no way to see or jump between the videos of a multi-video game

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M (frontend; needs a small design decision first)
**Created:** 2026-10-21
**Updated:** 2026-10-21
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

User tested T13040 on 2026-10-21: after adding footage to a game they could not find "a way of flipping between video sources".

## Problem

Comparing the original add-footage tasks (T8910, T8890, T8900, T9350) with the code:

- **Overlapping footage (angles):** T8890 built source switching (`Main camera | {angle}` pill, angle strip, `switchSource`). It only renders when footage overlaps the main camera in time (`sourcesAt(playhead).length >= 2`).
- **Sequential or appended footage (a second half, a second card, footage with no timestamp):** by design this is one continuous virtual timeline, so there is nothing to switch. The only visual cue that a second video exists is the T2750 boundary marker in `AnnotateTimeline.jsx`: a 1 px line at 30% opacity (`w-px bg-gray-500/30`), effectively invisible. The main track carries no per-video label, and there is no list of the game's videos anywhere in Annotate.

So for the most common case (add the second half) a user has no way to see that there are two videos, where the second starts, what it is called, or to jump to it. T8910's "Add footage" gives landing feedback once (toast) and then the information is gone.

## User minimums (2026-10-21, after testing)

1. The user can **see the different video sources** of the game in Annotate.
2. The user can **flip between sources at any point on the timeline where they intersect** (overlap in time), not only via the first-seen angle pill.

These are the floor for this task; the options below are ways to meet them. Check first why the existing angle switcher (T8890) did not show for the user's footage: either it landed by prefix-sum (amber, no overlap known) or the overlap was not detected. If the user's two videos genuinely cover the same wall-clock time, the switcher failing to appear is a separate bug to root-cause here.

## Solution

Needs a small design decision (propose 2 options with mocks, per the decision-artifacts rule, before building):

- **A:** label each video on the main track (name + start time) with a visible boundary tick, tap to seek to its start.
- **B:** a "Videos in this game" list (name, duration, start time, tap to jump, Fix timing entry) reachable from the timeline header, plus a visible boundary.
- Both keep the angle pill for true overlaps and must not change angle-free single-video games (the epic's common-case guard).

Gesture rules: jumping is a seek, not a write. Nothing here persists.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (`boundaryOffsets` markers ~L318-330)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` (`buildFullVideoTimeline`, `buildGameTimeline`, `videoDisplayName`)
- `src/frontend/src/modes/annotate/AngleSwitcherBadge.jsx`, `AngleLanes.jsx` (existing angle UI to stay consistent with)
- `src/frontend/src/containers/AnnotateContainer.jsx`, `src/frontend/src/modes/AnnotateModeView.jsx`
- `.claude/knowledge/annotate.md` (T8880/T8890 sections)

### Related Tasks
- Original specs: T8910, T8890, T8892, T8900, T9350, T10770 (multi-video entry check)
- Found while testing T13040
- Sibling: T13270 (amber landing feedback)

## Decision (2026-10-22)

User picked **Option C** from the designer's three mocks ([T13280-design.md](T13280-design.md), [T13280-mocks.html](T13280-mocks.html)): the Videos bar under the player controls on every width (Option A) plus the Videos lane in the desktop timeline (Option B's lane) as a map calling the same handler. The T8890 over-video pill and the 10px timeline chips are retired. Hard requirements added after the user's live test ("nothing happens, it doesn't let me switch to it"): the active source is named next to the player at all times, every tap gives visible feedback even on the already-active video, and every video is reachable regardless of its share of the timeline (measured game: 18.84s + 85min, chips 2px apart, video 1 unreachable).

## Acceptance Criteria

- [x] A game with 2+ videos shows a Videos bar under the player controls at 390, 768 and 1440, naming every video and highlighting the one playing; single-video games render byte-identically (equivalence tests pass)
- [x] On the measured game (18.84s + 5116.9s, square footage) every video is reachable with one tap at 390 and 1280: `elementFromPoint` at each segment's centre returns that segment (live-verified 2026-10-22)
- [x] Tapping a video that does not cover the playhead jumps to its start; on an overlap, tapping a covering source switches cameras at the same moment and that segment shows the swap glyph beforehand (unit-tested; no overlap game exists on dev to drive live)
- [x] Every tap gives visible feedback: the tapped video takes the selected state, the readout says "Now watching {name}" for ~1.5s, the segment pulses; this holds when tapping the already-active video (live-verified)
- [x] Desktop (lg+) timeline shows a Videos lane whose blocks never shrink below 56px and never overlap; phone shows no lane
- [x] Each video boundary is a visible 2px flag on the timeline
- [x] Overlap games keep the angle strip; Fix timing is reachable from the bar when an angle is active and from the existing strip gestures (the pill is retired, superseding the earlier "keep the pill" criterion)
- [x] No write path is touched: jumping and switching are seeks / source switches only
- [x] Touch targets in the bar are >= 44px on coarse pointers (live-verified at 390 with touch emulation)
- [x] Frontend tests cover the bar (names, active, tap, notice, pulse, swap glyph, Fix timing, 4+ form), the lane (blocks, minimum width, collision, desktop-only mount), the pass-through, and the single-video null case

## Follow-up (2026-10-22, live user test on 'Vs LA Breakers May 9')

User feedback: the original 88-minute game video (no stored filename) read as "Extra video 1" and got a full-width colored VideoLane block, as if it were added footage; "the main video doesn't need any visual indication, only added footage does." Separately asked whether the lane scales to N stacked layers for genuinely concurrent added sources -- it already does (`assignLanes`, the same packing `AngleLanes` uses, activates automatically once `hasOverlappingAngles` is true; it was never duplicated in `VideoLane`).

- [x] The game's own original video (virtualStart 0) gets no VideoLane block and no "Extra video N" fallback name ("Game video" instead); it stays in the SourceBar switcher so it is never unreachable
- [x] Live-verified on the real game: lane shows only the genuinely added clip's block, bar names both correctly, switching both directions works with the notice

## Follow-up (2026-10-22): drag-to-reposition any added video

User asked whether placement uses embedded video metadata (yes -- MP4 `mvhd creation_time`, read client-side before upload) and said the user should be able to drag a video to a different spot on the timeline. Fix Timing (drag + nudge; the A/B preview stays angle-only, nothing to compare for an appended clip) is now reachable for any non-original video, from the SourceBar's Fix Timing button, with real pointer-drag on the VideoLane block. Committing a drag that creates genuine overlap with another video promotes it to a real camera angle (the existing architecture already supported this; only the entry gate was closed).

- [x] Fix Timing (drag + nudge) is reachable for any added video, not just angles; only the game's own original video is exempt
- [x] A/B preview (nothing to compare against) is hidden for a sequential target; nudge/drag/reset/done work identically either way
- [x] Live-verified: drag reports a correct delta, a small drag stays sequential, a drag into genuine overlap promotes the clip to a real camera angle on commit

## Follow-up (2026-10-22): compact bar at rest

User, after the drag fix: "I feel like we should only show this when the playhead is on a frame with overlapping videos and at that time we see those videos." Hiding the bar entirely outside overlap would reintroduce the original unreachability bug (a purely sequential game never has overlap, so the bar would never appear and video (6) would be unreachable again), flagged and confirmed with the user via AskUserQuestion; picked the compact-at-rest, expand-on-demand middle ground instead.

- [x] 2-3 video games show a small "Video n of m" trigger at rest, expanding into the full picker on tap or automatically whenever a genuine conflict exists at the playhead
- [x] Picking a video collapses the bar back to compact (unless the new position has a real conflict); every video stays reachable in either state
- [x] Live-verified on the real sequential game: compact at rest, expands on tap, picking "video (6)" seeks correctly and re-collapses
- [x] After Fix timing's Done the player lands ON the placed clip (seeks to its new start, activates it if it is now an angle) instead of re-seeding to 0:00 on the main camera; live-verified: the visible video element is the placed clip's file at its new position
- [x] Picking a video while Fix timing is open no longer seeks the clip's OLD position (the reported "playhead jumps to the end"); it shows "Press Done to apply the move first (or X to discard it)" and leaves the session intact; live-verified mid-session, after Done, and after a real reload
- [x] Releasing a drag saves that position on its own (one write per drop); the player lands on the clip there, the strip stays open for nudges, and the old spot no longer plays the clip; live-verified including the server-side offset and that X does not undo a drop
- [x] The chosen source for a range persists (game_videos.preferred, profile_db v058, written surgically through the placement endpoint on the pick/drop gestures, same durable_sync path): a timeline click inside the span, leaving and re-entering, and a real reload all keep the chosen source; picking Main camera inside the span clears it. Live-verified; backend tests cover the migration, the projection and the write combinations
