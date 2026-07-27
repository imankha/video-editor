# T6060: Three overlay-harness specs flake on real-browser playback — diagnose or document

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-27
**Found by:** the 2026-07-26/27 sweep — observed repeatedly across T5980, T6000 and the supervisor's own runs

## What is wrong

Three real-browser tests fail intermittently on a local run with the dev stack up. They are
**present on master**, before and after T5980 and T6000, so they are not regressions from either:

| Spec | Test |
|---|---|
| `T5450-overlay-circle-and-loop.qa.spec.js` | `press plays (seek to span start), press again pauses; loop wraps at span end` (`:63`) |
| `T5610-manual-override.qa.spec.js` | `3) tap outside the circle does not enter edit; drives tap-nav` (`:150`) — **fails in BOTH pointer contexts**, so 2 of the 3 |

All three involve driving actual `<video>` playback in Chromium against the ffmpeg-generated
`public/overlaydiag-sample.mp4` fixture.

**They are not in `docs/testing/known-failures.md`**, which is the actual problem: every worker
that touches this spec family rediscovers them, re-triages them, and has to prove they are
pre-existing. That has now happened at least three times.

## What to do — diagnose and FIX

**Updated 2026-07-27 (user direction): "even flakes need to be solved."** Parking these in
`known-failures.md` is NOT an acceptable outcome. A spec that fails intermittently is either
testing something that intermittently breaks (a product defect) or is badly written (a test
defect) — both get fixed. The baseline file is for debt awaiting a task; this IS the task.

1. **Try to make them deterministic.** Likely causes, in rough order — confirm, don't assume:
   - autoplay policy / `play()` returning a rejected promise that the test never awaits
   - asserting on `currentTime` before a `seeked`/`timeupdate` event has fired
   - the loop-wrap assertion racing the end-of-span boundary
   - the shared fixture's duration/keyframe layout making a seek land unpredictably
   Prefer waiting on real media events over `waitForTimeout`. A fixed sleep racing a slow
   operation is exactly the bug pattern that produced the copy-link toast failure on 2026-07-26.
2. **Each of the three must end deterministic.** If a fix requires changing the fixture, the
   readiness signal, or the assertion, do that. If the flake turns out to be the APP being
   non-deterministic (a real playback bug), stop and report it — that is a product defect and a
   separate, higher-impact task, not something to absorb into the test.
3. Adding rows to `known-failures.md` and re-populating `branch-ci.yml`'s `--deselect` list is
   explicitly NOT the deliverable. That list was emptied on 2026-07-27; leave it empty.
4. **Prior art from the same day, reuse it:** T6110 covers three staging specs that act on a
   visible-but-not-ready placeholder, and the general "assert on a real ready-signal, never on
   element visibility or a fixed sleep" lesson applies here too. Check whether these three share
   that root cause before writing anything new.

## Watch out for

- `public/overlaydiag-sample.mp4` is created by ffmpeg in `beforeAll` and DELETED in `afterAll`,
  SHARED across T5450 / T5610 / T5643. Safe only because `workers: 1`. If you change its duration
  or encoding to stabilize a seek, you change it for all three specs — check the others still pass.
- These are `dev-harness` registered (T5980): relative paths + `skipOnDeployedTarget`. A staging
  run SKIPS them, so "green on staging" is not evidence. Run locally with the dev stack up.
- Parse Playwright's own summary line, not the wrapper exit code.

## Acceptance criteria

1. Per test: a stated verdict — fixed (with the race named and the fix shown) or documented in
   `known-failures.md` with master-clean failure evidence.
2. If anything is added to the baseline, `branch-ci.yml`'s deselect list is updated to match.
3. A repeat-run demonstration for anything claimed fixed (e.g. `--repeat-each=5` green), because a
   single green run does not distinguish "fixed" from "got lucky".
