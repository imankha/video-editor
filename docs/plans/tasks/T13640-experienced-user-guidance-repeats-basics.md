# T13640: Guidance for an experienced user repeats the 5 basic steps and never suggests advanced options

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Tier:** M (guidance rules)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bug 65, plan step 7, screenshot `p2-exp-frame-1440.png`). Account had 4 finished highlights.

## Problem

With 4+ finished highlights, Frame still shows: "Step 1 of 5 Drag the box onto your athlete. Your highlight shows what's inside it." / "Step 2 of 5 Tap Play and watch your athlete." / "Step 3 of 5 If your athlete leaves the box, pause and drag it back..." / "Step 4 of 5 Tap Preview highlight to see exactly what you'll share." Spotlight also starts from the basics. The guide never invites trim and slow motion, aspect ratio, straighten, background dim, text or spotlight. First confirm with `.claude/knowledge/guidance.md` whether an experienced-user tier is specified; if not, this needs a short design from the user.

## Repro steps

1. Account with 4+ finished highlights (staging: imankh+stg-qa-20261025@gmail.com), Guidance on.
2. Open a game, Make highlight on any play, go through Frame to Preview; then Add spotlight on a ready highlight.
3. Record every guide sentence.

**Expected:** after the user has finished several highlights, the guide offers the advanced options instead of repeating the basics.
**Actual (before fix):** identical to a first-time user.

## Verify the fix (required, before and after)

1. **Before the fix:** record the sentences on this account; a guide-rules test with finished count = 4 asserting an advanced-option sentence fails.
2. **After the fix:** same account, same steps: record the new sentences; test passes; a new account still gets the basics.

## Acceptance Criteria

- [ ] Experienced users get advanced-option prompts; new users unchanged
- [ ] Test fails before, passes after
