# T10420: Mobile "Edit Play" sheet anchored to the wrong containing block

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

User report (screenshot, mobile 1080x2340, windowed/non-fullscreen Annotate, editing an existing
play): the "Edit Play" bottom sheet rendered with its top cut off (only a sliver of the clip-trim
scrub bar visible at the very top of the screen — the title, close button, and "Cut from" chip
were off-screen) and a large empty band of the page's background below the Cancel button down to
the browser chrome. User asked to "bring the whole UI down so I can see all of the elements with
rational padding."

Root cause: `AnnotateModeView.jsx`'s mobile inline sheet (`mobileInlineForm`) is
`<div className="fixed inset-x-0 bottom-0 ...">`, and it was rendered INSIDE the "Main Editor
Area" wrapper div that gets `bg-white/10 backdrop-blur-lg ...` whenever `!annotateFullscreen`
(true whenever `mobileInlineForm` can be true, since `mobileInlineForm = underCanvasEditor &&
isMobile` and `underCanvasEditor = showAnnotateOverlay && !annotateFullscreen`). A
`backdrop-filter` ancestor becomes the containing block for `position: fixed` descendants in
Chromium/WebKit (same mechanism as `transform`/`filter`) — so `bottom-0` anchored to the bottom of
that wrapper (which only wraps the video preview card) instead of the true viewport. The wrapper's
bottom edge sits partway down the page, so the sheet's content (taller than the room between there
and the true top of the screen) pushed its top off-screen, while the wrapper's-bottom-to-real-
viewport-bottom gap rendered as empty page background below the sheet.

## Solution

Moved the `{mobileInlineForm && (...)}` block to render as a sibling AFTER the `backdrop-blur-lg`
wrapper's closing tag (still inside the same top-level fragment) — pure JSX relocation, no prop or
component changes to `AnnotateFullscreenOverlay`. This restores the real viewport as the
containing block for the sheet's `fixed`/`bottom-0`.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` — `mobileInlineForm` render site (was ~line 962,
  now rendered after the wrapper div closes, ~line 1180)

### Related Landmine
Same `!annotateFullscreen`-gated `backdrop-blur-lg` wrapper pattern also exists in
`FocusModeView.jsx` and `OverlayModeView.jsx`. Checked both: their only `fixed`-positioned
descendant is gated on `isFullscreen || mobileFs`, which is mutually exclusive with the blur
branch there, so neither currently has this bug live — but any future `fixed` element added
inside those wrappers (a new mobile sheet, popover, etc.) would hit the same trap. Documented in
`.claude/knowledge/annotate.md` Landmines.

## Implementation

### Steps
1. [x] Root-cause via code read (containing-block interaction between `backdrop-filter` and
   `position: fixed`, confirmed against the screenshot's exact symptom shape).
2. [x] Move the `mobileInlineForm` block outside the `backdrop-blur-lg` wrapper.
3. [x] `eslint` clean; curated test run (10 `AnnotateModeView.*.test.jsx` files, 51 tests) green —
   these don't exercise real CSS layout in jsdom, so they confirm no regression to render logic
   but do NOT independently confirm the positioning fix itself.
4. [x] UI designer agent opinion sought (see Progress Log).
5. [ ] User to verify on an actual mobile device/viewport that the sheet now sits flush against
   the real bottom of the screen with the title/scrub bar visible at the top.

### Progress Log

**2026-09-18**: Root-caused and fixed inline (M-tier, shared checkout, single file). Spawned the
`ui-designer` agent for a second opinion per user request ("ask UX expert his opinion when your
done"). Verdict: positioning fix is correct and sufficient — the sheet's internal padding/spacing
already matches the app's standard scale and was never the actual problem, just misdiagnosed by
the user because the symptom (crammed content + dead space) looked padding-shaped. Two follow-ups
surfaced, not yet actioned:
- No dimming scrim behind the sheet on mobile. Tolerable while the sheet's position was broken;
  now that it reliably covers real screen space, floating over live video/timeline with zero
  dimming reads as unfinished and risks a mis-tap on the scrub bar behind it. Suggested reusing
  the existing `bg-black/60 backdrop-blur-sm` modal-scrim convention (`ShareModal.jsx` /
  `ConfirmationDialog.jsx`) rather than a new treatment.
- Knowledge-doc landmine for the shared wrapper pattern across the three ModeView files (see
  Related Landmine above) — added.

Scrim addition intentionally NOT done in this task — it's a new visual affordance the user didn't
ask for, not a fix, and deserves its own explicit go-ahead.

## Acceptance Criteria

- [x] The "Edit Play" mobile sheet's `fixed`/`bottom-0` resolves against the real viewport, not an
      intermediate `backdrop-filter` ancestor.
- [x] No behavior/prop changes to `AnnotateFullscreenOverlay`; lint clean; curated tests green.
- [ ] User confirms on a real mobile viewport that all elements (title, scrub bar, name, category,
      disclosure, Update/Cancel) are visible with no dead space below.
