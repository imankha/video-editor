# T12170: 'My athlete / Team' and 'Play category' in plain words

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q10,Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

Lanes 'My athlete' / 'Team' (modes/annotate/AnnotateTimeline.jsx:158-179, empty lane text :255,269, developer tooltip 'Click to select plays layer') and 'Play category' (AnnotateFullscreenOverlay.jsx:512,690; displayNames.js:92-94) are never explained (qa-07, qa-11).

## Solution

Per decision Q10. Recommended B: a single 'Plays' lane (as phones already do) until a Team play exists, then the second lane appears; the control lives in Details as 'Who is this play about?' with [My athlete] [Team] (Q15 ruled 2026-10-08: keep 'athlete', so the label stays 'My athlete'); developer tooltip removed.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- Decisions Q10, Q15.

### Test first (red before green)

Unit: with zero Team plays desktop renders one lane (fails today, two lanes).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12170:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Lanes per the ruling
- [ ] Control asks 'Who is this play about?'
- [ ] Developer tooltip removed
- [ ] Relevant tests pass and lint is clean
