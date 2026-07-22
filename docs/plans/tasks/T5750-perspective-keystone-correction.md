# T5750: Perspective / keystone correction in Framing (acquisition-corrections family)

**Status:** TODO
**Impact:** 4
**Complexity:** 6
**Created:** 2026-07-22
**Updated:** 2026-07-22

> **EVIDENCE GATE — do not implement yet.** This task is speculative until we have real user
> footage showing perspective distortion that rotation (T5640) can't fix. Collect **at least 2
> distinct user clips** (different accounts/cameras) where off-axis keystone visibly hurts the
> export, and attach them here (R2 refs / account + game name) before scheduling. Rotation +
> hard cropping may absorb most real-world cases; we don't build a homography pipeline on one
> hypothetical.

## Problem

T5640 fixed camera **roll** (tilted horizon). But "camera set up at an angle" has a second
meaning: the camera aimed **off-axis** (yaw/pitch — behind-goal corner mounts, sideline cameras
low and to the side). That produces **keystone/trapezoidal distortion**: goalposts converge,
the far touchline compresses, verticals lean *toward* a vanishing point. No amount of rotation
fixes it — parallel lines in the world are not parallel in the frame.

Arshia's behind-goal prod camera (the T5640 motivating case) plausibly has both tilt AND
perspective skew; tilt is now correctable, skew is not.

## The broader class: acquisition corrections

This task is the third member of a family that shares one signature — **per-clip (not
keyframed), fix-it-not-creative, applied before crop, shrinks the valid region**:

| Correction | Fixes | Status |
|---|---|---|
| Rotation / straighten (T5640) | Roll (tilt) | SHIPPED (v029) |
| Fisheye de-warp (T5657) | Lens distortion | TODO (prepare-stage epic) |
| **Perspective / keystone (this)** | Yaw/pitch (off-axis aim) | Evidence-gated |

Canonical filter order: `dewarp -> perspective -> rotate -> crop`. The coordinate-space
contract from T5640 (crop coords live in the fully-corrected frame space) extends over the
whole composition, as does the inscribed-safe-area clamp (generalized: largest level crop
inside the *composed* corrected frame, not just the rotated one).

**Prerequisite architecture (owned by T5657's design gate, NOT this task):** extract T5640's
rotate-before-crop insertion — currently repeated at three render sites (framing.py,
multi_clip.py, Modal path) — into a single source-corrections filter builder, so each new
correction is one entry, not another triple-site edit. If this task somehow lands before
T5657, the extraction moves here.

## Solution sketch (to be design-gated when evidence exists)

- FFmpeg `perspective` filter (four-corner homography) in the shared corrections stage.
- UX candidates (pick at design time, informed by the actual evidence footage):
  - **Vertical-guides tool** (Lightroom "Guided Upright" style): user drags 2 lines along
    things that should be vertical/parallel (goalposts, corner flags); app solves the
    homography. Consistent with T5640's straighten-line mental model.
  - Simple H/V keystone sliders as the fallback/fine-tune.
- Per-clip scalar params on `working_clips` (sibling columns to `rotation`), surgical
  `set_perspective` action, same gesture-based persistence rules.
- Safe-area clamp over the composed transform; preview and export must agree frame-for-frame
  (characterization test pinning a known (perspective, rotation, crop) tuple, T5640 pattern).

## Context

### Relevant Files (REQUIRED)
Same seam as T5640 — see its task file for the full map:
- `src/backend/app/services/rotation_safe_area.py` (+ frontend twin `rotationSafeArea.js`) — generalize to composed transforms
- `src/backend/app/routers/export/framing.py`, `multi_clip.py`, Modal path — corrections filter stage
- `src/frontend/src/hooks/useVideoDisplayRect.js` — transform composition (T4550 SSOT)
- `src/frontend/src/components/.../CropOverlay.jsx` — guides tool lives beside the straighten tool
- `src/frontend/src/api/framingActions.js`, `src/backend/app/routers/clips.py` — surgical action
- `database.py` + profile_db migration — new columns

### Related Tasks
- Builds on: T5640 (rotation, shipped) — coordinate contract + safe-area + UI grouping precedent (T5641 inline toggle)
- Coordinate with: T5657 (fisheye de-warp) — same filter stage; whichever lands second inherits the shared corrections builder
- Blocked by: **evidence gate above** (not by any task)

### Technical Notes
- Homography changes pixel mapping non-uniformly; the inscribed-safe-area is no longer a
  closed-form rectangle-in-rotated-rectangle — largest axis-aligned rect inside a convex quad
  (still closed-form-ish, but different math than rotation_safe_area.py).
- Keep corrections OUT of the keyframe list (T5640 rule: per-clip scalars).
- UI: corrections group in Framing stays hidden until invoked (T5641 pattern; prepare-stage
  epic philosophy: "only make users suffer this complexity if they need it").

## Implementation

### Steps
1. [ ] **Evidence gate**: attach >=2 real user clips with keystone distortion rotation can't fix
2. [ ] Stage 2 Architect (design gate): UX choice, homography params schema, composed safe-area math, shared corrections builder status (did T5657 extract it?)
3. [ ] Implement per approved design (full L-tier workflow)

### Progress Log
**2026-07-22**: Created from the post-T5640 discussion: "camera at an angle" splits into roll
(shipped) vs off-axis keystone (this). Deliberately evidence-gated — filed to name the
acquisition-corrections family and reserve the design constraints, not to schedule work.

## Acceptance Criteria
- [ ] (Gate) Two real user clips with documented keystone distortion attached before any code
- [ ] Off-axis footage exports with converging verticals corrected; preview matches export
- [ ] Composes with T5640 rotation (and T5657 de-warp if landed) in one corrections stage
- [ ] No black-corner bleed (composed safe-area clamp); rotation=0/perspective=identity is byte-identical to today
- [ ] Real-browser verification of the guides/slider gestures + a corrected export
