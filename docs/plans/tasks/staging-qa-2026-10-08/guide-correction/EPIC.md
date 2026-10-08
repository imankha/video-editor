# Epic 4: Guide correction

**Status:** TODO
**Milestone:** [Staging QA Walkthrough 2026-10-08](../README.md) (user-ordered TOP PRIORITY)
**Impact:** 9 | **Complexity:** 6
**Started:** 2026-10-08
**Knowledge docs:** `.claude/knowledge/annotate.md`; design doc `docs/plans/tasks/T7620-design.md` section 6 (GUIDANCE_MAP + resolveGuidance(facts))

## Goal

With Guidance on, every screen and modal state shows exactly one correct, plain-language sentence that moves the user toward exporting a finished highlight, placed where it never covers the primary CTA or the area the user must click.

## Source

[Walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) and screenshots. Decisions that gate tasks live in the [README decision register](../README.md#decision-register); until a decision is ruled the task text states the recommended option.

## Notes

Today there are five separate guide derivations (EmptyTabGuide hardcoded string, annotateCoachModel in catalog.js, a FocusModeView ternary chain, SpotlightPickGuide, an ad-hoc overlay-text div). None sees modals, export jobs, the ready/finished player layers or other home tabs. The fix is one pure resolver plus one copy table that every screen feeds a facts object, shaped as the spine T7630 will extend. Not a rewrite.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T12230 | [Guide resolver spine and copy table (behaviour-preserving)](T12230-guide-resolver-spine.md) | TODO |
| T12240 | [Guide placement: avoid-list, side candidates, docked fallback](T12240-guide-placement-avoid-list.md) | TODO |
| T12250 | [Guide on Home, Upload modal, Clips and Finished](T12250-guide-home-upload-clips-finished.md) | TODO |
| T12260 | [Guide in the play editor, after Done and every Annotate state](T12260-guide-annotate-missing-states.md) | TODO |
| T12270 | [Job-aware guide for Focus and Overlay, and the ready panels](T12270-guide-job-aware-focus-overlay.md) | TODO |
| T12280 | [Spotlight picker: copy, structure and the X click-through bug](T12280-guide-spotlight-pick.md) | TODO |
| T12290 | [Guide in the finished viewer and share; closing the guide never fails silently](T12290-guide-finished-viewer-share-and-x-failure.md) | TODO |
| T12300 | [Guidance default: on until the first export](T12300-guidance-default-until-first-export.md) | TODO |

## Completion Criteria

- [ ] All tasks complete and each behaviour change has a test that failed first
- [ ] Walkthrough re-run (T12310) shows this epic's findings fixed
