# T11880: Honest upload modal copy

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Tier:** S/M (copy in `displayNames.js` + 1 test; landing alignment check)
**Created:** 2026-10-04
**Decision gate:** U1 (recommended I-1). Depends on T11770 (shared cost row).

## Epic Context

Task 2 of 3 in [Epic E](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/02](../../../ux/2026-10-04-parent-usability-audit/desktop/02-upload-game-modal-jargon.png),
[iphone/03](../../../ux/2026-10-04-parent-usability-audit/iphone/03-upload-modal-credit-wrap-and-jargon.png).
At the moment the parent spends credits on a family video, the modal describes machinery: "pick them
from the AI's player boxes", "connects the dots", "upscales your video".

## Solution (I-1)

Replace `DIVISION_OF_WORK` (`config/displayNames.js:290-291`) with:

> You mark the best plays and frame your player. We smooth the motion, sharpen the picture, and build a highlight you can share.

Honesty check: the parent marks and frames; the app smooths motion between the parent's framing
points and upscales ("sharpen the picture"). Picking the player from AI-proposed boxes is left out
rather than misdescribed; Spotlight explains it in context. Keep the existing rule comment at
`:283-289` (no autonomous framing/tracking claims).

The cost/balance/retention facts below the copy use T11770's `CreditCostRow`. Optional extra
retention line **Highlights you make are kept.** only after confirming in the backend that highlights
outlive the 30-day game video. **Do not add it unverified.**

## Relevant Files

- `src/frontend/src/config/displayNames.js:283-291`
- `src/frontend/src/components/GameDetailsModal.jsx:254` (only consumer)
- Landing duplicates (T10170 requires app and landing to match):
  `src/landing/src/site.ts:40`, `src/landing/src/pages/index.astro:53`, `pages/[sport].astro:50`,
  `src/landing/src/data/cameras.ts:82,101,138,157`, `data/useCases.ts:152`, `llms.txt.ts:32`.

## Implementation Steps

1. Change the string.
2. Read each landing duplicate. If it describes the same division of work, align it in a **separate
   commit** and flag in the PR that `/deploy-landing` is needed after merge. If a landing string is
   marketing copy with a different job, leave it and say so in the PR.

## Acceptance Criteria

1. The upload modal shows the new sentence at 390 and 1440.
2. No string in the diff claims framing, tracking, centering or following by the app; no em dashes.

## Tests

- No test pins the old string today. Add one assertion in `GameDetailsModal.videoFirst.test.jsx`
  that the modal renders `DIVISION_OF_WORK`.

## If the user picks a different U1 option

- **I-2 (numbered steps):** an `ol` with gray-500 numerals: "1. Upload your game." "2. Mark the plays
  you want to keep." "3. Frame your player. We smooth the motion and sharpen the picture." "4. Share
  your highlight." Check at 844px tall that Upload game stays above the fold.
