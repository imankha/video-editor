# Epic 1: Bugs

**Status:** TODO
**Milestone:** [Staging QA Walkthrough 2026-10-08](../README.md) (user-ordered TOP PRIORITY)
**Impact:** 8 | **Complexity:** 5
**Started:** 2026-10-08
**Knowledge docs:** `.claude/knowledge/annotate.md`, `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/export-pipeline.md`

## Goal

Every defect the walkthrough hit is fixed and has a test that failed first: overlapping floating controls, the stale highlight-ready handoff, silent spotlight taps, a debug label on staging, the viewer-close landing and a blob 404.

## Source

[Walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) and screenshots. Decisions that gate tasks live in the [README decision register](../README.md#decision-register); until a decision is ruled the task text states the recommended option.

## Notes

B1 (guide covers Upload game) is fixed by T12240 in the Guide epic. B3a/B3b (bottom bar wraps/covers video) are fixed by T12020 and T12030 in the CTA epic, because both rework the same bar. Do not fix them twice.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T11950 | [Corner controls (Guidance, Report, toasts) never cover content or each other](T11950-corner-controls-never-overlap.md) | TODO |
| T11960 | [Hide the crop debug label outside local dev](T11960-hide-crop-debug-label.md) | TODO |
| T11970 | [Highlight-ready handoff is consistent and fast](T11970-highlight-ready-handoff.md) | TODO |
| T11980 | [Spotlight walk: taps inside the circle and the 'Go to frame N' disagreement](T11980-spotlight-walk-taps.md) | TODO |
| T11990 | [Closing the finished-highlight viewer lands somewhere useful](T11990-finished-viewer-close-landing.md) | TODO |
| T12000 | [Blob URL revoked while a video still reads it](T12000-blob-url-revoked-too-early.md) | TODO |

## Completion Criteria

- [ ] All tasks complete and each behaviour change has a test that failed first
- [ ] Walkthrough re-run (T12310) shows this epic's findings fixed
