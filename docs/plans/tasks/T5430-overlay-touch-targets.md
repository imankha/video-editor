# T5430: Overlay controls have sub-44px touch targets (color picker, detection markers, region delete)

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-19
**Follows:** T5360 (touch targets on tablet) — extends the same 44px coarse-pointer floor to Overlay.

## Problem

Found 2026-07-19 while verifying T5360 on staging (imankh, iPad, `pointer: coarse` + `hover: none`
confirmed). T5360 correctly enlarged the shared control-bar buttons (play/step/zoom/fullscreen — all
now **44x44**) and the crop/highlight keyframe markers. But **Overlay-mode-specific controls were
never in T5360's scope and still render at ~24x24** on touch:

Measured on staging (coarse pointer), these buttons are ~24px:
- **Spotlight color picker swatches** — `White`, `Cyan`, `Yellow`, `Pink`, `Orange`, `None`.
- **Player-detection timeline markers** — `"N players detected at frame N - Click to assign"`,
  `"Player assigned at frame N - Click to revisit"` (the Overlay detection/assignment markers).
- **`Delete region`** button.

24x24 clears only WCAG-AA (24px); it misses the 44px Apple-HIG / WCAG-AAA target T5360 set for touch.
These are core Overlay gestures (pick a spotlight color, assign a detected player, delete a region),
so they're worth the same treatment.

**Not a regression:** these are pre-existing controls; T5370 (spotlight loop) / T5390 (circle touch)
did not add or change them. This is completing T5360's coverage, not fixing new breakage.

## Solution
Apply the T5360 pattern (`coarse-pointer` Tailwind variant → 44px floor on touch, desktop
byte-identical) to the Overlay controls above. For the dense timeline detection markers, mirror the
KeyframeMarker approach (widen the coarse-pointer hit pad rather than blindly forcing a 44px box that
would overlap neighbors). For the color swatches, a 44px coarse touch target with the swatch centered.

## Relevant files
- `src/frontend/tailwind.config.js` — `coarse-pointer` variant already exists (T5360).
- Overlay color picker component (spotlight color swatches) — grep for `White`/`Cyan`/`Yellow` swatch
  render in `src/frontend/src/modes/overlay/**` / `OverlayModeView.jsx`.
- Player-detection marker component (the "players detected at frame N" timeline markers).
- The `Delete region` button (region controls).
- `src/frontend/e2e/helpers/usabilityAudit.js` — extend the `assertTouchTargetSizes` manifest
  (`touchTargets`) to include the Overlay screen's controls so the matrix catches this next time.

## Acceptance Criteria
- [ ] On a coarse pointer (iPad project / real touch), the spotlight color swatches, the region
      delete, and the player-detection assign markers are >=44px touch targets (dense markers may use
      a documented hit-pad expansion rather than a 44px box if overlap forces it).
- [ ] Desktop (fine pointer) byte-identical.
- [ ] usabilityAudit `touchTargets` extended to the Overlay screen; matrix green on the iPad project.

## Classification hint
M-tier, frontend-only, presentational (CSS-class + one test-helper manifest entry). No schema/backend.
Verify on the iPad project + on staging (coarse pointer).
