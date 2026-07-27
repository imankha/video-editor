# T6100: The Framing/Overlay video stage does not hydrate on staging — root-cause it

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-27
**Found by:** the full staging E2E on `81a6aad9` (4 failures, 2 reproduced deterministically on re-run)

## The evidence — read this before forming a theory

A full staging E2E run gave `108 passed / 175 skipped / 4 failed`. Re-running the four in
isolation reproduced two of them **deterministically**, and both fail on the same thing.

**T4550 `Framing: crop overlay placed + drag lands accurately`** — a crop drag of `(-40,-30)`
measured `-9.25` on the first run and **exactly `0`** on the re-run. The spec's own comment says
`0,0` is the signature of the T5380 first-drag race regressing — **but it is not that.** The
saved evidence screenshot (`qa/T4550-crop-overlay-placed.png`, captured immediately before the
drag) shows the video area displaying **"Loading… / Connecting to server…"** with the crop box
rendered at `205x364 @ (657,156)`. The crop box is a placeholder over a stage whose video never
loaded. Verified on master: `attachDragListeners` (`CropOverlay.jsx:~310`) is still a `useCallback`
invoked synchronously from the pointer-down handler, so the T5380 fix is structurally intact.

**T5676 `no pillarbox + overlays stay aligned across widths & fullscreen`** — `page.waitForFunction`
at `:90` waiting for `[data-testid="overlay-video-stage"]` to receive its inline `aspect-ratio`
style (set when `useAspectStage` flips true). **Test timeout of 240000ms exceeded.**

Corroborating, from the same run:
- `[PERF] leg-skipped:annotate err=Error: leg-budget-exceeded` and `[PERF] leg-err:overlay
  TimeoutError: locator.click: Timeout 8000ms exceeded`.
- A `[T5420][SKIP]` message names the same class in a different surface: *"The Overlay export panel
  did not mount (framingVideoUrl not hydrated for a pre-framed single-clip draft opened directly
  into Overlay)."*

So: **four failures, one theme — media/stage hydration on staging.**

## The actual question

Is this a **product defect**, **staging infrastructure**, or **test impatience**? All three are
plausible and they have completely different fixes. Do not assume "flaky test" and raise timeouts —
that is the outcome this task exists to prevent.

Weigh at minimum:
1. **Product** — media URL resolution / signing / hydration ordering. `framingVideoUrl` failing to
   hydrate for a pre-framed single-clip draft opened directly into Overlay is already named by the
   T5420 skip, and that is a real user path, not a test artifact.
2. **Infra** — R2 / CDN / Fly cold start. Note memory `project_t3760_overfetch_harmless` measured R2
   deep reads FAST (266 ms TTFF), so tens of seconds of "Connecting to server…" is NOT the expected
   baseline and should not be waved through as "R2 is slow".
3. **Test** — asserting on a placeholder that is visible before the video is ready (see T6110,
   which fixes the specs regardless of what this task finds).

**Do this by measurement, not inspection.** Load the same staging draft as a real user
(`drive-app-as-user` skill, `loginAsRealUser`) and instrument: when is the video URL requested,
what status/latency does it return, when does `useAspectStage` flip, does it EVER complete or does
it hang forever? A hang and a slow-load are different bugs.

## Watch out for

- **This is exactly the class the earlier sweep got wrong once already.** On 2026-07-26 a
  copy-link failure was first misdiagnosed as a clipboard-permission issue when the real cause was
  a fixed 2500 ms sleep racing a ~4 s staging POST. Measure before concluding.
- Staging and prod are both at schema head (verified 2026-07-27), so this is NOT a migration-window
  symptom. Do not go down that path.
- If it turns out to be a real product defect on the `framingVideoUrl` hydration path, STOP and
  report before fixing — that is a separate, higher-impact task and may block a prod deploy.

## Acceptance criteria

1. A measured timeline for a real staging draft: video URL request time, response status + latency,
   and when (or whether) `useAspectStage` flips. Numbers, not adjectives.
2. A stated verdict — product / infra / test — with the evidence that discriminates between them.
3. If product: the defect named precisely (file + path), and reported before any fix.
4. If infra: what is slow, why, and whether it affects real users or only cold staging.
5. Either way, a written answer to "does this affect production users?" — that is the question
   gating the next prod deploy.
