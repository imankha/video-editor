# T12340: Pulse the next athlete box in the spotlight pick

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-09
**Updated:** 2026-10-09
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** T10880 (pulsating next-action audit), closed as superseded 2026-10-09

## Problem

T10880's seed case: in the spotlight pick, before the user has clicked any detection box, nothing
draws the eye to the one to click first. The shared guide resolver carries a `pulse` field and
Annotate and Focus consume it (`pulsePlay`, the portrait pulse), but the Overlay spotlight pick
rules all set `pulse: null` and the pick surfaces have no pulse handling, so this case is still open
after T12280.

## Solution

Give `overlay.pick.first` (and the next-box states) a `pulse` value and render it on the recommended
detection box through the same pulse primitive Annotate and Focus use. No new animation per screen.
The pulse only marks a recommendation; the user still picks (see the AI capability copy accuracy
rule: never imply the app selects or tracks for them).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/components/instructions/resolveGuide.states.test.js`

### Related Tasks

- Depends on: T12280 (spotlight pick guide, on staging).
- Source: [T10880](../../T10880-pulsating-guidance-audit.md).

## Acceptance Criteria

- [ ] With no box chosen yet, the first recommended box pulses; the pulse stops once the user picks
- [ ] The pulse reuses the existing shared primitive, not a bespoke animation
- [ ] The state test covers the pulse value for every pick state
- [ ] Relevant tests pass and lint is clean
