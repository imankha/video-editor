# T7130: Reel aspect ratio (9:16 / 16:9) cannot be changed on a phone

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-17
**Updated:** 2026-08-17
**Bugs:** 41p (primary), 42p (duplicate)

## Problem

User report (41p): *"on my iPhone using the reel player app it doesn't allow me to change from
9:16 to 16:9. I've tried everything but the button can't be toggled."* Follow-up (42p): *"The
9:16 to 16:9 not being switchable is not an option for Safari either."*

**Not an iOS/Safari issue — a viewport-width design issue.** Reproduced in desktop Chrome by
narrowing the window; reproduced live at the reporter's exact 352px viewport. Two compounding
defects:

1. **The interactive selector is desktop-only.** The Framing controls bar that holds it is
   `hidden lg:flex` (`FramingModeView.jsx:352`), so below 1024px it is `display:none` — the
   buttons exist in the DOM but have `offsetParent === null`. That takes iPads in portrait
   (768px) with it, not just phones.
2. **What mobile shows instead is a control-shaped thing that is not a control.**
   `<AspectRatioSelector … readOnly />` (`FramingModeView.jsx:531`, added by T5780) renders a
   `div` styled like the real selector, whose only affordance signal is a `title` tooltip
   ("set by project") that touch devices never surface. So the user sees what looks like the
   toggle and taps it forever — exactly the reported experience. This is worse than showing
   nothing, and it is why the report reads as a broken button rather than a missing feature.

Net effect: aspect ratio can only be chosen at reel-creation time
(`GameClipSelectorModal.jsx:776`); auto-generated reels default to 9:16 and a phone-only user
can never change a reel's shape.

**Also found:** the read-only chip is inside a `clipTitle &&` guard, so on mobile the aspect
ratio was not even *displayed* when a clip had no title.

## Solution

One controls bar at every width, holding the one real selector — rather than a second mobile
control to keep in sync.

- **`FramingModeView.jsx`**: the controls bar becomes `flex` (was `hidden lg:flex`) and only
  its right-hand group (background dim, straighten, zoom) stays `hidden lg:flex`. Those three
  are precision-pointer tools and stay desktop-only deliberately; the aspect selector is not.
  The read-only chip is deleted from the mobile title row, so the ratio is no longer coupled to
  `clipTitle` and is never shown twice (responsiveness skill: never show redundant information).
- **`AspectRatioSelector.jsx`**: the `readOnly` branch is DELETED — after the above it has zero
  call sites, and a component that renders a fake control is what produced this bug. The
  buttons get `min-h-11 min-w-11 lg:min-h-0 lg:min-w-0` (44px touch target per the
  responsiveness skill, desktop geometry byte-identical) and `aria-pressed`.

No new state, no new props, no persistence change. The change handler already exists and is
already correct: `handleAspectRatioChange` (`FramingScreen.jsx:110-120`) is a single gesture ->
surgical `POST /projects/{id}/aspect-ratio` -> `refreshProject()`, with a
`newRatio === projectAspectRatio` no-op guard, so tapping the already-selected ratio does
nothing and there is no reactive write.

### Considered and rejected
- **A single tap-to-flip chip** (one control that alternates) — a mis-tap would silently re-fit
  every clip's crop server-side (T3910). Two explicit buttons make the destination deliberate
  and keep the no-op guard meaningful.
- **Keeping `readOnly` for a future viewer surface** — dead code today; the fake-control shape
  is the bug's root cause and should not survive.
- **Making the touch sizing unconditional** — would change desktop geometry for no reason; the
  `lg:` reset keeps 1280px byte-identical.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FramingModeView.jsx` — controls bar (`:351-401`), mobile title row
  (`:517-534`)
- `src/frontend/src/components/AspectRatioSelector.jsx` — delete read-only branch, touch targets
- `src/frontend/src/screens/FramingScreen.jsx` — `handleAspectRatioChange` (`:110-120`), unchanged
  (read for verification only)

### Related Tasks
- T3910 — reel-level aspect ratio applying to all clips (the server-side re-fit this triggers)
- T4050 — selector must read `globalAspectRatio`, not the clip crop ratio (pinned by
  `FramingModeView.aspectRatio.test.jsx`, must stay green)
- T5780 — introduced the mobile read-only chip being removed here
- T4880 — mobile editor layout invariant (inline scrollable layout, fullscreen is opt-in)

### Technical Notes
- **jsdom cannot see this bug.** Tailwind CSS is not loaded under Vitest, so `hidden lg:flex` is
  an inert className string and both selector instances are "present" in the DOM either way.
  The Vitest coverage therefore pins the two things that ARE structural: exactly one selector
  renders, it is interactive (never `readOnly`), and no ancestor of it carries a bare `hidden`
  class. Visibility itself is verified in a real browser at 352px / 375px / 1280px.

## Implementation

### Steps
1. [x] `FramingModeView.jsx`: controls bar `hidden lg:flex` -> `flex`; right group -> `hidden lg:flex`
2. [x] `FramingModeView.jsx`: delete the read-only chip from the mobile title row
3. [x] `AspectRatioSelector.jsx`: delete the `readOnly` branch; 44px touch targets; `aria-pressed`
4. [x] Vitest: `FramingModeView.mobileAspect.test.jsx` (one interactive selector, no `hidden`
       ancestor, no `readOnly` instance) + `AspectRatioSelector.test.jsx`
5. [x] Real-browser verification at 352px (reporter's viewport) and 1280px

### Progress Log

**2026-08-17**: Filed from bugs 41p/42p after live repro. Root cause confirmed as viewport-width
gating plus a fake read-only control, not an iOS/Safari defect. Implemented and verified.

## Acceptance Criteria
- [x] The 9:16 / 16:9 buttons are visible and tappable at 352px and 375px
- [x] Tapping the other ratio fires the existing reel-level change gesture and the selection moves
- [x] No read-only look-alike control renders at any width
- [x] Touch targets are at least 44x44px on mobile
- [x] Desktop (1280px) layout and behaviour unchanged; T4050 selector wiring still green
