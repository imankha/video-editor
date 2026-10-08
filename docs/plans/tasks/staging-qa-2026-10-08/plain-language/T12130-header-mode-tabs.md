# T12130: Header mode tabs: no locked, unexplained steps

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q6,Q7 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

ModeSwitcher.jsx:53-79 shows 'Mark Plays / Frame Highlight / Add Spotlight' with the locks explained only by title and a tap toast (:99-114,122-127); two locked strings are inline, not in displayNames. One goal carries several names: MODE_SWITCHER_NAMES (displayNames.js:211-215), MAKE_HIGHLIGHT_NOW :69, FRAME_THIS_CLIP 'Make Highlight' :103, MAKE_A_HIGHLIGHT :109, 'Generate highlight' :464.

## Solution

Per decision Q6. Recommended B: in Annotate, while the selected play has no highlight, render no tabs (header shows breadcrumb and credits; 'Make highlight' is the one way forward); once a highlight exists show 'Mark Plays | Frame | Spotlight' with Spotlight locked and the visible caption 'Generate your highlight to add a spotlight.' Smallest diff at ModeSwitcher.jsx:82. Whatever is picked: one 'Make highlight' entry string everywhere, every locked state shows its reason without hover, strings in displayNames.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/shared/ModeSwitcher.jsx`
- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/components/shared/ModeSwitcher.test.jsx`

### Related Tasks

- Decision Q6, Q7.

### Test first (red before green)

ModeSwitcher test: locked tab renders a visible reason (fails today, title/toast only).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12130:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Behaviour per the chosen option
- [ ] Every locked state shows its reason without hover
- [ ] One 'Make highlight' string
- [ ] Relevant tests pass and lint is clean
