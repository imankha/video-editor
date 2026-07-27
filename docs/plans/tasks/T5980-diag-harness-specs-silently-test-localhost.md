# T5980: 8 dev-harness E2E specs hardcode localhost:5173, so a "staging" run silently proves them against local dev

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-26
**Found by:** the 2026-07-26 full staging E2E sweep

## The problem

The suite can be pointed at a deployed target with `E2E_BASE_URL` / `E2E_API_BASE`
(`playwright.config.js`), and `helpers/targetEnv.js` exists precisely so specs that CANNOT run
on a deployed build skip **loudly** instead of failing mysteriously.

These 8 specs bypass that entirely by hardcoding an **absolute** URL:

```
e2e/T5380b-cropoverlay-first-drag.qa.spec.js      -> http://localhost:5173/cropdiag.html
e2e/T5450-overlay-circle-and-loop.qa.spec.js      -> http://localhost:5173/overlaydiag.html
e2e/T5610-manual-override.qa.spec.js              -> http://localhost:5173/overlaydiag-t5610.html
e2e/T5643-move-spotlight-hint.qa.spec.js          -> http://localhost:5173/overlaydiag-t5643.html
e2e/T5644-region-lever-touch.qa.spec.js           -> http://localhost:5173/regiondiag.html
e2e/T5676-aspect-stage-alignment.qa.spec.js       -> http://localhost:5173/aspectdiag.html
e2e/T5860-collectionplayer-modal-backdrop.qa.spec.js -> http://localhost:5173/collectionplayerdiag.html
e2e/bug38-harness.qa.spec.js                      -> http://localhost:5173/bug38diag.html
```

During a staging run they therefore drive **the developer's local dev server** and report
green — a result that says nothing about staging. **They pass either way, which is strictly
worse than failing:** the run looks like it covered those behaviours on staging when it did
not. Observed live on 2026-07-26: with `E2E_BASE_URL` set to staging, `T5380b` and
`bug38-harness` passed in ~1s because port 5173 happened to be up locally.

The `*diag.html` pages are Vite-dev-only harnesses — they are not inputs to the production
build, so on a deployed target the CF Pages SPA catch-all serves `index.html` instead and the
harness never mounts.

## Precedent set on 2026-07-26 (follow it)

`T5647-timeline-autoscroll.qa.spec.js` was the ONE spec using a **relative** harness path, so
it actually hit staging, got the SPA shell, and failed with two 60s timeouts plus a
`getBoundingClientRect of null`. It was fixed by:

1. `skipOnDeployedTarget(test, '...')` at describe-body level, and
2. a new `dev-harness` category registered in `LOCAL_ONLY_SPECS` (`helpers/targetEnv.js`),
   whose category comment already documents this inconsistency and says it is
   "pre-existing and worth unifying" — that is this task.

## What to do

For each of the 8 specs:
- Change the hardcoded `http://localhost:5173/...` to a **relative** path (so a local run,
  where `baseURL` already IS the dev server, is unchanged), AND
- add `skipOnDeployedTarget(test, ...)` with a reason naming the harness page, AND
- register the file in `LOCAL_ONLY_SPECS` under category `dev-harness`.

Net effect: local runs behave exactly as today; a staging run announces "these N harness specs
are skipped and why" instead of silently testing localhost.

## Watch out for

- **T5450, T5610 and T5643 SHARE one generated fixture**, `public/overlaydiag-sample.mp4`:
  each `beforeAll` creates it with ffmpeg if absent and each `afterAll` DELETES it. That is
  safe only because `workers: 1`. Do not make it worse; consider (but do not require) a
  per-spec filename so a future parallel run cannot have one spec delete another's fixture
  mid-test.
- Do not simply delete these specs — they are the real-browser proofs that jsdom cannot give
  (T5390's first attempt passed jsdom and failed on real touch). The goal is honest reporting,
  not less coverage.

## Acceptance criteria

1. All 8 specs use a relative harness path + `skipOnDeployedTarget` + a `LOCAL_ONLY_SPECS`
   entry with category `dev-harness`.
2. `npm run test:e2e` locally (dev stack up): the same specs run and pass as before — show the
   before/after pass counts, not just "tests pass".
3. Pointed at staging: those specs SKIP with a printed reason; the run reports zero failures
   from them.
4. `e2e/STAGING-GATE.md` updated if the excluded set it documents changes.
5. The "pre-existing and worth unifying" note in `helpers/targetEnv.js` is removed/updated,
   since it will no longer be true.
