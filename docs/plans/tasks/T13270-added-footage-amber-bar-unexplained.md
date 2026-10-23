# T13270: Footage added in Annotate shows as an unexplained amber bar and the explanation disappears

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Tier:** M (frontend; verify first)
**Created:** 2026-10-21
**Updated:** 2026-10-21
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

User tested T13040 (Add footage tile) on the g-t13040-4 container on 2026-10-21. After adding a second video to a game the timeline showed a gold-brown block with a clock icon and a truncated filename ("oct-5-2...-10-05") spanning most of the timeline, and the user could not tell what it was or how to switch between video sources: "after adding footage i dont see a way of flipping between video sources. not sure what to make of this UI".

## Problem

What the user saw matches the **amber** landing variant of T8910 (footage with no usable recorded time is appended at the end of the game and drawn as an amber warning bar). Against the T8910 spec ([universal-upload/T8910-add-footage-in-annotate.md](universal-upload/T8910-add-footage-in-annotate.md)) and the code:

1. The only explanation is a toast ("We couldn't tell when {name} was filmed. We put it at the end. Use Fix timing to move it.", 8 s, `AnnotateContainer.handleFootageAttached`). Once it is gone, the bar is a clock icon plus a truncated filename with no label saying "added footage, placed at the end, tap to fix timing".
2. The amber state is local view state (`setAmberFootage`, set only inside the upload-complete handler). After a reload or re-entering the game, nothing marks the added video at all: it is just part of the timeline.
3. The toast says "Use Fix timing" but nothing visible says how to reach it. The spec says tapping the amber bar opens Fix timing; the bar carries no hint, and for footage that was simply a second half (not a camera angle) the user does not want to "fix timing", they want to see that the second video is there and jump to it.
4. The user's mental model is "I have two video sources, flip between them". Angle switching (`Main camera | {angle}` pill, T8890) appears only for footage that overlaps the main camera. Appended footage is part of one continuous timeline, which is correct but never explained.

## Solution

Verify the screenshot case first (which landing variant, and whether the bar persists after reload), then:

1. Give the amber bar a readable, persistent label and a visible affordance ("Added at the end. Tap to set when it was filmed" or the equivalent copy in `config/displayNames.js`), not just an icon and a clipped filename.
2. Decide whether the amber marker should survive a reload for footage that still has no real recorded time. If yes it must be derived from data (the same prefix-sum test `computeLandingOutcomes` uses), never persisted view state.
3. Make the toast and the bar say what the footage IS in plain words (second video appended after the first; plays through continuously) when it landed by prefix-sum.

Coordinate with [T13280](T13280-annotate-no-way-to-see-or-jump-between-videos.md), which covers navigating between added videos; this task is only the amber/landing feedback.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (amber bar render ~L296-316, `amberFootage`)
- `src/frontend/src/modes/annotate/footageLanding.js` (`computeLandingOutcomes`, the AMBER derivation)
- `src/frontend/src/containers/AnnotateContainer.jsx` (`handleFootageAttached` ~L1320-1370, `setAmberFootage`)
- `src/frontend/src/config/displayNames.js` (copy)
- `.claude/knowledge/annotate.md`

### Related Tasks
- Original spec: T8910 (add footage in Annotate), T8900 (Fix timing), T8890 (angle strip)
- Found while testing T13040
- Sibling: T13280

## Acceptance Criteria

- [ ] The amber bar states in words what it is and how to fix its timing, and the label is readable at 390 and 1440
- [ ] After a reload, footage still placed by prefix-sum is still marked, derived from data (no persisted view state)
- [ ] Tapping the bar opens Fix timing (test)
- [ ] A frontend test covers the amber landing and the post-reload derivation
