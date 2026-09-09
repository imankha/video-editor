# T9340: Why does the version update take so long?

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-09
**Updated:** 2026-09-09 (promoted into the Fast App Update epic as its gating child)

**Epic:** [Fast App Update](EPIC.md), child 1/4. **This task gates T9360, T9370 and T9380** - whichever leg it shows to dominate gets implemented first, and a leg it shows to be noise may be dropped outright.

## Problem

User report 2026-09-09: updating to a new app version takes a long time. This is a LATENCY question,
distinct from T9310, which asks whether the silent update works at all and is already in STAGING.

T8460 replaced the blocking "A new version is ready" wall with a passive progress card. Nobody has
measured the wall-clock between "the server is on a newer build" and "the user is running it", and
three separate stalls are visible in `utils/pwaUpdate.js` without measuring anything. Tuning any one
of them before knowing which dominates would be guessing.

### The three known stalls

1. **`PROBE_MIN_GAP_MS` vs `SW_INSTALL_TIMEOUT_MS`.** `UPDATE_CHECK_MIN_GAP_MS` is 5 minutes
   (`pwaUpdate.js:9`); the bundle probe waits `SW_INSTALL_TIMEOUT_MS` = 10 seconds
   (`pwaUpdate.js:21`) for an `installing` worker to become `waiting`. A slow connection that misses
   the 10s window answers "no bundle yet" and then cannot re-probe for a full 5 minutes, even if the
   precache finished at second 11. T9310 Part 2 gap (C) names this same ratio.

2. **Quiescence is only re-tested on API traffic.** A deferred update waits for the app to look idle,
   and that check is driven by new API requests. A user reading a page, or one who just closed a
   modal, generates none - so a ready update can sit indefinitely. T9310 Part 2 gap (B).

3. **The activation round trip.** `skipWaiting` -> `controllerchange` -> page reload, with a 3.5s
   escalation to a manual bust-and-reload when Safari does not fire the event
   (`SW_ACTIVATE_TIMEOUT_MS`, `pwaUpdate.js:15`). Paid on top of everything above.

There is also a structural contributor: `vite.config.js` uses `registerType: 'prompt'` with a
deliberately no-op `onNeedRefresh`, so the ONLY thing that ever activates a waiting bundle is
`checkServerVersion`, which itself rides `visibilitychange` and the 5-minute gap. T9310 already
flagged characterizing this window as part of its Part 1.

## Solution

Investigation only. Deliverable is a measurement plus a ranked recommendation, not a patch.

1. Instrument or trace the full path on a real deploy: server build changes -> `checkServerVersion`
   fires -> probe result -> quiescence decision -> activation -> new bundle boots. Record the
   wall-clock of each leg. `main.jsx:26`'s `[Build] <hash> (#<number>)` line is the ground truth for
   which bundle is actually running at each point.
2. Do it on at least two profiles: a warm desktop tab left open, and a mobile PWA resumed from
   background (the case where `visibilitychange` is the only trigger and background timers are
   frozen).
3. `e2e/T6230-update-gate-real-sw.spec.js` (`npm run test:e2e:sw-gate`) already serves two genuinely
   different builds from a self-owned origin. It is the honest harness for this - use it rather than
   simulating.
4. Report which leg dominates, with numbers, and recommend the smallest change that moves it.

## Files

Read-only:

- `src/frontend/src/utils/pwaUpdate.js`
- `src/frontend/src/utils/appVersion.js`
- `src/frontend/src/stores/updateGateStore.js`
- `src/frontend/src/components/UpdateGateModal.jsx`
- `src/frontend/vite.config.js` (the `registerType` setting)
- `e2e/T6230-update-gate-real-sw.spec.js`

## Tests

No production code changes, so no new unit tests. The measurement runs through the existing
`test:e2e:sw-gate` fixture; any instrumentation added to take the measurement is removed before the
task closes, or landed deliberately as a logging change with its own justification.

## Notes

- Tier M, investigation. Read-only on production code.
- **Do not implement any fix here.** Fixes belong to the epic's other three children, one per leg.
- T9310 (STAGING, merged 2026-09-09) ALREADY closed its gaps A, B and C: `isQuiescent` gained a ~5s
  input-idle condition, a 2s interval re-tests quiescence while an update is pending, and a
  still-installing probe re-tries after ~30s instead of the full 5-minute lockout. Gap D (auto-retry
  of `flush-verify`) was explicitly DEFERRED. Measure the world AFTER those landed, and do not
  re-report them as findings.
- Note from T9310: T8460 is not on prod yet (prod was on build 4290, T8460 landed in 4437), so the
  next prod deploy shows every existing user the OLD blocking wall exactly once. Any latency number
  measured on staging describes the post-4437 world only.

## Findings (2026-09-09, measured on the T6230 real-SW harness)

**Verdict: the dominant leg is TIME TO NOTICE, by orders of magnitude. It is a POLICY cost
(throttle constants + missing trigger), not a bytes-or-mechanics cost. The other two legs are
seconds. Implement T9360 (notice) first. T9380 (activate) is a drop candidate pending a real-iOS
number. T9370 (fetch) is not droppable — but only because of one fat chunk, and it matters on
cellular, not wifi.**

### How this was measured

- Harness: `e2e/T6230-update-gate-real-sw.spec.js`'s fixture (`helpers/staticBuildServer.js`) —
  two genuinely-different real production builds served from a self-owned `localhost` origin with a
  real ServiceWorker. A temporary measurement spec (`e2e/T9340-latency-measure.spec.js`, **removed
  before PUSHREADY**) reused that fixture to stopwatch each leg on two profiles (warm desktop tab;
  mobile-viewport PWA driven only by a `visibilitychange` resume). Existing `test:e2e:sw-gate` stays
  green (3 passed, 1.3m).
- Source re-verified against current code (T9310 has landed): `SW_ACTIVATE_TIMEOUT_MS`
  `pwaUpdate.js:15`, `SW_INSTALL_TIMEOUT_MS` `:21`, `UPDATE_CHECK_MIN_GAP_MS` `:9`; `PROBE_MIN_GAP_MS`
  `appVersion.js:68`, Gap-C `PROBE_RETRY_WHILE_INSTALLING_MS`=30s `:73`. The three known stalls still
  exist; T9310's Gap A/B/C mitigations are in place and are **not** re-reported below.
- Honest harness limits, stated so no number is over-claimed: (a) `localhost` transfer is
  near-instant, so the *fetch* stopwatch (~1.9s, poll-cadence-quantized and identical on both
  profiles) is **not** a real-network number — the fetch cost is derived from actual built-asset
  bytes instead; (b) the Chromium engine cannot reproduce iOS Safari's flaky `controllerchange`, so
  the *activate* 3.5s Safari escalation path is reasoned from source, not stopwatched; (c) the
  harness resets `lastCheckAt`/`lastProbeAt` to 0 on every load, so it **structurally bypasses the
  notice throttle** — which is exactly why the dominant leg cannot be a stopwatch number and is
  derived from the call graph.

### Leg 1 — TIME TO NOTICE (dominant)

`checkServerVersion` (the only path that raises the gate) has exactly three callers:
`sessionInit.js:119` (fires on **every** API response), `pwaUpdate.js` on-load `GET /api/version`
(once per page load), and `onReturnToApp` (`visibilitychange`/`pageshow`, throttled by
`UPDATE_CHECK_MIN_GAP_MS`=5min via `lastCheckAt`). The probe inside it (`hasNewerBundle`) is
independently throttled by `PROBE_MIN_GAP_MS`=5min via `lastProbeAt`. Consequence by profile:

| Profile | Time to notice | Why |
|---------|----------------|-----|
| Warm desktop tab, **actively** making API calls | **seconds** | next API response runs `checkServerVersion`; the first post-deploy probe fires immediately because `lastProbeAt` is stale (the 5-min gap only throttles *repeat* probes — the staging storm guard) |
| Warm desktop tab, **visible but idle** (reading a page, no API calls, no tab-switch) | **effectively unbounded** | nothing calls `checkServerVersion` at all — no API response, no visibility change. Matches T9310 Part 1's own verdict |
| Mobile PWA **resumed from background** | **until the user next foregrounds it, AND only if >5min since the last check** | backgrounded timers are frozen and there is no API traffic, so notice cannot even *start* until resume; on resume `onReturnToApp` early-returns if `lastCheckAt` is <5min old, so a quick background/resume gets **no** check |

The dominant cost is therefore structural: **there is no time-based trigger for a visible-idle tab,
and a 5-minute gate on the resume trigger.** This is where "minutes to unbounded" comes from.

### Leg 2 — TIME TO FETCH (real, but bimodal; matters on cellular only)

Built-asset facts (real production build, `npm run build`): 13 JS chunks, **559 KB gzipped total**
first-load precache (24 precache entries). The distribution is lopsided — a **single
`index-*.js` app chunk is 342 KB gzipped / 1.17 MB raw**; only `vendor-stripe` is split out
(`vite.config.js` `manualChunks`). Everything shared — stores, utils, and `pwaUpdate`/`appVersion`/
`updateGateStore` themselves — lives in that index chunk. Because Vite content-hashes chunks,
Workbox re-downloads only entries whose hash changed, so the re-download is bimodal:

- change isolated to a lazy screen chunk (`AnnotateScreen` 48 KB gz, `FocusScreen` 23 KB gz, …) →
  only that chunk re-downloads: **small**.
- change anywhere in shared code (the common case) → the **whole 342 KB gz index chunk** +
  `index.html` + `sw.js` re-download.

On wifi that 342 KB is sub-second (and the localhost harness confirms it is not the bottleneck). On
constrained cellular (~50–100 KB/s effective) it is ~3–7s — which is the epic's "can dominate on a
phone on cellular." **Not droppable for mobile, but a chunking fix, not a constant.**

### Leg 3 — TIME TO ACTIVATE (smallest; drop candidate)

Measured `notice(mechanical)+activate` round-trip ≈ **1.1s** on Chromium (both profiles), of which
activate (`skipWaiting`→`controllerchange`→workbox reload→new bundle boots) is the bulk. Known
additions, all already tuned by prior work and **not** re-litigated here: the `SW_ACTIVATE_TIMEOUT_MS`
=3.5s Safari escalation (only paid when `controllerchange` doesn't fire — unreproducible on
Chromium), and T9310 Gap A's ~5s input-idle floor (a deliberate "don't reload mid-scrub" floor, not
a fixed cost — it adds latency only if the user is mid-interaction at trigger time). On the evidence
here activate is ~1s of genuine cost — noise next to a multi-minute notice leg.

### Recommendation (smallest change that moves the dominant leg)

1. **T9360 / notice — DO FIRST, biggest lever.** Give the visible tab a time-based trigger it
   currently lacks: a low-frequency scheduled `checkServerVersion` while `document.visibilityState
   === 'visible'` (e.g. every ~30–60s) so a visible-idle tab notices within ~1 min instead of never.
   This reuses the *scheduled-timer* pattern T9310 Gap B already established (its 2s quiescence
   `setInterval`), so it does **not** violate the no-reactive-persistence invariant. Pair it with
   lowering/removing `UPDATE_CHECK_MIN_GAP_MS` on the *resume* path (the check is a cheap `GET
   /api/version` + a `registration.update()`); keep `PROBE_MIN_GAP_MS` as the storm guard, or gate
   it on `serverBuild > clientBuild` so it only fires when there's genuinely something to find. A
   server-push signal (SSE/WS "new build N") would cut notice to ~0 but is a larger change than the
   epic's "smallest change" ask — recommend the visible-tab interval as the MVP and note push as the
   ceiling.
2. **T9370 / fetch — SECOND, and only for cellular.** Split the 342 KB gz `index` chunk: move the
   stable heavy vendor libs (React/Zustand/Router/lucide, and the `html2canvas`/`mp4box` 200 KB-raw
   libs already in their own chunks) into a `manualChunks` vendor bundle so a typical app-code change
   re-downloads a small app chunk, not the vendor bytes. No effect on wifi notice; real help on a
   phone on cellular. Cross-check T8570's bundle findings before starting (epic §Related).
3. **T9380 / activate — DROP CANDIDATE.** ~1s mechanical on Chromium; the only real risk is the iOS
   Safari 3.5s escalation, which this harness cannot measure. Recommend **not** scheduling T9380
   until a real-iOS-Safari activate number exists; if that number is also ~1–4s, drop the leg
   outright per the epic's "a leg it shows to be noise may be dropped."
