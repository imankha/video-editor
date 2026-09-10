# T9710: Verify publish and save-draft destinations

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E6-03 (UX-12, UX-13)**.

## Why this exists

**Publishing was never exercised in the walkthrough.** Nothing was purchased, invited or published,
so publish and link access are **unverified, not verified-working**. T9590 changes the post-Focus
choices and T9600 touches status, both of which land on this untested path.

## Scope

Using authorized test data and audience, verify:

- Private draft persistence and its actual privacy.
- Publish without spotlight.
- Publish with effects.
- Final link access: what a link holder sees, and what they do not.
- Save draft's destination and its confirmation.

## Context

### Related Tasks
- Depends on: T9590, T9600, T9670 (the audience contract)
- Use a separate test account. The walkthrough's own saved objects ("Vs Carlsbad - parent
  walkthrough test Sep 9", "Great Control Pass", "Full Effort Play") must not be overwritten.

### Technical Notes
Confirm no unintended exposure. This is the one path in the group where a mistake is visible outside
the account.

## Acceptance Criteria

- [ ] Private draft persistence and privacy verified with a real second viewer
- [ ] Publish without spotlight and publish with effects both verified
- [ ] Final link access verified for what it grants and what it withholds
- [ ] Save draft lands where its copy says it does
- [ ] No unintended exposure, and the walkthrough's own objects were not overwritten
