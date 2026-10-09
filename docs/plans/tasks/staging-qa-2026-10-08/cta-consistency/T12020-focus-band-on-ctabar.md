# T12020: Focus bar on CtaBar: Generate first, preview row never wraps

**Status:** WIP
**Impact:** 9
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Focus band: Trim, Preview, Generate in sm:grid-cols-3, main last on desktop and mobile (contradicts ActionBand's own comment 'CTA first on mobile', ActionBand.jsx:19); Generate has no distinct style (qa-15). Focus preview (B3a, qa-19): FramingActionRow.jsx:63-67 puts a col-span-2 disclosure span between Preview and the CTA inside the 3-column grid, pushing Generate to row 2; Preview's caption is hardcoded 'Check the framing before generating.' in both states (FramingActionRow.jsx:56) so 'Back to full video' carries a stale subtitle. The bar is sticky bottom-0 (FocusModeView.jsx:1041) and the stage height (lg:h-[70vh]) ignores the bar height, so the bar covers the bottom of the preview video.

## Solution

Migrate ActionBand's above path, ExportButtonView.jsx:303-334 and FramingActionRow to CtaBar band: Generate highlight primary and first, Trim and Preview secondaries; the preview disclosure moves below the row (order-last sm:col-span-3, no wrap); Preview caption becomes state-aware via a displayNames key ('Return to dragging the box.' wording per Q15); compact-locked row unchanged; cap the stage at calc(100dvh - top offset - controls - var(--cta-bar-h)) so the video and its controls are never under the bar. Landscape-phone ActionRail (focus/cockpit/ActionRail.jsx:87-110) is a sanctioned exception.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ActionBand.jsx`
- `src/frontend/src/components/ExportButtonView.jsx`
- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/modes/focus/FramingActionRow.test.jsx`
- `src/frontend/src/components/ActionBand.test.jsx`

### Related Tasks

- T12010. Run before T12030 (same ExportButtonView).

### Test first (red before green)

Playwright: Focus preview on, assert Generate's top equals the Trim tile's top. Unit: FramingActionRow previewing does not show 'Check the framing before generating.'. Both fail today.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12020:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] At 1646x1188 Focus and Focus preview show Generate first, then Trim and Preview, on one row; the disclosure line is under them
- [ ] Preview caption matches its label in both states
- [ ] The video's bottom edge and its controls sit above the bar's top edge
- [ ] T4880 reachability spec still passes; Focus added to cta-consistency.spec.js
- [ ] Relevant tests pass and lint is clean
