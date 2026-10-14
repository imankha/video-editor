# T12790: A guide step everywhere a user opens something

**Status:** STAGING (PR #606, merged 2026-10-14)

Found on staging 2026-10-14: opening a game whose upload was still running showed no guide. An audit found the same gap elsewhere.

## What shipped
- Annotate: reopening an uploading game keeps its game id, so the guide is no longer held for the whole upload.
- Overlay: no detected athletes shows "Drag the circle onto your athlete."; Add text uses the `overlay.text` rule.
- Home: a failed games fetch shows a Retry guide; Clips and Finished keep theirs.
- Focus: video load failure guide; fullscreen shows the step in a compact strip and points to Exit fullscreen when the next control is hidden.
- Landscape cockpit (iPhone): drag, Preview, Generate and export states in a compact strip at the foot of the stage.
- 20 dialogs: one inline sentence each (`screen: 'modal'` rules) and a pulse on the main action.

## Acceptance (staging, Guidance on)
- [ ] Open a game that is still uploading: the Annotate guide shows and Mark Play pulses.
- [ ] iPhone landscape, a clip in Focus: the strip walks drag, Preview, Generate without covering the athlete.
- [ ] Desktop Focus fullscreen: the strip shows at the top; with a finished or failed export it points to Exit fullscreen.
- [ ] Open a few dialogs (share, buy credits, edit game): each shows its sentence and pulses its main button.

Knowledge: `.claude/knowledge/guidance.md` (Dialogs, Full-bleed editors).
