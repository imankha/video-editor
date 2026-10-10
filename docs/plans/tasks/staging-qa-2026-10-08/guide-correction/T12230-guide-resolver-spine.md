# T12230: Guide resolver spine and copy table (behaviour-preserving)

**Status:** STAGING
**Impact:** 9
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q5,Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

No single source of truth: five derivations (see EPIC.md). Hosts: FloatingCoach.jsx (portal, hardcoded z-[110]) and InstructionCoach.jsx (role=status bubble; its X calls setCoachEnabled(false) globally, matching the 2026-09-17 T7630 ruling). annotateCoachModel branches only on region.rating === 5 (instructions/catalog.js:14) so any play below 5 falls through to the 'watch' text. Focus steps are a ternary chain over ephemeral flags (FocusModeView.jsx:338-409).

## Solution

New components/instructions/resolveGuide.js (pure, no React): resolveGuide(facts) -> {id, message, anchor, avoid[], pulse, tone} | null, one ordered rule array, first match wins; order within a screen: error, job in progress, modal, lowest incomplete step; rule ids follow T7620 naming (e.g. focus.progress.export). Export GUIDE_STATES, the enumerable fixture facts per state. All copy lives in a GUIDE block in config/displayNames.js (T9550 single-source rule); ANNOTATE_COACH, FRAMING_GUIDE.STEP_* and PICK_GUIDE_* move into it or are retired. Facts shape (built in render, never stored): screen (home.games, home.clips, home.finished, upload, annotate, annotate.editor, annotate.choice, annotate.review, focus, focus.ready, overlay, overlay.ready, finished.viewer, share), modal, job {status none|processing|complete|error, kind} from exportStore.activeExports filtered by projectId plus previewOpen, progress {games, plays, selectedPlay{rating, highlightAction}, unfinishedClips, finished, shared, credits, needCredits}, local {existing ephemeral flags}. A <Guide facts> component (about 20 lines) wraps resolveGuide + FloatingCoach + InstructionCoach and replaces each screen's inline mount; pulses read guide.pulse so pulse and message can never disagree; one guide per screen. Migrate Annotate and Focus first (existing states only). Copy per the table in EPIC.md. Crop-rectangle word: 'box' and the child is 'your athlete' (Q15 ruled 2026-10-08 = C).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js (new)`
- `src/frontend/src/config/displayNames.js (GUIDE block)`
- `src/frontend/src/components/instructions/catalog.js`
- `src/frontend/src/modes/AnnotateModeView.jsx`
- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/components/instructions/resolveGuide.states.test.js (new)`

### Related Tasks

- Decisions Q5 and Q15 (both ruled 2026-10-08). Blocks T12240-T12290.

### Test first (red before green)

The enumeration test with the existing states: it fails first because resolveGuide does not exist.

### Technical Notes

Opus design done (see EPIC.md). Escalate to the expert agent only if the facts shape fights the existing stores.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12230:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] State-enumeration test: every reachable state resolves to exactly one rule or an explicit documented null; no rule is shadowed by an earlier one
- [ ] Banned-copy regex passes: no em dash, 'tracker', 'frame N of', 'keyframe', 'automatically (frames|tracks|follows)'; every anchor/avoid selector literal exists in src (grep test)
- [ ] guidance.test.jsx stays green
- [ ] Focus copy calls the draggable rectangle 'box' and the child 'athlete' (Q15 = C)
- [ ] Relevant tests pass and lint is clean
