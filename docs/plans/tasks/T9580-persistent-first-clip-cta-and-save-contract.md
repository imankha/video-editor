# T9580: Persistent first-clip CTA and an explicit save-play contract

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-08, B2, N41 (handoff E4-01)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Saving a play does not clearly say what object was created. The invitation into framing arrives as a
**bottom-right toast that disappears** before a first-time parent decides to act - Andrew missed it.
Meanwhile the control that governs clip creation is a negative toggle (T9450), so Save's outcome is
unpredictable from the form.

The two audiences pull in opposite directions and the current design serves neither: a first-timer
needs to be led to a finished clip, and a repeat annotator needs to keep marking without being
yanked into an editor.

## Solution

- **Save play** persists the marker. That is the whole contract for the gesture.
- After the **first eligible saved play**, show a **persistent inline invitation**: primary
  *Frame this clip*, secondary *Keep marking plays*. It stays until used or dismissed - never a
  disappearing toast as the only path.
- *Frame this clip* creates or **reuses** the one editable clip for that play. Repeated clicks open
  the same clip, never a duplicate.
- Later saves do not steal focus or force navigation. After the first success, batch marking is the
  default posture, with a persistent finish-clips entry available (T9660).
- Dismissal preserves playhead position.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` - create/save path
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`, `ClipsSidePanel.jsx`
- `src/frontend/src/config/displayNames.js` - CTA copy constants

### Related Tasks
- **T9330** (TODO, high priority) already covers "clipping a play keeps the editor open, with a
  stage-aware CTA". **These overlap substantially. Read T9330 first** - this task may reduce to the
  persistence-of-the-CTA half, or the two should be merged before either starts.
- T9450 - the toggle polarity this contract replaces
- T9520 - the wording (N41: "Frame this clip" / "Keep marking plays")

### Technical Notes
Persistence rule: the clip is created by the *gesture*, not by a `useEffect` reacting to a saved
play. Reuse must be keyed on the play, so a double click cannot produce two clips.

## Acceptance Criteria

- [ ] Save play persists the marker and says which object it created
- [ ] The first-clip CTA persists until used or dismissed
- [ ] Repeating the action opens the same clip, never a duplicate
- [ ] A second play can be saved without forced navigation, with the playhead preserved
- [ ] Overlap with T9330 is resolved explicitly before implementation
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
