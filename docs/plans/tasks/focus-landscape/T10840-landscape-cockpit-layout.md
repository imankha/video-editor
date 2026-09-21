# T10840: Focus landscape cockpit — full-bleed stage, edge rails, no scroll

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-09-21
**Updated:** 2026-09-21
**Epic:** [focus-landscape](EPIC.md) — 2 of 3
**Design:** [T10840-design.md](T10840-design.md) — **APPROVED, read it first**
**Mockup:** https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx (artboard "Proposed - the cockpit" is interactive)

## Problem

On a phone held sideways, Focus renders `sm:` tablet CSS driven by JS that says "phone". Measured
on the user's staging screenshot (real web viewport **812 x 334**):

- The crop box is **cut off** — only its bottom handles are on screen.
- A 224 px clip rail (28% of the width) shows one clip row and a disabled `Transition:` control,
  and the phone toggle that would dismiss it is CSS-hidden (`FocusScreen.jsx:1392`).
- The action band takes ~90 px (27% of the viewport), most of it a sentence about credit rounding.
- ~900 px of content stacked into 334 px. The core loop — drag the box, step along the timeline,
  drag again — needs a scroll between every step, on the same surface that hosts the drag.

## Solution

A distinct **cockpit** layout, entered automatically on rotation: full-bleed stage (684 x 278),
56 px transport rail left, 72 px action rail right with the CTA in the bottom-right corner, one
56 px timeline strip with a 572 px track, and side sheets for Clips / Setup / Trim. **No scroll
anywhere.** The 9:16 reticule becomes 156 x 278 — 2.05x its portrait area.

The design doc carries the full region table, decision ledger D1-D16, Tailwind strings per zone,
ergonomics rules and rejected alternatives. **Implement it as written; do not re-litigate D1-D16.**

## Context

### Relevant Files (REQUIRED)

**New**
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx` — shell, safe-area padding, sheet host
- `src/frontend/src/modes/focus/cockpit/TransportRail.jsx` — zone A
- `src/frontend/src/modes/focus/cockpit/ActionRail.jsx` — zone D + `RailButton` + compact CTA cell
- `src/frontend/src/modes/focus/cockpit/CockpitTimelineStrip.jsx` — zone C
- `src/frontend/src/modes/focus/cockpit/CockpitSheet.jsx` — zone E shell
- `e2e/T10840-focus-landscape-cockpit.qa.spec.js`

**Modified**
- `src/frontend/src/hooks/useIsMobile.js` — add `useIsCockpit()`; harden `useIsLandscape`'s
  matchMedia guard to match `useIsCoarsePointer` (line ~33)
- `src/frontend/src/modes/FocusModeView.jsx` — early return above the `bg-white/10 backdrop-blur-lg`
  card (~line 479)
- `src/frontend/src/screens/FocusScreen.jsx` — gate the sidebar (line ~1392) and the
  `flex sm:hidden` clips toggle (line ~1431) on `!cockpit`
- `src/frontend/src/modes/focus/overlays/CropOverlay.jsx` — D12 `pointercancel`
- `src/frontend/src/components/PrimaryCta.jsx` — D9 `compact` variant
- `src/frontend/src/config/displayNames.js` — rail labels

**Read only, reused verbatim**
- `components/ClipSelectorSidebar.jsx` (inside the Clips sheet), `components/settings/FocusSettingsPanel.jsx`,
  `components/VideoPlayer.jsx` (D16 — no new prop), `components/timeline/TimelineBase.jsx`
  (`EDGE_PADDING = 20`, line 114), `modes/focus/FocusTimelineBlock.jsx` (from T10830)

### Related Tasks

- Depends on: **T10830** (shared file; the cockpit is the 3rd `FocusMode` call site)
- Blocks: T10850 (shared file `FocusModeView.jsx`)
- Sibling precedent: T10820 (mobile settings drawer) established the containing-block trap and the
  no-backdrop-tap-close rule; T4880 established `h-dvh` over `h-screen`

### Technical Notes

- **`useIsCockpit()` is a pure derivation** (D1). No `useEffect`, no state, no store field.
- **Two mount points, one derivation** (D3): `FocusScreen` gates the sidebar, `FocusModeView`
  early-returns the shell. The early return must sit **above** the `backdrop-blur` card so no
  `backdrop-filter` ancestor exists over the sheets.
- **`h-dvh`, never `inset-0` / `h-screen`** (D7). `env(safe-area-inset-left/right/bottom)` as
  padding on the shell — pad **both** sides so the layout does not jump when the phone is flipped.
- Marker positioning keeps the shared formula
  `left: calc(${EDGE_PADDING}px + (100% - ${EDGE_PADDING * 2}px) * ${pct})`. **Never a bare `%`.**
- Scrubbing uses the shared T5450 pattern: Pointer Events + `setPointerCapture(e.pointerId)` +
  `touch-none`, with `pointermove/up/cancel` on `window` filtered by `pointerId`.
- **jsdom's `matchMedia` returns `matches: false`**, so `useIsCockpit()` is false in every existing
  test and the portrait path is unchanged by construction. **If an existing test needs editing,
  stop — the branch has leaked into portrait.**
- The completion preview (`FocusScreen.jsx:1555`) is a full-surface sibling and needs **no** special
  case (D15).

## Implementation

### Steps

1. [ ] Branch `feature/T10840-landscape-cockpit`
2. [ ] Read `.claude/knowledge/keyframes-framing.md` and the design doc before exploring
3. [ ] `useIsCockpit()` + the matchMedia guard, with its unit test
4. [ ] `FocusCockpit` shell + the four zones, against the design's Tailwind strings
5. [ ] Gate `FocusScreen`'s sidebar and clips toggle
6. [ ] Wire the three sheets (Clips / Setup / Trim), reusing the existing panels
7. [ ] `PrimaryCta` compact variant (D9)
8. [ ] `CropOverlay` `pointercancel` (D12)
9. [ ] Timeline strip: jog mode, tap-diamond select + popover (D10)
10. [ ] Relevant set green, existing tests unedited
11. [ ] E2E spec at 812 x 334 and 844 x 390
12. [ ] Reviewer agent on the diff
13. [ ] Live-drive on staging; **real-device iOS landscape check** (both rotation directions)

### Test Scope (relevant set — never the whole suite)

New: `useIsCockpit`, `FocusCockpit`, `CockpitTimelineStrip`, `ActionRail`, `PrimaryCta` (compact).
Regression, **must pass unedited**: `FocusModeView.framingActionRow.test.jsx`,
`FocusModeView.advancedEditing.test.jsx`, `focus/FocusTimeline.test.jsx`, `FramingActionRow.test.jsx`,
`CropOverlay.test.jsx`, `screens/__tests__/focusScreenStaleClipGuard.test.jsx`.
E2E: the new spec + `e2e/T9550-editor-stage-strings.qa.spec.js`.

### Progress Log

**2026-09-21**: Filed from the Focus landscape design session; design approved by the user the same
day off a 6-artboard mockup. Not started.

## Acceptance Criteria

- [ ] At 812 x 334 and 844 x 390, Focus has **no vertical scroll**
      (`document.scrollingElement.scrollHeight <= clientHeight`)
- [ ] The crop reticule and the timeline strip are visible **at the same time**
- [ ] The 224 px clip sidebar is absent; the Clips rail button opens a sheet with the same rows
- [ ] Every interactive element has a >= 44 px hit box, including keyframe diamonds
- [ ] Sheets are `absolute` inside the shell (not `fixed`), slide from the right, and the CTA is
      never dimmed by one
- [ ] Rotating back to 393 x 852 restores the scrolling layout, with no console error and no lost
      keyframe
- [ ] Rotating mid-drag abandons the drag without persisting a partial keyframe (D12)
- [ ] **No existing test file was edited**
- [ ] Real-device iOS landscape verified: the play button clears the notch in both rotation
      directions (D7)
- [ ] Lint hooks clean, Branch CI green
