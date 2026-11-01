# T14240: Credit help contradicts itself on which render costs credits

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Created:** 2026-10-31
**Updated:** 2026-10-31

## Problem

QA sweep 2026-10-31. Buy Credits -> How credits work says "Generated video costs 1 credit per
second", "Any render costs at least 1 credit", then lists "Spotlight & highlight render" under
"Always free". To a parent, "generating video", "render" and "highlight render" are the same
thing, so they cannot predict what a generate or regenerate will cost. Actual charging is
correct (framed highlight used 7 credits; the later spotlight/text render was free).

## Solution

Copy-only change in `CreditsExplainer` (`src/frontend/src/components/BuyCreditsModal.jsx`) and
the `CREDITS` constants it uses. Name the paid step by what the user does, and name the free
step the same way. Direction:
- Paid: "Creating a highlight from a framed clip (AI upscaling): 1 credit per second of video,
  minimum 1 credit."
- Free: "Adding or changing spotlight and text on a highlight you already created."
Drop the bare word "render" from both lists. Confirm against the backend charge points which
operations actually charge before writing the final copy (do not claim a free regenerate if
re-framing re-charges). No em dashes; AI copy must not claim autonomous framing.

## Context

### Relevant Files
- `src/frontend/src/components/BuyCreditsModal.jsx` - `CreditsExplainer` (~line 113)
- `src/frontend/src/components/BuyCreditsModal.test.jsx`
- `src/frontend/e2e/t4940-monetization-qa.spec.js` - may assert the old copy
- CREDITS constants module (imported by BuyCreditsModal)

## Acceptance Criteria

- [ ] Paid and free lists use distinct, user-action wording; no item appears to be in both
- [ ] Copy matches the backend's actual charge points
- [ ] Unit test and e2e assertions updated
