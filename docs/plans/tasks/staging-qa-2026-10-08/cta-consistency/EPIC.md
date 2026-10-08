# Epic 3: Styling and CTA consistency

**Status:** TODO
**Milestone:** [Staging QA Walkthrough 2026-10-08](../README.md) (user-ordered TOP PRIORITY)
**Impact:** 8 | **Complexity:** 6
**Started:** 2026-10-08
**Knowledge docs:** `.claude/references/ui-style-guide.md`, `.claude/references/coding-standards.md`, `.claude/knowledge/annotate.md`, `.claude/knowledge/keyframes-framing.md`

## Goal

Every page has the same bottom action look and the main CTA is first, left on desktop and top on mobile. One primary colour. Floating controls never overlap a CTA bar.

## Source

[Walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) and screenshots. Decisions that gate tasks live in the [README decision register](../README.md#decision-register); until a decision is ruled the task text states the recommended option.

## Notes

Recent commits 31b50fab5, 3662653a0, f69d2f47f, c6e6708fa made every CTA the same cyan ActionCard. That fixed shape but removed hierarchy: PrimaryCta ignores its accent prop in full mode (components/PrimaryCta.jsx:73-77). Extend ActionCard/ActionBand/PrimaryCta/Button; do not build a parallel system. Branch CI does not run Playwright, so e2e/cta-consistency.spec.js must be run locally in every task.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T12010 | [CtaBar component, ActionCard variants and the cross-screen spec](T12010-ctabar-component-and-spec.md) | TODO |
| T12020 | [Focus bar on CtaBar: Generate first, preview row never wraps](T12020-focus-band-on-ctabar.md) | TODO |
| T12030 | [Overlay bar on CtaBar: Add text inside the bar, nothing collides](T12030-overlay-band-on-ctabar.md) | TODO |
| T12040 | [Annotate cards: Mark play is primary, Review plays keeps its lock cues](T12040-annotate-cards-primacy.md) | TODO |
| T12050 | ['Make this a highlight now?' card on CtaBar, one primary colour](T12050-post-done-choice-card.md) | TODO |
| T12060 | [Both 'Your highlight is ready' panels on one CtaBar panel](T12060-ready-panels-on-ctabar.md) | TODO |
| T12070 | [Play editor footer: Done first, Delete last, one component](T12070-play-editor-footer.md) | TODO |
| T12080 | [Modal footers: primary first, one colour](T12080-modal-footers-primary-first.md) | TODO |
| T12090 | [Empty states and Finished card actions on the shared look](T12090-empty-states-and-finished-card-actions.md) | TODO |
| T12100 | [Tab badges, tab grid and the Overlay rail tab wrap](T12100-tab-badges-grid-rail-wrap.md) | TODO |

## Completion Criteria

- [ ] All tasks complete and each behaviour change has a test that failed first
- [ ] Walkthrough re-run (T12310) shows this epic's findings fixed
