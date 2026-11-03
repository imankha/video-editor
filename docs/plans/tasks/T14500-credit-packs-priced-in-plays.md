# T14500: Credit packs priced in "plays"

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Credit packs are sold with a headline of "~N plays" in the app's Buy Credits modal and on the
landing pricing cards. In the product, a play is a moment the parent marks, and marking is
free. Credits actually pay for each second of finished highlight (plus game storage). A parent
reads "~40 plays" as "40 moments I can mark", which is misleading at the moment of payment.

Found by the 2026-11-03 copy audit. See [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)
for the glossary (price packs are counted in **highlights**).

## Solution

Count packs in highlights: "~N highlights", with the credit count below. Rename the helper so
the code says what it means. Keep the estimate's basis (a typical highlight length) stated.

## Context

### Relevant Files
- `src/frontend/src/components/BuyCreditsModal.jsx` (~line 564: `~{pack.plays} plays`)
- `src/frontend/src/config/pricing.js` (`CREDITS_PER_PLAY`, `approxPlays`)
- `src/landing/src/pages/index.astro` (~lines 395, 421, 448: "A typical play uses ~N", "~N plays", "Play counts are estimates")
- Any test asserting the "plays" pack copy (grep `approxPlays` and "plays" in `BuyCreditsModal*.test.jsx`)

### Related Tasks
- T8950 (credit pricing model audit): pricing basis, not this label
- T11650 (signup credits + landing copy): touches the same landing pricing block; coordinate

### Technical Notes
- Landing imports `@editor` modules, so a `pricing.js` rename affects the landing build too.

## Implementation

1. [ ] Failing test: Buy Credits pack headline reads "highlights", not "plays"
2. [ ] Rename `CREDITS_PER_PLAY` / `approxPlays` to highlight names; update both consumers
3. [ ] Update the landing pricing copy (3 strings)
4. [ ] Explicit lint + landing build

## Acceptance Criteria

- [ ] No credit pack, in app or landing, is labeled in "plays"
- [ ] Pack copy reads "~N highlights" and the explainer says what a typical highlight costs
- [ ] Tests pass; landing builds
