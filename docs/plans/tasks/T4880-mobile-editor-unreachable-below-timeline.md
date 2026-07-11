# T4880: Mobile: Framing/Overlay content below the timeline is unreachable (can't save/exit)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

Reported by the user from a real session (iPhone Safari, app.reelballers.com, 2026-07-11): while editing a football clip on an iPhone, everything below the timeline is unreachable — the page does not scroll past it. Consequences observed:

- In **Framing**, the save/exit controls below the timeline can't be reached, so the user literally could not save and exit the screen.
- In **Overlay**, the overlay settings and the **Add Spotlight** button at the bottom can't be reached, so the spotlight task can't be completed.
- Reproduces in **both portrait and landscape** (screenshots captured in both orientations; portrait shows the timeline consuming the bottom of the viewport with the browser chrome below it, nothing scrollable).

Mobile is effectively unable to complete the framing → overlay → export flow. Desktop is unaffected.

## Solution

Make the editor screens (Framing, Overlay) fully usable on mobile viewports: everything below the timeline (settings, Add Spotlight / Export buttons, save/exit) must be reachable, either by making the editor column scrollable on small viewports or by restructuring the mobile layout (e.g., collapsing/shrinking the video or timeline).

Likely root cause to investigate first: the app shell is `h-screen overflow-hidden` with the content pane `flex-1 overflow-auto` ([App.jsx:726-741](../../src/frontend/src/App.jsx#L726)). On iOS Safari, `100vh` includes the area behind the browser chrome, so the bottom of an `h-screen` layout is clipped behind the toolbar (classic `100vh` vs `100dvh` issue) — and if the inner editor layout uses fixed/`h-full` rows, the overflow container may have nothing to scroll. Verify with real device emulation before choosing between `dvh` units, `min-h-0` flex fixes, or a mobile-specific layout.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/App.jsx` — app shell: `h-screen overflow-hidden` + `flex-1 overflow-auto` content pane (lines ~726-741)
- `src/frontend/src/screens/FramingScreen.jsx` — `flex h-full` root (line ~1063)
- `src/frontend/src/screens/OverlayScreen.jsx` — same layout family
- Shared timeline/video-player layout components used by both screens (identify during Code Expert pass)
- `src/frontend/src/components/ExportButtonView.jsx` — the unreachable "Add Spotlight"/Export button

### Related Tasks
- None blocking. Screenshots from the report are with the user (landscape + portrait, iPhone).

### Technical Notes
- Test on iOS Safari specifically (dynamic browser chrome). Playwright device emulation (`iPhone 14` descriptor) catches layout math but NOT the vh-vs-dvh chrome behavior — a real-device or responsive-mode sanity check is required before calling this done.
- Watch for `100vh`/`h-screen` anywhere in the editor tree; prefer `100dvh`/`h-dvh` or flex with `min-h-0`.
- The Framing screen already has a `sm:hidden` drawer pattern (line ~1083), so some mobile-specific layout exists — extend that thinking rather than adding a parallel system.

## Implementation

### Steps
1. [ ] Reproduce in responsive mode / real device; identify which container fails to scroll and whether vh-clipping is involved
2. [ ] Fix layout so all below-timeline content is reachable on small viewports (portrait AND landscape)
3. [ ] Verify complete flows on mobile viewport: framing save/exit, overlay settings + Add Spotlight
4. [ ] Add a Playwright mobile-viewport regression test asserting the export/Add Spotlight button is reachable (scrollable into view) on iPhone-sized viewports

### Progress Log

**2026-07-11**: Task created from user report with portrait + landscape screenshots.

## Acceptance Criteria

- [ ] On an iPhone-sized viewport (portrait and landscape), the user can reach and use everything below the timeline in Framing and Overlay
- [ ] Framing can be saved/exited on mobile
- [ ] Add Spotlight can be clicked on mobile
- [ ] No regression to desktop layout
- [ ] Tests pass
