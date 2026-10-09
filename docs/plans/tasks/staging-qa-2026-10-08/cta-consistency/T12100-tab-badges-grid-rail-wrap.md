# T12100: Tab badges, tab grid and the Overlay rail tab wrap

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Home tab badges: bg-gray-700 inactive and the tab's own dark colour when active (Finished goes orange); hidden at count 0; the counts mean different things (Games total, Clips drafts, Finished unseen) (ProjectManager.jsx:496-549, :1580-1615). grid-cols-4 with three tabs leaves an empty quarter below sm. Overlay rail tab 'Cover image' wraps to two lines (settings/SettingsRail.jsx:89, no whitespace-nowrap).

## Solution

One badge style: ml-1 min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums; inactive bg-white/10 text-gray-200, active bg-black/25 text-white. Every tab shows its total including 0; 'new' on Finished becomes a separate h-2 w-2 bg-cyan-400 dot with aria-label='new'. Tab grid grid-cols-3. Add whitespace-nowrap (truncate fallback) to rail tabs.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ProjectManager.jsx`
- `src/frontend/src/components/settings/SettingsRail.jsx`

### Related Tasks

- None (independent).

### Test first (red before green)

Unit: all three tab badges share a class set and Clips renders 0 (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12100:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Badge style identical on all tabs; Clips shows 0
- [ ] Finished shows its total plus a separate new dot
- [ ] 'Cover image' on one line at a 380px rail
- [ ] Relevant tests pass and lint is clean
