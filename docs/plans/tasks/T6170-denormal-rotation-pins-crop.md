# T6170: A denormal rotation defeats the zero-check and pins the crop box — dragging snaps back

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-07-28
**Found by:** the user, reproducibly, on staging — *"when I tried framing Brilliant Control at
Legends Mar 28 the frame square would snap back when I moved it. Other reels were fine."*

## Root cause — measured, do NOT re-derive

`working_clips.rotation` for project 31 (staging, `imankh@gmail.com`, profile `9fa7378c`) is:

```
2.7755575615628914e-17
```

A floating-point residue — effectively zero, but **not** zero. Healthy clips (projects 37, 54)
store exactly `0.0`.

`clampCropToSafeArea` (`src/frontend/src/utils/rotationSafeArea.js:97`) early-outs only on a
**falsy** angle:

```js
export function clampCropToSafeArea(crop, W, H, thetaDeg, r) {
  if (!thetaDeg) return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  const S = safeAreaForAspect(W, H, thetaDeg, r);
  ...
  const x = Math.min(Math.max(crop.x, S.x0), maxX);   // <-- pins the crop
```

`2.78e-17` is truthy, so the guard is skipped and the rotation-safe-area clamp runs for a rotation
of essentially zero. Reproduced directly against the shipped module:

```
crop = {x:660, y:0, width:607.5, height:1080}, W=1920 H=1080 r=9/16
rot = 0                    -> x stays 660
rot = 2.7755575615628914e-17 -> x forced to 656.25
```

So every drag past x=656.25 is clamped straight back. That is the snap-back, and it explains why
only this clip misbehaves: it is the only one carrying a non-zero rotation.

## Two defects, fix both

**1. The guard is exact-zero, not epsilon.** Any denormal or sub-perceptual angle silently engages a
clamp that shrinks/pins the crop. `!thetaDeg` is the wrong test for a float that comes from
trigonometry and user-dial arithmetic.

**2. Something persisted a denormal instead of 0.** Find it. Candidates to check (confirm, do not
guess): `useCrop.setRotation` (`hooks/useCrop.js:327`) and `clampRotation`, the straighten-dial
nudge path (`CropOverlay.jsx:430` `setLiveRotation(prev + delta)` — repeated float addition is a
classic source of `1e-17` residue), and the straighten drag→commit path. Note `CropOverlay.jsx:408`
resets with `if (rotation !== 0) onSetRotation?.(0)` — a **strict** compare, so a denormal survives
"reset" as a no-op only if it is already 0; verify which way it behaves.

A fix at the guard alone leaves garbage in the DB; a fix at the writer alone leaves every existing
affected clip broken. Do both, and say whether existing rows need a heal.

## Scope / decisions to state

- Pick the epsilon deliberately and justify it against `MAX_ROT` and the dial's finest step —
  it must be small enough never to swallow a real user adjustment, large enough to kill FP residue.
  Snapping to exactly `0` below the epsilon at the WRITE side is preferable to only guarding reads.
- Check the **backend twin**: `src/backend/app/services/rotation_safe_area.py` is documented as kept
  in sync with the JS. If it has the same exact-zero test, the render path can disagree with the
  editor. State a decision either way — a silently diverging pair is worse than either bug.
- Decide whether existing `working_clips.rotation` rows carrying residue need a migration. There is
  at least one on staging; check whether prod has any before proposing one (read-only; the
  supervisor can run the audit).

## Watch out for

- `rotation` reaches persistence through the gesture path (CLAUDE.md § *Persistence: Gesture-Based,
  Never Reactive*) — one hold = one `set_rotation`. Do not introduce a reactive write while fixing
  the writer.
- `T5640`/`T5690` own the straighten tool and dial; read them before changing dial arithmetic.
- Do NOT change the crop drag math itself. The drag is correct; the clamp is what is wrong.
- The console warning the user saw (`Unable to preventDefault inside passive event listener`) is a
  **separate, pre-existing** noise line — do not chase it as the cause, but note whether it points at
  a real passive-listener problem worth its own task.

## Acceptance criteria

1. A red-first unit test on `clampCropToSafeArea` proving a denormal angle currently pins the crop
   and no longer does after the fix (use the measured values above).
2. The writer fixed so a sub-epsilon angle persists as exactly `0`, with the source of the residue
   named.
3. A stated decision on `rotation_safe_area.py` (the backend twin) with evidence of whether it
   shares the defect.
4. A stated decision on healing existing rows.
5. Frontend unit suite green. **Baseline 2026-07-28: 139 files passed.**
