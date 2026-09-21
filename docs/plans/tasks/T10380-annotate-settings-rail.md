# T10380: Annotate — move Add Footage + Zoom into a right-side settings rail

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

The Annotate screen's toolbar row (Add footage + Zoom, T9350) sits directly above the video
canvas, pushing it down. User feedback: "I really like how we did it in Framing with settings
off to the side" and, on a first proposal that just restyled the row in place, "I don't like C
because I'm trying to remove a row that pushes everything down." Restyling the row wasn't
enough — the row itself had to go.

## Solution

Decision artifact (https://claude.ai/artifact/QfCp5SZzVibRzFB63Ex1Di) walked three options
(contain the row / full settings rail / settings popover). The popover (C) was rejected for the
reason above — it still kept a row. User picked **Option B**: reuse Focus/Overlay's
`SettingsRail` exactly, desktop-only, in-flow beside the editor column.

- **Desktop (`!isMobile`):** the above-canvas row is gone entirely. A new right-side column
  holds Add footage in its own header strip (outside the rail body — `SettingsRail`'s own rule
  is "the CTA never lives inside the rail") and a `SettingsRail` below it with one "Settings" tab
  containing `SettingsPanel title="View only"` > `SettingRow label="Zoom"` (byte-identical
  pattern to `FocusSettingsPanel`'s Zoom row).
- **Mobile (`isMobile`):** unchanged in substance — a single-button Add footage row above the
  canvas (Zoom was already desktop-only there; there's no rail on mobile, matching
  `SettingsRail`'s own mobile-drawer-or-nothing behavior. Annotate doesn't get a mobile drawer
  since Zoom was never mobile-reachable to begin with — nothing to put in one).

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` — toolbar row removed, rail added
- `src/frontend/src/components/settings/SettingsRail.jsx` — reused unmodified
- `src/frontend/src/components/settings/SettingsPanel.jsx` — reused unmodified
- `src/frontend/src/components/settings/SettingRow.jsx` — reused unmodified
- `src/frontend/src/components/ZoomControls.jsx` — reused unmodified
- `src/frontend/src/modes/annotate/AddFootageButton.jsx` — reused unmodified
- `src/frontend/src/modes/AnnotateModeView.settingsRail.test.jsx` — new, desktop rail
- `src/frontend/src/modes/AnnotateModeView.mobileAddFootage.test.jsx` — new, mobile row
- `src/frontend/src/modes/AnnotateModeView.toolbar.test.jsx` — deleted (tested the removed T9350
  row verbatim)

### Related Tasks
- Supersedes T9350 (above-canvas toolbar row placement)
- Found T10370 (dead zoom-timeline hint) while investigating this task

### Technical Notes
- Gated on the `isMobile` JS value (from `useIsMobile()`), same as Focus — not just a `lg:` CSS
  class — otherwise both the mobile row and the desktop rail mount in the DOM simultaneously
  (only CSS-hidden), which is what the first implementation pass got wrong (caught by the new
  tests: `getByTestId` found two `add-footage-button`s). `SettingsRail`'s own internal
  `hidden lg:flex` is kept as a second, narrower-breakpoint safety net, matching how Focus's rail
  behaves.
- Annotate has no "Clips" tab to pair with "Settings" (clips already live in the bottom
  timeline), so `ANNOTATE_RAIL_TABS` is a single-tab array — `SettingsRail` supports this fine,
  just renders one tab in the header.
- Rail is a **permanent** sibling of the editor column (renders whenever
  `annotateVideoUrl && !annotateFullscreen && !isMobile`), unlike the old row which depended on
  `underCanvasEditor` for Zoom's visibility — Zoom now stays reachable while the strip editor is
  open, same as before; only Add footage still hides then.

### Reviewer pass (2026-09-18)

Fresh-context Reviewer: 0 BLOCKING, 3 MAJOR, 7 MINOR. All 3 MAJOR fixed:
- Rail geometry (380px/64px/tween) was hand-copied into `AnnotateModeView.jsx` instead of
  sourced from `SettingsRail.jsx` — now exported (`RAIL_WIDTH_PX`, `RAIL_COLLAPSED_WIDTH_PX`,
  `RAIL_TWEEN`) and consumed from both places, single source.
- The wrapper column was missing `self-stretch`, which would have defeated `SettingsRail`'s own
  floor-to-ceiling height (it only stretches within a `self-stretch` parent) — added, and the
  row/column wrapper classes were changed to match Focus/Overlay's own precedent exactly
  (`lg:flex lg:flex-row lg:items-start` / `flex flex-col w-full lg:flex-1 lg:min-w-0`,
  `FocusModeView.jsx` ~:480-481) instead of an ad-hoc unconditional `flex`.
- Flagged "misleading indentation" of the ~410-line editor column: verified this is the SAME
  flat-indent convention Focus/Overlay already use for their own identical row/column wrappers
  (`FocusModeView.jsx`/`OverlayModeView.jsx`) — not a new deviation, so left as-is rather than
  reindenting against the sibling files' own style.

2 MINORs fixed (magic string `activeTab="settings"` -> `ANNOTATE_RAIL_TABS[0].id`; added a test
pinning that collapsing the rail also hides Add footage). Remaining MINORs accepted as
documented, non-blocking: collapse-hides-Add-footage has no icon-only fallback (matches the
tradeoff of a single-item rail, not worth a bespoke affordance for one button); a >=1024px
coarse-pointer tablet now loses Zoom entirely (it's `isMobile` there) where the old markup showed
it via `lg:block` alone — this actually matches Focus's own `desktopOnly` policy for Zoom, so
reads as intentional consistency rather than a regression; the Add-footage strip's `border-b`
against the rail's `border-left` is a cosmetic seam, to be judged on the still-outstanding
live-drive.

## Acceptance Criteria

- [x] Desktop: no row above the canvas; Add footage + Zoom live in a right-side rail
- [x] Mobile: unchanged (single-button Add footage row, no Zoom, no rail)
- [x] Zoom stays reachable while the under-canvas editor is open
- [x] Rail disappears in fullscreen (matches old row behavior)
- [x] New tests green, existing Annotate regression suite green, build clean
- [ ] Live-drive on staging/dev (not possible this session — Playwright browser was already in
      use by another concurrent session on this shared machine)

## Outcome (2026-09-21 deploy reconciliation)

Shipped DIVERGED from this spec. The rail was implemented (commit `1a2fca90`, 2026-09-18) and
removed the same day by T10390 after a live look; T10391-T10395 then placed the controls in their
natural homes: Focus's zoom control moved onto the video transport bar (T10395), Add footage moved
into the whole-game CTA row (T10393), and the zoom reset button is always rendered, disabled at
100% (T10394). The goal this task was filed for - no extra toolbar row pushing the Annotate
timeline down - is met by that layout. There is no Annotate settings rail in the shipped product;
`SettingsRail` remains Focus/Overlay-only.
