# T12280: Spotlight picker: copy, structure and the X click-through bug

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q12,Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

SpotlightPickGuide.jsx:157-289 builds the copy with internal terms: 'player tracker', 'Frame n of 4', 'My player not boxed' (displayNames.js:791-815; inline strings :215, :253, :262); PICK_GUIDE_DONE 'The spotlight follows your player.' borders on a tracking claim; the done body auto-hides after 4 s and points at Play spotlight, which is below the fold, never at Generate; DoneBody (:210-217) puts three spans in one flex row inside a w-[26rem] pill so it wraps into two columns (qa-27); the pill passes pointer-events-none to InstructionCoach (:175) and the X has no pointer-events-auto (InstructionCoach.jsx:30), so clicking X falls through to the video and counts as a spotlight click. The 'Couldn't auto-detect your athlete' toast fires from useHighlightRegions.js:204-210 during auto-select, before any spotlight exists (qa-23), and implies AI auto-detection.

## Solution

Message comes from the resolver. Vocabulary: 'Frame n of 4' -> 'Moment n of 4'; 'tracker' -> 'spotlight'; panel heading 'Show which athlete is yours', body 'Click your athlete on the video.'; shape options 'Around player' / 'Under player' (Q15 ruled: athlete). Rules and copy: overlay.pick.first 'Tap your athlete. We'll show you a few moments so the spotlight stays on them. (1 of {n})'; overlay.pick.next 'Tap your athlete again. ({k+1} of {n})'; overlay.pick.at-marker 'Tap your athlete on this moment. ({k} of {n})'; overlay.pick.away '{m} moments still need a tap. Tap Next moment.'; overlay.pick.not-outlined 'Don't see your athlete outlined? Drag the circle onto them.'; overlay.pick.none 'Drag the circle onto your athlete.'; overlay.pick.done (persistent, no 4 s hide) 'Spotlight set. Tap Generate highlight. Tap Play first if you want to check it.' anchored on the Generate CTA; overlay.text 'Type a name, number or caption, then drag its ends on the timeline to set when it shows.' Placement per Q12 (recommended: an in-flow strip under the video at every width, so it can never cover the player). DoneBody becomes flex-col items-start. Add pointer-events-auto to the X. Stop firing the detection toast while the pick walk is active, or delete it. Strings move out of inline into displayNames. Expose atMarker from useGuidedAthletePick (needs T11980).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `src/frontend/src/modes/overlay/hooks/useGuidedAthletePick.js`
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/components/instructions/InstructionCoach.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- T11980, T12230, T12240. Decisions Q12, Q15. Supersedes the spotlight vocabulary parts of the plain-language epic.

### Test first (red before green)

RTL X-click-through test (fails today) and the enumeration rows.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12280:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Enumeration covers the 8 pick states including 'away at the marker' resolving to at-marker
- [ ] RTL: clicking the X does not reach the stage click handler
- [ ] No 'tracker', 'box' or 'frame N' in spotlight copy; done body is one column; no detection toast during the walk; no inline strings
- [ ] Relevant tests pass and lint is clean
