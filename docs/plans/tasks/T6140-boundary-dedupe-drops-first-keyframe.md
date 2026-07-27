# T6140: removeBoundaryDuplicates self-compares the first keyframe and silently deletes it on restore

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-07-27
**Found by:** T6050 while re-pinning `keyframe-integrity.spec.js`; independently verified by the
supervisor against `keyframeController.js` on master before filing.

## The bug

`src/frontend/src/controllers/keyframeController.js:158`:

```js
function removeBoundaryDuplicates(keyframes) {
  if (keyframes.length <= 2) return keyframes;
  const startKf = keyframes[0];
  const endKf = keyframes[keyframes.length - 1];
  const threshold = MIN_KEYFRAME_SPACING * 3;                    // = 10 * 3 = 30

  return keyframes.filter(kf => {
    if (kf.frame > 0 && kf.frame < threshold && hasSameSpatialData(kf, startKf)) return false;   // <-- no self-exclusion
    if (kf.frame < endKf.frame && endKf.frame - kf.frame < threshold && hasSameSpatialData(kf, endKf)) return false;
    return true;
  });
}
```

The two branches are **asymmetric**:

- The **end** branch excludes itself correctly — when `kf === endKf`, `kf.frame < endKf.frame` is
  false, so the last keyframe can never delete itself.
- The **start** branch guards only with `kf.frame > 0`. When `kf === startKf` and `startKf.frame`
  is in **1..29**, that is true, `kf.frame < threshold` is true, and
  `hasSameSpatialData(startKf, startKf)` is **trivially true** — so the filter returns false and
  **the first keyframe deletes itself.**

Trigger conditions (all three required):
1. `keyframes.length >= 3` (the early return covers 0-2), and
2. the first keyframe's frame is **1..29** (not 0, not >= 30), and
3. restore runs `removeBoundaryDuplicates` — `keyframeController.js:218`, on the RESTORE path.

## Why this is Impact 8

This is **silent crop-data loss on load**, not a cosmetic glitch. The function's stated purpose is
cosmetic ("so two diamonds don't visually stack at an edge"), but the deletion is applied to the
restored keyframe list, so the user opens a clip and their first crop keyframe is simply gone.

It is reachable with ordinary data: persisted crop keyframes carry **no frame-0 guarantee**. Under
the flat-list model (permanent boundaries removed ~2026-06-21) the first keyframe is wherever the
user first moved the crop box, which is frequently a low frame number on a trimmed clip.

This is the same family as two incidents that already happened: T350 (origin corruption via
reactive persistence) and the keyframe identity divergence healed by profile_db v014. That history
is exactly why `keyframe-integrity.spec.js` exists.

## What to do

1. **Reproduce first**, with a unit test on the controller: restore `[{frame:5,...},{frame:60,...},
   {frame:120,...}]` where the frame-5 entry has spatial data that trivially matches itself, and
   show the frame-5 keyframe is dropped. Red before, green after.
2. Fix the self-exclusion. The end branch already shows the correct shape — the start branch should
   exclude `kf === startKf` the same way (e.g. `kf.frame > startKf.frame` rather than `kf.frame > 0`).
   Match the existing idiom; do not restructure the function.
3. **Decide whether the cosmetic dedupe belongs on the RESTORE path at all.** It is described as a
   display concern, but it mutates restored user data before it is shown, and CLAUDE.md § *Runtime
   fixups are memory-only* means such a fixup must never reach persistence. Check whether a
   subsequent save can write the de-duplicated list back — if it can, that is a second, worse bug
   (compounding loss across load cycles, exactly the T350 mechanism) and must be reported.
4. Check the sibling call sites of `hasSameSpatialData` for the same self-comparison shape.

## Watch out for

- `keyframeController.test.js:793` has a test whose comment describes the cosmetic drop as intended
  behaviour. Read it before changing anything — decide whether it pins the correct case (a genuine
  neighbour duplicate) or the buggy one (self-comparison), and give it an explicit disposition.
- `keyframe-integrity.spec.js` was re-pinned by T6050 on 2026-07-27 and deliberately uses a
  first-frame of 35 (above the threshold) plus an INV-3 case pinning the safe boundary, so the spec
  stays honestly green while this bug exists. **After the fix, revisit INV-1/INV-3** — they can then
  cover the previously-unsafe range. Coordinate; do not silently invalidate T6050's work.
- Do NOT "fix" this by removing `removeBoundaryDuplicates` wholesale without establishing what the
  genuine duplicate case is — there is a real cosmetic problem it was written to solve.

## Acceptance criteria

1. A red-first controller unit test proving the first keyframe is dropped, then passes after the fix.
2. The fix, with the start/end branches symmetric in their self-exclusion.
3. A stated answer to whether the de-duplicated list can ever be persisted back (and a report, not a
   fix, if it can).
4. A disposition for `keyframeController.test.js:793`.
5. Frontend unit suite green. **Baseline on master 2026-07-27: 139 files passed.**
