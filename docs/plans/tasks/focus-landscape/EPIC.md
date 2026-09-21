# Focus on a Landscape Phone

**Status:** IN_PROGRESS
**Started:** 2026-09-21
**Impact:** 7 **Complexity:** 5 **Priority:** 1.4
**Design doc:** [T10840-design.md](T10840-design.md) — APPROVED by the user 2026-09-21
**Mockup artifact:** https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx

## Goal

Make Focus usable on a phone held sideways, which is how parents actually hold a phone on a
sideline. Today a landscape phone gets the worst of both breakpoint systems: `sm:` "tablet" CSS
driven by JS that says "phone". The crop box is scrolled off the top of the screen, a 224 px clip
rail shows one row and a disabled control, and ~900 px of content is stacked into a 334 px
viewport.

The replacement is a distinct **cockpit** layout — full-bleed stage, edge rails, one horizontal
timeline, zero scroll — entered automatically on rotation, with a hint on each side of the flip so
users discover it.

Measured on the user's own staging screenshot (Samsung 2340x1080, DPR 2.625, Chrome): the real web
viewport is **812 x 334 CSS px**, after 77 px of height and 79 px of width go to system chrome.
The cockpit gives the 9:16 reticule **156 x 278** — **2.05x** the area it has in portrait — and a
572 px scrub track instead of ~265.

## Tasks

Frontend only. No schema, no API, no new persistence path. **Strict order** — all three touch
`modes/FocusModeView.jsx`, so they cannot run in parallel.

| ID | Task | Status |
|----|------|--------|
| T10830 | [Extract FocusTimelineBlock (mechanical)](T10830-extract-focus-timeline-block.md) | TODO |
| T10840 | [The landscape cockpit layout](T10840-landscape-cockpit-layout.md) | TODO |
| T10850 | [Rotation hints, both directions](T10850-rotation-hints.md) | TODO |

## Settled decisions

The design doc carries the full ledger (D1-D16). The ones a worker is most likely to want to
re-litigate, and must not:

| # | Decision |
|---|---|
| D1 | Entry is `useIsCockpit() = useIsMobile() && useIsLandscape()` — a pure derivation. No `useEffect`, no `useState`, no store field. Auto-enter on rotation is the approved behaviour. |
| D2 | One breakpoint source of truth: the JS hook. **No** `short-landscape` Tailwind variant — it would duplicate `LANDSCAPE_QUERY` where it can drift. |
| D3 | Cockpit is an early return in `FocusModeView` **above** the `backdrop-blur` card; `FocusScreen` gates the sidebar on the same derivation. |
| D6 | Sheets slide from the **right**, `absolute` inside the shell, never `fixed`, never a bottom sheet. Scrim is `pointer-events-none`; close via the X only. |
| D7 | `h-dvh` + `env(safe-area-inset-*)`, never `inset-0` / `h-screen`. |
| D10 | No timeline zoom. Long-press + drag = jog (movement / 4). Tap a diamond = seek + select -> Copy/Delete popover above the strip. |
| D11 | 1 finger = frame, 2 fingers = inspect. The crop/view `touchMode` toggle is dropped. |
| D12 | `pointercancel` (fired by a rotate mid-drag) abandons the drag with no partial write. |
| D13 | Segment lane: sheet only. "Back to Preview": two 10 px lines in the same 64 x 60 box. Multi-clip filmstrip: no, sheet only in v1. |
| D14 | Both hints write their dismissal on a **gesture**, never on render. `localStorage` only. |

## Completion Criteria

- [ ] All three tasks merged, Branch CI green on each
- [ ] Focus on a landscape phone has **no vertical scroll**, and the reticule + timeline are
      visible at the same time
- [ ] Every existing `FocusModeView` / `FocusTimeline` unit test passes **unedited** (jsdom's
      `matchMedia` returns `matches: false`, so the portrait path is unchanged by construction)
- [ ] Real-device check owed and done: **iOS landscape**, both rotation directions, confirming the
      play button clears the notch (D7 — the single most likely shipping bug; headless E2E cannot
      catch it)
- [ ] Live-driven on staging at 812 x 334 against a real account
