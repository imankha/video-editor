# T9450: "Don't Clip Play" negative toggle and "saved to your library" on an unsaved form

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B2, N07, UX-07 (handoff E4-01 partial, E4-05 partial)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Verified in code 2026-09-10, `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`:

- **:831** renders the toggle label as `createProject ? 'Clip Play to focus on your player' : "Don't Clip Play"`.
  The off state is phrased as a **negative** ("Don't Clip Play"), so the parent has to reason about
  a double negative to work out what unchecking does.
- **:824** the toggle's `title` is still **"Auto-create a reel from this play"** - stale vocabulary
  ("reel") from before the Clip Out Play rename, and it describes a different behavior than the
  label directly beside it.
- The unsaved form shows **"saved to your library"** next to Save, before anything is persisted.

The walkthrough hit this on both plays it saved. The tutorial and the form disagreed about what the
control does, which is why the parent could not predict the outcome of Save.

## Solution

- Phrase the toggle positively and make its default, its label and its behavior agree.
- Delete or rewrite the stale `title` so it describes the same action as the label.
- Move the storage claim out of the pre-save form. Show a saved confirmation only after persistence
  succeeds; a failure retains the edits.

Exact wording is owned by **T9520** (Annotate vocabulary child of the naming epic). If T9520 lands
first, this task is the behavior and polarity half only.

## Context

### Relevant Files
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx:804-831`
- `src/modes/annotate/components/AnnotateFullscreenOverlay.stripLayout.test.jsx:84-102` - asserts the
  current "Don't Clip Play" string; must be updated with the rename, not around it
- `src/frontend/src/components/shared/clipConstants.js` - rating captions (T9320 touched these)

### Related Tasks
- T9520 owns the replacement wording; T9630 owns the wider rating/tags/notes cleanup
- T9580 owns the save-play contract this toggle sits inside

### Technical Notes
Small and self-contained, but it touches a test that asserts the old copy. S/M tier.

## Acceptance Criteria

- [ ] The toggle reads positively in both states and its default matches its behavior
- [ ] No control's tooltip describes a different action than its own label
- [ ] An unsaved form never claims the play is saved
- [ ] The stripLayout test is updated to the new copy rather than deleted
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
