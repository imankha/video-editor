# T12040: Annotate cards: Mark play is primary, Review plays keeps its lock cues

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Annotate action cards are four identical cyan ActionCards (AnnotateModeView.jsx:1300-1311) so Mark play has no visual primacy. REGRESSION: Review plays lost T11750's locked cues: AnnotateModeView.jsx:1306 shows the ListVideo icon with full card styling instead of the Lock icon, no outline and dimmer text; the test (AnnotateModeView.cta.test.jsx:130-134) only checks aria-disabled. With a play selected, the order is Edit play, Portrait slot, Landscape slot (:1266-1298): the main action (Make highlight) is not first, Edit play is a verbatim third copy of actionCardClass (:1272), and the slot Make buttons are solid cyan (HighlightOrientationSlots.jsx:115-126). Review mode (:690-701) shows Back first with no primary.

## Solution

Use CtaBar: Mark play primary; Review plays locked uses the three T11750 cues and the test is fixed to assert the Lock icon; selected-play order is the two highlight slots then Edit play (slots are a documented 'choice pair' of two equal primary-weight cards, default D6=A); review mode is Share plays primary then Back (default D7); remove the inline class copy; coach pulse targets unchanged.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/AnnotateModeView.jsx`
- `src/frontend/src/modes/annotate/AddFootageButton.jsx`
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx`
- `src/frontend/src/modes/AnnotateModeView.cta.test.jsx`

### Related Tasks

- T12010. Decision defaults D6/D7 (README).

### Test first (red before green)

Fix the T11750 test to assert the Lock icon first: it fails today.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12040:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Mark play is visually the primary
- [ ] Locked Review plays shows the Lock icon, no border, dimmer text (test asserts the icon)
- [ ] Selected-play order is slots then Edit play; review mode has one primary
- [ ] Annotate states added to cta-consistency.spec.js
- [ ] Relevant tests pass and lint is clean
