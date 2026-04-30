# T2050: Framing Background Dim Control

## Source
Alpha tester feedback (2026-04-30): "It would be nice to be able to dim the background video outside the keyframe further (or even black it out) to give the user a highly-faithful preview of how their Reel will look before they hit the no-turning-back Frame Video button."

## Problem
The Framing page dims the area outside the crop rectangle at a hardcoded 20% opacity (`rgba(0, 0, 0, 0.2)`). Users cannot adjust this, so they can't get an accurate preview of the final exported reel (which only contains the cropped region). The "Frame Video" export is destructive — once committed, the user can't undo it — so a faithful preview before exporting is valuable.

## Current Implementation
- **File:** `src/frontend/src/modes/framing/overlays/CropOverlay.jsx`
- SVG mask cuts out the crop rectangle, applies `rgba(0, 0, 0, 0.2)` fill to everything outside
- Additional `boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.2)'` on the crop rectangle div
- No user control, no stored preference

## Proposed Solution
Add a dim level control to the Framing UI with presets:
1. **Dim** (current, 20% opacity) — default, good for positioning the crop while seeing context
2. **Dark** (~70% opacity) — heavy dim, crop area stands out clearly
3. **Preview** (100% opacity / black) — faithful preview of the final reel, background fully hidden

Implementation:
- Small toggle or segmented control near the zoom controls (top-right of canvas)
- Update the `rgba(0, 0, 0, X)` opacity value in both the SVG mask fill and the boxShadow
- Store preference in component state (no persistence needed — resets each session)
- Keep grid lines visible in all modes

## Files to Change
- `src/frontend/src/modes/framing/overlays/CropOverlay.jsx` — accept dim level prop, update opacity values
- `src/frontend/src/modes/framing/FramingModeView.jsx` — add dim control UI, pass prop to CropOverlay

## Complexity
~2 (small UI addition + one prop threading)

## Impact
6 — directly addresses user anxiety about the destructive "Frame Video" action; builds confidence in the crop placement
