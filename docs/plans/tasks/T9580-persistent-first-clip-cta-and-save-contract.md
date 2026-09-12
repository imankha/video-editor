# T9580: Persistent first-clip CTA and an explicit save-play contract

**Status:** WIP
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

## Overlap Resolution (T9330) — investigation, written BEFORE implementation

Live-read of the shipped code (T9330 merged, STAGING) plus a full grep for the N41 strings.
**Verdict: T9330 already delivers ~90% of this task's mechanism; the genuine delta is wording +
one dismiss affordance. No new state machinery is needed, so this stays M-tier.** Details:

### What T9330 already provides (verified against code, not assumed)

| T9580 ask | Already covered by T9330? | Evidence |
|-----------|---------------------------|----------|
| Save play persists the marker | **Yes** | `handleFullscreenCreateClip` (`AnnotateContainer.jsx:1234`) adds the region then `saveClip`s it; T9450 gave the toggle positive polarity. |
| Says which object it created | **Yes (create path)** | On `project_created`, `notifyReelCreated` -> toast `"{name} is now in Clips"` (`announceReelCreated:93`). Bare-play save (no clip) toasts `"Saved to your library"` — confirms persistence but does not name the object; tightened to name the play in this task. |
| Persistent inline invitation, not only a disappearing toast | **Yes (desktop)** | After a create the editor STAYS OPEN on the new clip (`onCreateSelect -> editClip`, CREATING->EDITING) and renders a **full-width primary stage CTA** (`stageCta`, `AnnotateFullscreenOverlay.jsx:715`) that persists in the open editor until closed/navigated. The 6s toast is additive, never the only path. |
| Reuse — repeated action opens the SAME clip, never a duplicate | **Yes** | The clip's project is created once by the Save gesture and its id stored on the region (`setAutoProjectId`). The CTA calls `onOpenInFocus(existingClip.autoProjectId)` — it navigates to the existing project; it never re-creates. `pendingProjectClipId` also guards the in-flight window. |
| Second play saved without forced navigation, playhead preserved | **Yes** | Desktop strip stays open (`handleOverlayResumePlayback` plays without closing); `Mark play` stays reachable. |
| Dismissal preserves playhead | **Yes (mechanically)** | `onClose -> closeOverlay` (`useClipSelection.js:52`) is a pure state transition (EDITING->SELECTED) with **no seek**, so the playhead is untouched. |

### The genuine delta (what is NOT already there)

1. **N41 wording does not exist anywhere.** `grep -rn "Frame this clip\|Keep marking"` over
   `src/` returns nothing. The kickoff's premise that "T9520 already renamed these per N41" is
   **false** — T9520 shipped naming groups N04-N35, not N41. So this task, which carries handoff
   item N41, is the place that introduces `"Frame this clip"` / `"Keep marking plays"`.
2. **No secondary "Keep marking plays" affordance** paired with the primary CTA — the invitation
   currently reads as a single button, not the intended two-choice prompt. (A generic `Cancel`
   exists in the controls row, but that is an edit-cancel, not the invitation's dismiss.)

### Design decision (kept small, single-vocabulary)

- The persistent invitation **is** T9330's existing full-width stage CTA. Per the kickoff directive
  ("wire N41's exact wording onto the existing CTA"), the **FOCUS-stage** label in the shared
  `getClipStage` helper becomes **"Frame this clip"** (single source, so the desktop strip and the
  sidebar stay unified — the one-vocabulary principle T9330 established). Later stages
  (Spotlight / Final / Published) keep their T9320/T9330 user-decided labels unchanged.
  Authorization for the rename is handoff item **N41**, which this task owns.
- The confirm-dialog `openStageName` is decoupled from the button label (derived from
  `clipStage.stage`, not by stripping an "Apply/View" prefix) so the dialog copy stays correct
  ("...then open AI Focus") after the FOCUS label changes.
- A **"Keep marking plays"** secondary is added beside the primary CTA in the editor invitation
  (FOCUS stage, edit mode) and wired to `onClose` (dismiss -> `closeOverlay`, playhead preserved).
- No persistence change: every write still traces to the Save gesture; no `useEffect` reacts to a
  saved play. Reuse continues to key on the region's `autoProjectId`.

### Explicitly out of scope (noted, not built)

- **Mobile CREATE-then-close.** T9330 deliberately keeps mobile create closing on save (the
  persistent in-editor CTA is desktop-strip + mobile EDIT only). The walkthrough was a desktop
  browser; expanding the invitation to the mobile create path is T9330-owed follow-up, not this
  task. The mobile EDIT sheet already shares `stageCta`, so it inherits the N41 label automatically.

## Acceptance Criteria

- [ ] Save play persists the marker and says which object it created
- [ ] The first-clip CTA persists until used or dismissed
- [ ] Repeating the action opens the same clip, never a duplicate
- [ ] A second play can be saved without forced navigation, with the playhead preserved
- [ ] Overlap with T9330 is resolved explicitly before implementation
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
