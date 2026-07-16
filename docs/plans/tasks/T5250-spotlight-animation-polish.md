# T5250: Spotlight animation polish (premium entrance/exit reveal)

**Status:** TODO
**Impact:** 6 | **Complexity:** 5
**Related:** [Player Intro epic](player-intro/EPIC.md) · animation-polish direction (2026-07-15)

## Problem

The spotlight highlight overlay tracks the player via keyframes, but it **pops on and off** when a
highlight region starts/ends — it doesn't feel produced. Per the user's direction (intros, outros,
and **spotlights** should animate and look premium), the spotlight should **reveal and retract with
polish** (a smooth fade + slight scale-in on entrance, fade-out on exit, optional subtle glow/pulse)
so the highlight moment feels intentional and professional.

## Scope

Add an **entrance/exit reveal** and optional glow to the spotlight, computed from each region's
`[start, end]` bounds — a **visual/animation layer over the existing keyframe interpolation, NOT a
data-model change** (no new persisted keyframes; the reveal is derived, so it can't corrupt saved
data or violate the gesture-persistence rule):
- **Entrance** (~0.25–0.4s at region start): ramp `strokeOpacity`/`fillOpacity` from 0 and scale
  `radiusX`/`radiusY` from ~0.85→1.0 with easing, so the spotlight blooms onto the player.
- **Exit** (~0.25s at region end): fade back out.
- **Optional**: a subtle continuous glow/pulse on the stroke for a premium feel (keep tasteful).
- **Easing**: ease-out on entrance, ease-in on exit — not linear.

**Consistency is the hard part — preview MUST match export:**
- **Frontend preview:** `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` (and the
  region model in `useHighlightRegions.js`) — apply the same reveal envelope when rendering the
  live overlay.
- **Backend render:** `video_processing._spline_interpolate_highlight` + `keyframe_interpolator`
  and the read path in `overlay.py` (`_region_bounds`, `_keyframes_within_bounds`). The reveal must
  be applied at render so the exported video matches the editor preview.
- Factor the reveal envelope as ONE shared spec (documented constants + easing) mirrored on both
  sides, like the existing crop/default-shape mirroring — don't let preview and render drift.

## Landmines (from keyframes-framing knowledge)
- **Don't touch persisted keyframes.** The reveal modulates the *rendered* opacity/radii between the
  region bounds; it never writes keyframes (T350 corruption class).
- **Preserve the strokeOpacity/fillOpacity normalization** at the DB-read boundary
  (`_normalize_region_keys`, T5120) — apply the reveal AFTER normalization, don't reintroduce bare
  key access in the spline helpers.
- **Highlight overlay is a parallel, "one-refactor-behind" implementation** (`useHighlightRegions.js`,
  hardcoded `framerate=30`, region-scoped ≥2 keyframes) and is slated to move onto the shared
  controller in **T4460**. Apply the reveal at the display/render layer so it survives that refactor;
  coordinate so T4460 doesn't strip it.
- **strokeOpacity/fillOpacity spline fork** (T4250) drops those keys between keyframes today — the
  reveal envelope should sit on top of whatever the interpolator yields, not fight it.

## Relevant files
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx`,
  `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`
- `src/backend/app/modal_functions/video_processing.py` (`_spline_interpolate_highlight`),
  `src/backend/app/ai_upscaler/keyframe_interpolator.py`, `src/backend/app/routers/export/overlay.py`
  (`_region_bounds`, `_keyframes_within_bounds`, `_normalize_region_keys`)

## Classification hint
M/L-tier: frontend preview + backend render must stay in lockstep (the real risk). No schema change
(derived reveal). Touches a Modal function (`video_processing.py`) — ask before redeploying Modal.
Architect gate optional; get a design pass on the timing/easing.

## Acceptance criteria
- [ ] Spotlight fades + scales in on entrance and fades out on exit, with easing (no pop).
- [ ] Editor preview and exported video match (shared reveal envelope, verified on a rendered clip).
- [ ] No new persisted keyframes; strokeOpacity/fillOpacity normalization intact.
- [ ] Reviewed as "looks premium"; survives being toggled per region.
