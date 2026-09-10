# Shared Vocabulary (2026-09-09 naming report)

**Status:** IN_PROGRESS
**Started:** 2026-09-10

## Goal

One object model and one set of labels across every user-visible surface, so a button, its success
toast, its destination heading and the tutorial all describe the same object at the same stage.

Source: the naming report (`03-naming-consistency.html`, groups **N01-N47**) from the 2026-09-09/10
parent walkthrough of staging. Handoff archive:
`C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`

## The object model (user-adopted 2026-09-10)

| Term | Definition |
|------|------------|
| **Game** | Uploaded source footage and its metadata |
| **Play** | A marked time range in a game, with rating, tags and notes |
| **Clip** | An editable video made from one play, with framing and effects |
| **Reel** | A video assembled from multiple clips |
| **Published** | A status and destination for clips or reels made available through sharing |
| **Spotlight** | The visual effect that identifies a player |
| **Framing** | The crop and position adjustments that keep the action visible |

## Scope decision (user, 2026-09-10)

The user adopted the **full report model** with **two explicit overrides**, and the overrides are
binding on every child:

1. **The editor mode names stay `AI Focus` and `Spotlight`.** T9320 renamed them on 2026-09-09
   (Focus -> AI Focus so the name says the reframing is automatic; Overlay -> Spotlight because
   every other string already said spotlight). The report's **N16** ("Frame player") and **N18**
   ("Effects") are **overridden**. Their other recommendations - Focus point as the parent-facing
   primitive noun, plain-word styling sliders - are adopted.
2. **Statuses are NOT re-modelled here.** T8470's Draft/Shared collapse (`draftStage.js` as single
   source) stands. **N22**'s four-state proposal is overridden; the contradiction cleanup lives in
   **T9600**, outside this epic.

Everything else in N01-N47 is in scope, including the ones that reverse earlier decisions:
**N05** (Add Play -> Mark play, reverses T8130), **N09** (Clip Out Play -> Create clip, reverses
T8760), **N10/N11** (drop "In Progress" from tab labels, reverses part of T8555). Those reversals
are deliberate; record them in each child's task file so the history reads as a decision rather than
drift.

## Standing rules for every child

- **Do not rename internal APIs, routes, store keys, component files or analytics vocabulary** to
  match UI text. Same split T7700 and T9320 already established: URL paths `/focus`, `/overlay`,
  `EDITOR_MODES.*`, `framing_exported` / `overlay_exported`, `FLOW_EVENTS` keys and admin column ids
  all stay. Deep links and greppability beat cosmetic consistency.
- **`src/frontend/src/config/displayNames.js` is the single source** for user-visible nouns and
  action labels. New strings go there, not inline.
- Visible text, **accessible names**, tooltips, toasts, guides, card menus, empty states and
  fullscreen all share the contract. A label fixed only in the visual layer is not fixed.
- Tests that assert old copy get **updated**, not deleted or worked around.
- Changing labels alone will not fix the Save/Create behavior mismatch - that is T9580's job, and
  this epic must not silently absorb it.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T9520 | [Annotate surface vocabulary](T9520-annotate-vocabulary.md) | TODO |
| T9530 | [Library tabs, objects and destinations](T9530-library-tabs-and-objects.md) | TODO |
| T9540 | [Render, job, progress and completion labels](T9540-render-and-job-labels.md) | TODO |
| T9550 | [Editor-stage inner strings](T9550-editor-stage-strings.md) | TODO |
| T9560 | [Onboarding guide, errors and landing vocabulary](T9560-guide-and-landing-vocabulary.md) | TODO |
| T9570 | [Cross-surface naming audit](T9570-cross-surface-naming-audit.md) | TODO |

Row order is execution order. T9570 closes the epic and must run last.

## Completion Criteria

- [ ] All six children complete
- [ ] A Clips menu never says "Delete reel"
- [ ] Every completion message identifies which stage finished
- [ ] All first-time guide labels match the actual controls
- [ ] No internal API, route, store key or analytics name was renamed for UI consistency
- [ ] All 47 naming groups are marked applied, overridden (with reason) or not-applicable in T9570
