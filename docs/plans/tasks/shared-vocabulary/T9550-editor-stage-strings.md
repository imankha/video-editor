# T9550: Editor-stage inner strings: focus points, spotlight styling, aspect, cover

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N16-N18, N27, N29-N32, N36 (handoff E1-03)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

Inside the two editor stages the vocabulary assumes video-editing knowledge ("crop keyframes",
"Stroke Width", "Fill", "Outside Dim", "Shape Body ellipse") and mixes brand terms with generic ones
("Highlight Color" for what everything else calls a spotlight). Aspect ratios show as bare numbers.

## Rename table

| Group | Observed | Becomes |
|-------|----------|---------|
| N16 | Focus / Crop, trim & speed / Focus Settings | **AI Focus** stays as the mode name (override); the panel gets a descriptive subtitle |
| N17 | crop keyframes / focus point / crop layer | **Focus point** in parent-facing text; **Framing timeline** for the track (keyframe stays in advanced help) |
| N18 | Overlay / Highlights & effects | **Spotlight** stays as the mode name (override); section headings describe their own contents |
| N27 | athlete / player / child / My Athlete | **player** / **My player** (child may remain in parent-facing prose) |
| N29 | Highlight Color / Shape Body ellipse / Body / Ground | **Spotlight color** / **Around player** / **Under player** |
| N30 | Stroke Width / Fill / Outside Dim | **Outline thickness** / **Spotlight fill** / **Dim background** (show percentages, live preview) |
| N31 | Thumbnail / Thumbnail marker | **Cover image** / **Choose cover frame** (helper: the still people see before playing) |
| N32 | 9:16 / 16:9 | **Portrait (9:16)** / **Landscape (16:9)**, descriptive words visible |
| N36 | mixed time formats | one format rule - **implemented by T9480**, referenced here only |

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx` and its settings panel
- `src/frontend/src/modes/OverlayModeView.jsx`, spotlight settings, `SettingsRail` (T9270)
- `src/frontend/src/components/overlay/ThumbnailPanel.jsx`, `TextManagementPanel.jsx`
- `src/frontend/src/config/displayNames.js`
- `.claude/knowledge/keyframes-framing.md` - read before touching keyframe vocabulary

### Related Tasks
- T9610, T9620 - the instructional redesigns that will use these words
- T9480 - owns the time-format rule (N36); do not duplicate it here
- T9385 - a pending test regression against `SettingsRail`'s new tab structure; land or account for
  it before sweeping strings in that component

### Technical Notes
"Keyframe" is not banned - it is demoted to advanced help. Do not rename the store keys or the
spline logic; only parent-facing text.

## Acceptance Criteria

- [ ] Parent-facing text uses one noun per primitive; keyframe appears only in advanced help
- [ ] Spotlight styling controls read in plain words with visible percentages
- [ ] Aspect ratios show descriptive words alongside the numbers
- [ ] Mode names AI Focus and Spotlight are unchanged
- [ ] No store key, spline or component file was renamed
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
