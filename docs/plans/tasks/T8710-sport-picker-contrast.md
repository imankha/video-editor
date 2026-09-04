# T8710: Sport picker dropdown — white popup background drowns out light-colored text

**Status:** STAGING (merged to master 2026-09-04, PR #330)
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-04

## Problem

User screenshot (2026-09-04): the sport picker's dropdown popup (native `<select>`
options — "No Sport", "Soccer", "Flag Football", etc.) renders with a white/light
background but the option text uses the app's dark-theme light-colored font, making it
hard to read.

`InlineSportSelect.jsx` (`src/frontend/src/components/shared/InlineSportSelect.jsx`) is a
"big, tappable pill" with a **native `<select>` sitting invisibly on top** (comment at
L33) so the OS-native picker UX is used. This matters for the fix: native `<select>`
option-list styling is only PARTIALLY controllable via CSS and is inconsistent across
browsers (Chrome/Edge on Windows often ignores author `background-color`/`color` on
`<option>` in the native popup, rendering system colors instead) — **do not assume a
simple CSS tweak fixes this cross-browser; verify in the actual target browsers before
declaring it fixed.**

## Solution (needs investigation before committing to an approach)

Two candidate directions, pick based on what actually works cross-browser:
1. Try `color`/`background-color` on `<select>`/`<option>` directly (works in Firefox,
   partially in Chrome) — cheapest if sufficient.
2. If native option styling can't be made legible reliably, build a small custom dropdown
   (styled `<div>`-based listbox) replacing the native `<select>` for this component only —
   bigger change, only pursue if (1) is confirmed insufficient.

## Context

### Relevant Files
- `src/frontend/src/components/shared/InlineSportSelect.jsx`

### Technical Notes
- Test in actual Chrome/Edge (Windows) and Firefox — this is exactly the kind of bug that
  "looks fixed" in one browser and isn't in another.

## Acceptance Criteria

- [ ] Sport picker dropdown text is legible (sufficient contrast) in Chrome, Edge, and
      Firefox on Windows
- [ ] No regression to the existing "big tappable pill" mobile UX or native picker
      behavior
- [ ] Screenshot evidence per browser tested
