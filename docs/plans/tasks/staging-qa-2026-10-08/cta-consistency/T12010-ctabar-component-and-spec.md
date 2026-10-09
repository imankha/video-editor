# T12010: CtaBar component, ActionCard variants and the cross-screen spec

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q1,Q2,Q3 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

No component controls CTA order or hierarchy. ActionCard/ActionBand/PrimaryCta/Button exist but PrimaryCta ignores its accent prop in full mode (components/PrimaryCta.jsx:73-77), so Generate looks the same as Trim and Preview, and Mark play the same as Review/Share/Add footage; only the coach pulse marks the main action and it vanishes with Guidance Off. This breaks the T9270 rule 'one saturated element per screen, and it is the CTA'. Two style guides disagree: .claude/references/ui-style-guide.md says primary blue-600, src/frontend/src/STYLE_GUIDE.md:10,17 and components/shared/Button.jsx:55-59 say purple-600, while the app ships cyan cards, solid cyan, gold, green and purple.

## Solution

New components/shared/CtaBar.jsx plus a variant prop on ActionCard; PrimaryCta becomes a thin wrapper (ActionCard variant=primary, keeps data-testid=primary-cta; compact mode unchanged). API: <CtaBar layout='band|panel|modal|inline' primary={{icon,title,description,onClick,disabled,lockedReason,loading,testId,pulse}} secondary={[...]} destructive={{...,confirm:true}} exit={{title,onClick}} status cost />. Named slots make the order structural: primary is the first DOM child and first visual position (left on desktop, top on mobile), then secondaries, then destructive, then exit. Every action gets data-cta-role=primary|secondary|destructive|exit; container data-testid=cta-bar. Variants and exact classes depend on decisions Q1 (row shape), Q2 (colour) and Q3 (destructive placement); recommended: solid cyan-500 fill with slate-950 text for primary (bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 font-bold rounded-xl shadow-lg shadow-cyan-950/40), tinted card for secondary (border-cyan-400/50 gradient from-cyan-500/20), ghost destructive (text-red-300 border-white/10), ghost exit (h-11). Locked items of any variant: aria-disabled (never the disabled attribute), Lock icon, no border, text-gray-400, tap shows the lockedReason toast. Card anatomy fixes icon alignment: icon disc always h-11 w-11, title whitespace-nowrap, description line-clamp-2 min-h-[2lh]. Desktop grid: minmax(0,1.4fr) repeat(N,minmax(0,1fr)) so the primary is widest and leftmost; mobile: primary full width on top (min-h-14), secondaries in a grid-cols-2 row. CtaBar (band/panel) sets --cta-bar-h on documentElement via ResizeObserver in useLayoutEffect and clears it on unmount (view-only, never persisted). Also: make .claude/references/ui-style-guide.md the only guide (new 'CTA bar' section replacing the T9270 colour line; delete or redirect src/frontend/src/STYLE_GUIDE.md per the README default).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/shared/CtaBar.jsx (new)`
- `src/frontend/src/components/shared/ActionCard.jsx`
- `src/frontend/src/components/PrimaryCta.jsx`
- `src/frontend/src/components/shared/Button.jsx (only if Q2 repoints primary)`
- `.claude/references/ui-style-guide.md`
- `src/frontend/src/STYLE_GUIDE.md`
- `src/frontend/e2e/cta-consistency.spec.js (new)`

### Related Tasks

- Decisions Q1, Q2, Q3 (and Q18 for modals). Blocks T12020-T12100.

### Test first (red before green)

Write the unit test and the spec harness first; they fail because CtaBar does not exist.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12010:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Unit: primary renders first and there is exactly one data-cta-role=primary whatever the prop order
- [ ] Unit: locked items carry aria-disabled, a Lock icon and a toast; all cards in a row share the disc size
- [ ] e2e/cta-consistency.spec.js table-driven assertCtaBar(page): bar exists, first role is primary, single primary, primary leftmost at 1440 and topmost at 390, no horizontal overflow at 320-768; later tasks add their screens
- [ ] primary-cta testid preserved
- [ ] ui-style-guide.md is the single guide
- [ ] Relevant tests pass and lint is clean
