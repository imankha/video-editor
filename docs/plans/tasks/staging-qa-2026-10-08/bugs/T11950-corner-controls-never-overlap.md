# T11950: Corner controls (Guidance, Report, toasts) never cover content or each other

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q4 (see [decision register](../README.md#decision-register)). Implement the option the user ruled; the text below states the recommended option.

## Problem

Three bottom-right layers are pinned independently: GuidanceToggle (fixed bottom-32 right-4 z-[9999], GuidanceToggle.jsx:13), GlobalReportButton (main.jsx:68, bottom-20 z-[9999]) and ToastContainer (Toast.jsx:166, bottom-4 z-[100]). Toasts grow upward underneath two z-9999 layers, so 'Highlight ready' is hidden behind the Guidance pill (qa-23) and Report draws over toasts (qa-32). The Guidance pill also sits on content: the right end of 'Make Highlight Now' (qa-13), the 'Add footage' card (qa-08) and 'Effects are free' text (qa-28). At least seven independent fixed elements live in that corner (also GlobalExportIndicator, SyncStatusIndicator, UploadProgressIndicator, FocusCompletionRecovery, UpdateGateModal).

## Solution

Per decision Q4 (README): recommended is a small 'Guide On/Off' chip in the top bar beside credits and the account icon (UnifiedHeader on editor screens, ProjectManager header on Home), and the corner holds one fixed flex-col-reverse stack where toasts sit above the Report button so they cannot overlap. Use Z constants (constants/zLayers.js) instead of z-[9999]. If the user picks the floating-stack option instead, mount one FloatingDock at app root and expose --cta-bar-h (set by CtaBar, T12010) so the dock rides above any bottom bar. Toggle still saves through the same setCoachEnabled gesture.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/main.jsx`
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`
- `src/frontend/src/components/shared/Toast.jsx`
- `src/frontend/src/components/shared/UnifiedHeader.jsx`
- `src/frontend/src/components/ProjectManager.jsx`
- `src/frontend/src/components/instructions/guidance.test.jsx`

### Related Tasks

- Decision Q4. Land before T12240 (placement avoids these controls).

### Test first (red before green)

Playwright geometry spec: mount the 'Make this a highlight now?' card and assert [data-testid=guidance-toggle] does not intersect the CTA; push a toast and assert it does not intersect the report button. Both fail today.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T11950:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] At 1646x1188 on Home, Annotate after Done, Focus and Overlay no corner control's box intersects any button, card or status text
- [ ] A toast's box never intersects the Report button or the Guidance control, and a toast is visible with Guidance On
- [ ] Below 640px the Guidance control is at least 44x44 and does not overlap a CTA bar
- [ ] Guidance on/off still saves through the same setCoachEnabled click (no new write path)
- [ ] Relevant tests pass and lint is clean
