# T12270: Job-aware guide for Focus and Overlay, and the ready panels

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

The Focus chain (FocusModeView.jsx:398-409) has no export input; export state lives in the ExportButton container (:111), so step 5 'click Generate highlight' stays up while generating and for the B5 window (qa-20, qa-21). The 'Your highlight is ready' panels (FocusScreen.jsx:1375-1403, Overlay showExportCompletePreview) render with no coach (qa-22, qa-30). Overlay generating has no guide (qa-29). Focus step 3 advances on a play-through (FocusModeView.jsx:363), not on a pause, so it advances by itself.

## Solution

Facts read exportStore.activeExports (same source Annotate uses via isFramingExportInProgress) and focusCompletionStore/showExportCompletePreview. Rules and copy: focus.drag 'Drag the box onto your athlete. Your highlight shows what's inside it.' (side of stage, never over the box); focus.play 'Tap Play and watch your athlete.'; focus.keep 'If your athlete leaves the box, pause and drag it back. The view moves smoothly between the spots you set.' (advance on pause); focus.preview 'Tap Preview highlight to see exactly what you'll share.'; focus.previewing 'Watch it through. Tap Back to full video to change anything.'; focus.generate 'Looks right? Tap Generate highlight.'; focus.credits [error] 'You need more credits to make this highlight. Tap Get credits.'; focus.progress.export [progress] 'Making your highlight. You can wait here or go mark more plays. We'll tell you when it's ready.'; focus.finishing [progress] 'Your highlight is done. Opening it now.'; focus.failed [error] 'Your highlight didn't finish. Tap Try again.'; focus.ready 'Your highlight is ready. Add a spotlight so people know which athlete is yours, or tap Finish without spotlight.' (anchor Add spotlight); overlay.progress [progress] 'Adding your spotlight. We'll show you when it's ready.'; overlay.failed; overlay.ready 'Looks good? Tap Finish to get your link.'. Render <Guide> inside the CollectionPlayer actionBar so the ready panels have it. Crop word per Q15.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/screens/FocusScreen.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- T12230, T12240; builds on T11970. Decision Q15.

### Test first (red before green)

Enumeration + the step-5 unit test (fail until added).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12270:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Enumeration includes processing, complete-before-preview, error and needCredits
- [ ] Unit: step 5 never resolves while job.status !== 'none'
- [ ] Both ready panels and Overlay generating show a guide
- [ ] Relevant tests pass and lint is clean
