# T12220: Clips empty state copy and a lone game centred

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q17 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

Clips empty headline 'Focus the action on your athlete.' (config/emptyStates.js:53) is marketing, not an instruction, and says nothing after the one clip was finished while the game says '1 play' (qa-36). The Games page left-aligns a lone card under a centred header (ProjectManager.jsx:1880-1904 with GAMES_GROUP_SECTION_CLASS :89; an 8rem rail plus a 2-column pack leaves a single tile at far left once clip_count > 0 hides the T8990 filler) (qa-37). (The home 'Press on a game' guide with zero games is owned by T12250.)

## Solution

Clips headline 'Highlights in progress', body 'Plays you've started turning into highlights wait here until you finish them.'; when drafts = 0 and finished > 0: 'Nothing in progress. Your highlight is in Finished.' with main CTA 'Mark more plays' (goes to Games) then secondary 'Go to Finished'. When games.length === 1 wrap the section in max-w-xl mx-auto and skip the rail class. The empty-state copy is marked user-approved binding (2026-09-17): needs decision Q17 before changing.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/config/emptyStates.js`
- `src/frontend/src/components/shared/EmptyTabGuide.jsx`
- `src/frontend/src/components/ProjectManager.jsx`
- `tests`

### Related Tasks

- Decision Q17. After T12090.

### Test first (red before green)

Unit: Clips with 0 drafts and 1 finished renders the Finished pointer (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12220:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Clips empty state names Finished when a highlight exists
- [ ] A single game is centred
- [ ] Relevant tests pass and lint is clean
