# T17180: Spotlight: labeled entry and tap guide

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

After a highlight is sharpened, a parent who left the Frame screen (as the app allows) can only reach "Add spotlight" through an unlabeled pencil icon in the finished player. When they do get there, the "Tap your athlete" guide card covers the lower half of the video, where the athletes are, so it hides what it asks them to tap. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U04, U06), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Finished player: a labeled "Add spotlight" button ("Edit spotlight" once one exists) in the action bar beside Share. Label the pencil "Edit highlight". On a phone, the scales and pause icons move into a "More" menu with words. The `finished.*` coach rules must keep the new button clear (see the T14840 landmine).
- Spotlight tap walk on a phone: show the guide as a one-line strip above the video ("Tap your athlete, 1 of 4") with the video stage kept clear; "My athlete isn't outlined" stays reachable as a small text button in the strip.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: At 390x844, the finished player shows a labeled "Add spotlight" (or "Edit spotlight") button without opening any menu.
- [ ] C2: During "Tap your athlete" at 390x844, no part of the guide overlaps the video.
