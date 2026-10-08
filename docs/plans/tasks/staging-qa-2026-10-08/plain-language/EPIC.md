# Epic 2: Confusing moments and jargon

**Status:** TODO
**Milestone:** [Staging QA Walkthrough 2026-10-08](../README.md) (user-ordered TOP PRIORITY)
**Impact:** 8 | **Complexity:** 6
**Started:** 2026-10-08
**Knowledge docs:** `.claude/knowledge/annotate.md`, `.claude/references/ui-style-guide.md`

## Goal

Every label, heading, progress line and empty state is anchored to what the parent wants (a finished, shareable highlight of their player). One word per user goal (see the vocabulary table in the README). Guide-bubble sentences belong to the Guide epic.

## Source

[Walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) and screenshots. Decisions that gate tasks live in the [README decision register](../README.md#decision-register); until a decision is ruled the task text states the recommended option.

## Notes

Hard rules for every string: no em dashes, never 'Saved' as UI copy, never claim AI frames or tracks on its own, a play makes a clip and the finished product is a highlight. The spotlight picker vocabulary and bubble copy are owned by T12280 (Guide epic).

## Tasks

| ID | Task | Status |
|----|------|--------|
| T12110 | [Shipped-copy hygiene: em dashes, '--', 'Saved'](T12110-shipped-copy-hygiene.md) | TODO |
| T12120 | [Progress words a parent understands](T12120-progress-words-a-parent-understands.md) | TODO |
| T12130 | [Header mode tabs: no locked, unexplained steps](T12130-header-mode-tabs.md) | TODO |
| T12140 | [Rating scale: each option shows its own star count](T12140-rating-scale-display.md) | TODO |
| T12150 | [Play editor: tags and notes open above the Done bar](T12150-play-editor-details-above-done.md) | TODO |
| T12160 | [Sport: a labelled 'Pick sport' chip and a picker before tags](T12160-sport-picker-and-no-question-mark.md) | TODO |
| T12170 | ['My athlete / Team' and 'Play category' in plain words](T12170-play-category-wording.md) | TODO |
| T12180 | [Focus settings in plain labels](T12180-focus-settings-plain-labels.md) | TODO |
| T12190 | [Finished result: 'Link ready' only when there is a link](T12190-finished-link-state-honest.md) | TODO |
| T12200 | [Finished tab: the user's highlight first, locked gauges demoted](T12200-finished-tab-one-highlight-first.md) | TODO |
| T12210 | [Share modal: 'Who can watch' with the default visible](T12210-share-modal-who-can-watch.md) | TODO |
| T12220 | [Clips empty state copy and a lone game centred](T12220-clips-empty-state-and-lone-game.md) | TODO |

## Completion Criteria

- [ ] All tasks complete and each behaviour change has a test that failed first
- [ ] Walkthrough re-run (T12310) shows this epic's findings fixed
