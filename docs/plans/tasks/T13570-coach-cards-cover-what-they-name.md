# T13570: Coach cards and shade cover or dim the very controls they tell you to use

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Tier:** M (frontend guidance placement)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26 (report bugs 16, 17, 19, 27, 49, 70). Screenshots in `C:\Users\imank\Desktop\staging-qa-part2-2026-10-26\`.

## Problem and repro steps (each is a separate check; Guidance on)

**A. Annotate timeline (bug 16), 390x844 and 768x1024.** Open "Vs Carlsbad QA", tap Play. Card "You've marked 4 plays. Keep going, or tap a play to make it a highlight." sits on top of the plays row it tells you to tap. Screenshot `BUG-16-guide-covers-plays-timeline-390.png`.

**B. Home after reload (bug 17), 390x844.** Reload /home/games. Card "You haven't watched all of your game yet..." covers the Upload game button; a "Highlight ready / View / Dismiss" toast covers the highlighted game tile's name. Screenshot `BUG-17-home-guide-covers-upload-toast-over-tile-390.png`.

**C. Frame preview (bug 19), 390x844.** In Frame tap Preview highlight. Card "Watch it through. Tap Back to full video to change anything." covers about half the preview video. Screenshot `BUG-19-preview-guide-covers-video-390.png`.

**D. Edit play (bug 27), 768x1024.** Select a play, Edit play. Card "Drag the green ends so the play starts and stops where you want..." is shown but the green trim bar is the one area left dimmed. Screenshot `BUG-27-edit-play-trim-bar-dimmed-768.png`.

**E. Spotlight pick (bug 49), 1440x900.** Add spotlight, tap the athlete on moment 1. Card "Tap your athlete again on this moment." covers the right half of the small video where the players are. After tapping "My athlete isn't outlined" the coach disappears with no instruction for what to do instead. Screenshot `BUG-49-spotlight-card-covers-video-1440.png`.

**F. Shade blocks other main buttons (bug 70), 1440x900.** Annotate with 6 plays, card "You've marked 6 plays...": the shade cuts out only Mark play, so Review plays / Share plays cannot be clicked until "Got it".

**Expected (all):** the card sits beside what it names without covering it, the named control is lit, and the user can still reach the screen's other main buttons.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/` (FloatingCoach placement, GuideScope cutouts, guide rules)
- `src/frontend/e2e/guide-no-overlap.spec.js`
- `.claude/knowledge/guidance.md`

### Related Tasks
- T13460 (Guidance switch overlaps headers), T13550 (half-screen shade)

## Verify the fix (required, before and after)

1. **Before the fix:** run each of A-F at the stated size, keep a screenshot of each failure, and extend `guide-no-overlap.spec.js` with these cases (card rect must not intersect the named target or the video; named target must be inside a cutout); the new cases must fail.
2. **After the fix:** rerun A-F at the same sizes; attach passing screenshots and the passing spec.

## Acceptance Criteria

- [ ] A-F all pass at the listed sizes
- [ ] E: after "My athlete isn't outlined" the coach says what to do next
- [ ] Spec cases fail before, pass after
