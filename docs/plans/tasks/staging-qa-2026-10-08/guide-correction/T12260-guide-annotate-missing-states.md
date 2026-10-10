# T12260: Guide in the play editor, after Done and every Annotate state

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

The whole coach is gated off by !showAnnotateOverlay (AnnotateModeView.jsx:714) and the 'Make this a highlight now?' card renders inside that overlay (:1044/1081/1207), so the play editor and the choice card have no guide (qa-09, qa-13); any selected play rated below 5 falls through to the 'watch' text (catalog.js:14-18). The B7 landing shows a guide 'Open the highlight to watch or share it' that points below the fold.

## Solution

Remove the blanket gate; render the guide inside the editor and the choice card. Rules and copy: annotate.watch 'Tap Play to watch the game. When your athlete does something great, tap Mark play.'; annotate.watch.playing 'See a great moment? Tap Mark play.'; annotate.has-plays 'You've marked {n} play/plays. Keep going, or tap a play to make it a highlight.'; annotate.editor 'Drag the green ends so the play starts and stops where you want. Pick how good it was, then tap Done.' (anchor Done, avoid timeline handles); annotate.choice 'Play added. Tap Make Highlight Now to turn it into a video you can share, or keep marking plays.' (avoid both buttons); annotate.selected.none/brilliant/framing/generating/ready/finished (e.g. 'Your highlight is ready. Tap it to add a spotlight or finish it.'); annotate.review 'Your plays, back to back. Tap Share plays to send them to your athlete.'; annotate.share; annotate.add-footage; annotate.expired 'This game's video has expired. Upload it again to mark more plays.' Delete catalog.js once T12230 subsumes it. 'athlete' vs 'player' per Q15.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/AnnotateModeView.jsx`
- `src/frontend/src/components/instructions/catalog.js`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- T12230, T12240. Decision Q15.

### Test first (red before green)

Enumeration rows for annotate.* (fail until added).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12260:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Enumeration covers about 15 Annotate states
- [ ] In the editor the guide's rect is disjoint from the timeline handles and from Done/Delete (Playwright)
- [ ] No guide copy contains 'Saved'
- [ ] Relevant tests pass and lint is clean
