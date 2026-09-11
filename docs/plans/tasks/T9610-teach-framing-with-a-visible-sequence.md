# T9610: Teach framing with a visible sequence and a preview before a paid render

**Status:** STAGING
**Investigation (T9610, 2026-09-11):** the movement preview ALREADY EXISTS as ordinary
playback — `FocusScreen.jsx` computes `currentCropState = dragCrop || interpolateCrop(currentTime)`
(memoized on `currentTime`), the `CropOverlay` reticule renders it over the video, and
`useVideo.js`'s rAF loop advances `currentTime` ~60fps during playback, so the crop box smoothly
follows the `interpolateCropSpline` path between focus points as the clip plays. Gap was prominence
only (nothing told a parent to press play and watch). Fix stayed M-tier: a prompt, no new machinery.
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-09, N17 (handoff E5-01)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

The framing screen says *"Set crop keyframes so the focus follows your athlete"*. **Keyframe**
assumes video-editing knowledge. A parent expects to identify their child, not configure a timeline.
Aspect-ratio choices show as bare `9:16` / `16:9`, and speed is presented as an action (`0.5x`)
rather than a current setting.

## Solution

- Visible three-step instruction: **move the box around your player -> move forward in the video ->
  adjust it again**. Show it until the first framing success; let experienced users collapse it.
- One noun for the primitive: **Focus point** in parent-facing text (keyframe may stay in advanced
  help). Owned jointly with T9550.
- Explain manual focus points separately from any automatic following, so the capability is not
  over- or under-claimed.
- **Preview the resulting movement before a paid render.** This is the substantive half: parents
  currently pay to find out whether their framing worked.
- Descriptive aspect labels: **Portrait (9:16)** / **Landscape (16:9)**, visible rather than hidden
  in help. Show current speed as a state.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx` and its settings panel
- Focus keyframe/spline logic - see `.claude/knowledge/keyframes-framing.md` before exploring
- `src/frontend/src/config/displayNames.js`

### Related Tasks
- T9550 - the framing vocabulary child (mode name stays **AI Focus** per user decision 2026-09-10)
- T9620 - the same pattern for spotlight
- T9700 - persistence verification for both

### Technical Notes
Mode name is settled: **AI Focus**, not "Frame player". T9320 renamed it on 2026-09-09 to say the
reframing is automatic, and the user reaffirmed it. The report's N16 recommendation is overridden;
its instruction-sequence and Focus-point recommendations are adopted.

## Acceptance Criteria

- [ ] A novice can create two focus points without hover help
- [ ] A preview shows the resulting movement before any paid render
- [ ] Portrait and Landscape labels stay visible, not hidden in help
- [ ] Current speed reads as a setting, not an action
- [ ] Parent-facing text uses one noun for the primitive
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
