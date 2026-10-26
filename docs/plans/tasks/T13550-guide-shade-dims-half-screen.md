# T13550: Guidance shade dims only the left half of the screen

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend guidance)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26 (report bug 18, screenshots `BUG-18-frame-shade-half-screen-390.png`, `BUG-18b-annotate-shade-half-screen-768.png`).

## Problem

Sometimes the guide shade covers only a left portion of the screen (about 185 px of 390, about 490 px of 768) while the rest (video, half of Generate, header) stays bright. The `guide-shade` element itself measures full screen, so the cutout/mask geometry is wrong. It persisted more than 1.5 s in Frame. Seen in two places:

- Frame at 390x844, step 4 ("Tap Preview highlight to see exactly what you'll share.") right after pressing Play.
- Annotate at 768x1024 right after tapping Done on a newly marked play ("Tap Make highlight to turn this play into a video, or Edit play to adjust it."), while the "Added play" toast was showing.

## Repro steps

A. 390x844 (touch), Guidance on: open a play in Frame, drag the crop box, tap Play, wait for step 4. Screenshot.
B. 768x1024, Guidance on: Annotate on "Vs Carlsbad QA", play a few seconds, tap Mark play, tap Done. Screenshot within 2 s.

**Expected:** whole screen dimmed except the controls the card names.
**Actual (before fix):** a vertical split: left part dimmed, right part bright.

Log the shade's `data-cutouts` and computed mask when it happens.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/` (shade / GuideScope / FloatingCoach)
- `.claude/knowledge/guidance.md`

## Verify the fix (required, before and after)

1. **Before the fix:** reproduce A and B and keep the screenshots; write a test that renders the shade with the cutouts captured at that moment and asserts every non-cutout pixel region is dimmed; see it fail.
2. **After the fix:** repeat A and B at the same sizes; screenshots show the full screen dimmed except the named controls.

## Acceptance Criteria

- [ ] No partial-screen shade in A or B
- [ ] Test fails before, passes after; before/after screenshots attached
