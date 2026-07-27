# T6110: Three staging specs act on a placeholder before the video is ready — gate them properly

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-27
**Pairs with:** T6100 (the root-cause question). This task hardens the specs REGARDLESS of what
T6100 concludes — a spec that asserts on a not-yet-hydrated stage is wrong even if the app is fast.

## The three specs

| Spec | Failure observed on staging `81a6aad9` |
|---|---|
| `T4550-overlay-transform.qa.spec.js:59` | crop drag `(-40,-30)` measured `-9.25`, then **exactly `0`** on re-run |
| `T5676-aspect-stage-alignment.qa.spec.js:144` | `waitForFunction` on `overlay-video-stage` inline `aspect-ratio` — **240 s timeout** |
| `bug38-autoselect-and-frame-step.qa.spec.js:63` | `locator.click` 8 s timeout (`[PERF] leg-err:overlay`) |

## Why this is a real defect and not "just a flake"

T4550 asserts `await expect(cropBox).toBeVisible()` and then immediately drags. The crop box is
**visible while the video is still loading** — the evidence screenshot
`qa/T4550-crop-overlay-placed.png` shows it rendered over a stage reading
**"Loading… / Connecting to server…"**. So the readiness gate the spec relies on is satisfied by a
placeholder, and the drag is measured against a stage that has no video geometry.

That makes the test's own diagnostic **actively misleading**: its comment says a `0,0` measurement
means the T5380 first-drag race regressed. It measured `0,0`, and the T5380 fix is intact
(`attachDragListeners` is still called synchronously from pointer-down on master). A future
engineer following that comment would go hunting a regression that isn't there — which is exactly
what happened during triage on 2026-07-27.

## What to do

1. **Find the true ready-signal for each surface** and gate on THAT, not on an element being
   visible. T5676 already identifies the correct one for the overlay stage (the inline
   `aspect-ratio` appearing once `useAspectStage` flips) — its problem is not the signal but that it
   waits 240 s and still never gets it, which is T6100's question. For Framing, find the equivalent
   signal for "video loaded and display rect measured" and use it.
2. **Do not fix this by raising timeouts.** A longer wait on a broken signal is the same bug with a
   slower failure. If the correct signal never arrives, the spec must fail with a message that says
   *the video never hydrated*, not *the drag was inaccurate*.
3. **Fix T4550's misleading comment** so a `0,0` measurement no longer claims "T5380 regressed"
   unconditionally. It should distinguish "video never became ready" (environment/product) from
   "video ready but the first drag was dropped" (the real T5380 regression). Preserving that
   distinction is the point — do not delete the T5380 guard, make it honest.
4. Reuse the existing helpers rather than inventing another: `e2e/helpers/appReady.js`
   (`waitForAppReady`) and the `assertSeamAvailable` / data-gate conventions in `helpers/targetEnv.js`.
   `networkidle` is BANNED on deployed targets (never settles against a CDN).

## Watch out for

- These are `@staging-gate` specs driving a REAL account (`loginAsRealUser`), so they depend on
  staging fixture data. A data-dependent gate must **skip loudly with a reason**, never pass
  vacuously — the convention is already documented in `e2e/FIXTURE-CONTRACT.md`.
- `bug38-autoselect-and-frame-step` also still carries an `@staging-gate` title tag that T5980
  flagged as arguably redundant; that is cosmetic and NOT in scope here.
- Confirm each fix against staging, not just locally — the failure only manifests there.

## Acceptance criteria

1. Each of the three specs gates on a real readiness signal, with the signal named per spec.
2. A demonstration that when the video does NOT hydrate, each spec now fails (or skips) with a
   message naming hydration — not with a misleading domain assertion.
3. All three green against staging, run output shown. If one cannot pass because the app genuinely
   never hydrates, say so and hand that to T6100 rather than forcing it green.
4. T4550's T5380 comment rewritten to distinguish the two causes of a `0,0` measurement.
