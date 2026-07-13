# T4880: Mobile: Framing/Overlay content below the timeline is unreachable (can't save/exit)

**Status:** DONE
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
- Blocks: T4930 (mobile viewport usability matrix — generalizes this task's regression test to every screen × popular viewports; T4930's audit must FAIL against the pre-fix layout as proof it would have caught this)
- Screenshots from the report are with the user (landscape + portrait, iPhone).

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

**2026-07-11 (impl, branch feature/T4880-mobile-editor-scroll)**: Root cause was NOT
only the `h-screen`/`vh` hypothesis. The real blocker: the mobile editor is an
always-on fullscreen video takeover (`mobileFs = isMobile`, from commit 10494193
"always-fullscreen editor"), a `fixed inset-0 z-[100]` layer. The below-timeline
controls — Framing's `ExportButtonSection` (Export / Proceed to Overlay) and Overlay's
`OverlayExportButtonSection` (all overlay settings + the "Add Spotlight" primary button)
— are gated behind `!mobileFs`, so they were **never rendered on a phone**. A dvh fix
alone cannot surface controls that don't exist in any scrollable pane.
Fix (LAYOUT lane):
1. `App.jsx` shell `h-screen` -> `h-dvh` so the `overflow-auto` editor pane maps to the
   true iOS visible viewport (the correct vh fix; helps every scrollable editor screen).
2. `FramingModeView.jsx` / `OverlayModeView.jsx`: mobile now defaults to the inline
   scrollable layout (renders timeline + settings + Export/Proceed/Add-Spotlight in
   normal flow — all reachable). Fullscreen video is preserved as opt-in via a new
   Maximize button (view-local `mobileExpanded` state); the in-overlay back button
   collapses back to inline instead of navigating Home (Home lives in the header).
3. `ModeSwitcher.jsx`: added `data-testid="mode-{id}"` for reliable e2e targeting.
Evidence: Vitest `FramingModeView.mobileReachable` + `OverlayModeView.mobileReachable`
(fail pre-fix, pass post-fix); Playwright `e2e/T4880-mobile-editor-reachable.spec.js`
(real app, iPhone 390x844 portrait + 844x390 landscape) — Framing Export reachable +
clickable both orientations, responsiveSweep clean. See qa/ screenshots.
Honesty: Playwright emulation cannot reproduce iOS Safari's dynamic-toolbar vh/dvh
chrome behavior — final real-iPhone check is on the user once this is on staging.

## Acceptance Criteria

- [ ] On an iPhone-sized viewport (portrait and landscape), the user can reach and use everything below the timeline in Framing and Overlay
- [ ] Framing can be saved/exited on mobile
- [ ] Add Spotlight can be clicked on mobile
- [ ] No regression to desktop layout
- [ ] Tests pass
