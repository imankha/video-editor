# T10850: Rotation hints — nudge in portrait, orient on first landscape entry

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-21
**Updated:** 2026-09-21
**Epic:** [focus-landscape](EPIC.md) — 3 of 3
**Design:** [T10840-design.md](T10840-design.md) decision D14
**Mockup:** https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx (artboards "Portrait - the nudge to rotate" and "First entry - the landscape hint")

## Problem

T10840 makes landscape Focus much better, but two discovery gaps remain:

1. **Most users never rotate.** The cockpit only helps people who happen to turn the phone. The
   portrait screen must tell them the better orientation exists — this is the hint that actually
   drives adoption.
2. **Arriving in the cockpit is disorienting.** Playback moved to the left edge, the CTA moved to
   the right edge, and the familiar bottom action band is gone. Without a word of explanation, the
   first reaction is "where did everything go".

## Solution

Two small, dismissible hints, one on each side of the flip.

| Hint | What | Shown when | Dismissed by |
|---|---|---|---|
| **Portrait nudge** | A slim bar directly under the stage: rotate icon, "Turn sideways for a bigger frame" / "Twice the crop area, and nothing scrolls", 44 px X | `isMobile && !isLandscape && !dismissed && the clip has no crop keyframes yet` | the X tap |
| **First-entry card** | A card over the stage: "More room in landscape", one line on what moved, "Got it". Plus a one-shot ring on the play button and the CTA so the eye finds them | `cockpit && !seen` | the "Got it" tap, **or** the first `pointerdown` on the stage |

Placement matters: the nudge sits **directly under the stage**, where the eye lands right after
seeing how small the crop box is — not in a header, not as a toast.

## Context

### Relevant Files (REQUIRED)

**New**
- `src/frontend/src/modes/focus/RotateNudge.jsx`
- `src/frontend/src/modes/focus/cockpit/CockpitIntroCard.jsx`
- `src/frontend/src/modes/focus/__tests__/RotateNudge.test.jsx`
- `src/frontend/src/modes/focus/cockpit/__tests__/CockpitIntroCard.test.jsx`

**Modified**
- `src/frontend/src/modes/FocusModeView.jsx` — mount `<RotateNudge/>` under the stage in the
  portrait path
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx` — mount `<CockpitIntroCard/>`; the shell
  already owns the stage `pointerdown` that dismisses it
- `src/frontend/src/config/displayNames.js` — all four strings

### Related Tasks

- Depends on: **T10840** (shared files `FocusModeView.jsx`, `FocusCockpit.jsx`)

### Technical Notes

**The persistence rule is the whole task.** CLAUDE.md bans reactive persistence: the app never
writes as a side effect of state changing. So:

- **Neither flag is written when its hint appears.** That would be a render-triggered write.
- Both are written by a **named gesture**: the X tap, the "Got it" tap, the first stage
  `pointerdown`.
- If a user never taps anything and just rotates away, the hint returns next time. That is correct
  and intended — not a bug to "fix" with a write on mount.
- Storage is `localStorage` only (`rb.focus.rotateNudgeDismissed`, `rb.focus.cockpitIntroSeen`).
  This is a per-device UI preference, not user data: it never reaches the backend and needs no sync.
- Reads are lazy `useState` initializers, wrapped in try/catch — **never** a `useEffect`.

Other notes:

- "the clip has no crop keyframes yet" is derived from the existing crop keyframe list already in
  scope in `FocusModeView`. Do not add state or a store field for it.
- The ring on the play button / CTA is a one-shot `box-shadow`, not a looping animation. No
  `@keyframes` pulse that runs forever behind a video editor.
- Copy lives in `displayNames.js` (the T9550 single-source rule). Parent-facing vocabulary:
  "focus point", not "keyframe".
- Icons: Lucide, inline, `aria-hidden`. Never emoji.
- The X and "Got it" are real `<button>`s with `aria-label`s, 44 px minimum.

## Implementation

### Steps

1. [ ] Branch `feature/T10850-rotation-hints`
2. [ ] Add the four strings to `displayNames.js`
3. [ ] `RotateNudge` + its test (shown/hidden truth table; X writes; render does not)
4. [ ] Mount it under the stage in the portrait path of `FocusModeView`
5. [ ] `CockpitIntroCard` + its test (both dismissal gestures write; render does not)
6. [ ] Mount it in `FocusCockpit`, wire the stage `pointerdown` dismissal
7. [ ] Relevant set green, existing tests unedited
8. [ ] Live-drive: portrait -> see the nudge -> rotate -> see the card -> "Got it" -> rotate away
       and back -> neither returns

### Test Scope (relevant set, ~5 files)

New: `RotateNudge.test.jsx`, `CockpitIntroCard.test.jsx`.
Regression, must pass unedited: `FocusModeView.framingActionRow.test.jsx`,
`FocusModeView.advancedEditing.test.jsx`, `modes/focus/cockpit/__tests__/FocusCockpit.test.jsx`.

Each new test must include an explicit **"render alone writes nothing"** case that asserts
`localStorage.setItem` was not called — that is the case guarding the persistence rule.

### Progress Log

**2026-09-21**: Filed from the Focus landscape design session. User ruled explicitly for
auto-enter on rotation **plus** a visual hint. Not started.

## Acceptance Criteria

- [ ] Portrait Focus on a phone shows the nudge under the stage while the clip has no focus points
- [ ] The nudge does not appear once dismissed, on this device, across reloads
- [ ] Rotating in for the first time shows the card; "Got it" or a touch on the stage dismisses it
- [ ] Neither flag is written on render — proven by an explicit test per hint
- [ ] No `useEffect` writes to `localStorage` anywhere in the diff
- [ ] Copy lives in `displayNames.js`, not inline in JSX
- [ ] Both dismiss controls are >= 44 px with `aria-label`s
- [ ] **No existing test file was edited**
- [ ] Lint hooks clean, Branch CI green
