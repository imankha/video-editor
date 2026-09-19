# T10400: Fullscreen shouldn't auto-open the play editor when a play is selected

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

User report: "When I have a play on the timeline selected and I click full screen, it opens up
the play as if I clicked 'edit play'."

`AnnotateContainer.handleToggleFullscreen` (~line 1172) has always done this deliberately: it was
built in T690 (March) as REQ 8 — "Enter FS with selection auto-opens overlay" — back when
fullscreen was the *only* surface that could reach the play editor.

That premise is now false. T10310 (2026-09-18, earlier today) added a standalone [Edit Play] /
[Frame Clip] row directly on the main Annotate screen the moment a play is selected — no
fullscreen needed. So the old auto-open is no longer a shortcut, it's a surprise: clicking the
plain "go fullscreen" button silently starts editing.

## Solution

Drop the `newFS && selectionState.type === 'SELECTED' → editClip(...)` branch from
`handleToggleFullscreen`. Entering fullscreen just sets `annotateFullscreen`; a selected play
stays SELECTED (its own [Edit Play]/[Frame Clip] row and the fullscreen toolbar's "Edit play"
button remain the explicit ways to enter edit mode). The mobile exit-closes-overlay branch is
unrelated and stays as-is.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` — `handleToggleFullscreen` (~line 1172)
- `src/frontend/e2e/clip-selection-state-machine.spec.js` — REQ 8/9/11 and the "TIMELINE CLICK" block
  assert the old auto-open behavior; needs rewriting to assert fullscreen does NOT auto-open, and
  that entering edit mode in fullscreen still requires the explicit "Edit play" button.

### Related Tasks
- Supersedes half of T690's original REQ 8 (kept REQ 9 exit-behavior, mobile-only per T9500).
- Builds on T10310 (today), which made the editor reachable without fullscreen.

## Implementation

### Steps
1. [x] Remove the auto-`editClip` branch from `handleToggleFullscreen`.
2. [x] Update `clip-selection-state-machine.spec.js`'s REQ 8 block (and downstream REQ 9/11 /
   TIMELINE CLICK steps that assumed the overlay was already open) to reflect the new behavior.
3. [x] Curated frontend test run.

### Progress Log

**2026-09-18**: Root-caused via T690's original commit (REQ 8) and T10310's same-day comment
in `AnnotateModeView.jsx` explaining the new row exists precisely so fullscreen doesn't have to
double as the editor entry point. Fixed inline (S/M-tier, no container — single container file +
one e2e spec).

**2026-09-18 (review + verification)**: Fresh-context Reviewer pass found 2 MAJOR + 5 MINOR, all
addressed:
- The e2e spec's REQ 8 block ran against a still-*playing* video, racing auto-deselect and the
  fullscreen controls' 3s auto-hide timer — added `ensurePaused(page)` before entering fullscreen.
- Escape-key exit and `handleToggleFullscreen`'s exit branch had become byte-identical once the
  entry asymmetry was removed — the Escape handler now calls `handleToggleFullscreen()` directly
  instead of duplicating its logic.
- Two locator/comment cleanups in the e2e spec (title-based "Edit play" lookup instead of
  ambiguous text, since the overlay itself renders "Edit play" text once open).
- `.claude/knowledge/annotate.md` updated with a landmine entry (this doc).
- Comment moved to the function's JSDoc instead of floating mid-body.

**Live-drive verification (real browser, dev servers on 5173/8000):** wrote a throwaway temp e2e
spec (not committed — deleted after use) that creates a game + one play via the plain UI (no TSV
import, sidestepping an unrelated pre-existing setup break in the permanent spec — see below),
selects the play, clicks Fullscreen, and asserts the editor does NOT open, then clicks the
explicit "Edit play" toolbar button and asserts it DOES open. Result: **passed** —
`Overlay auto-opened after clicking Fullscreen: false` / `Overlay visible after explicit Edit
play click: true`. This also caught a real strict-mode locator bug in my own REQ 8 rewrite
(the "Edit play" title matches BOTH the desktop text and mobile icon-only toolbar button variants)
— fixed with `.first()` in the permanent spec too.

**Known gap (surfaced by review, not fully closed):** `clip-selection-state-machine.spec.js` is
the only guard for this behavior, and Playwright is **not wired into Branch CI**
(`.github/workflows/branch-ci.yml` has no `playwright`/`test:e2e` step) — a regression here ships
silently unless someone runs the spec or live-drives the flow before merging. Could not run the
*permanent* spec itself end-to-end in this session: it fails at an unrelated, pre-existing setup
step (`input[type="file"][accept=".tsv,.txt"]` not found, ~20s into the run, well before any code
this task touches) — confirmed pre-existing by inspecting recent git history of the modal/TSV
importer (no relevant recent changes). Not fixed here (out of scope; a separate task should
investigate). The throwaway temp spec above avoided that step entirely and is why the fix has
real browser evidence despite this.

## Acceptance Criteria

- [x] Selecting a play, then clicking Fullscreen, enters fullscreen WITHOUT opening the play editor.
      **Live-drive verified**, see Progress Log.
- [x] The fullscreen toolbar's explicit "Edit play" button still opens the editor for the selected
      play. **Live-drive verified**, see Progress Log.
- [x] Exiting fullscreen on mobile while editing/creating still closes the overlay (unchanged;
      code-verified via the Escape-handler consolidation — not separately live-driven).
- [x] e2e spec updated to match; no test still asserts the old auto-open.
- [ ] `clip-selection-state-machine.spec.js` runs clean end-to-end in CI or a from-scratch local
      run — blocked on the unrelated pre-existing TSV-import setup break noted above; not this
      task's scope to fix, but worth its own task so this spec (and this fix's only guard) is
      actually exercised automatically.
