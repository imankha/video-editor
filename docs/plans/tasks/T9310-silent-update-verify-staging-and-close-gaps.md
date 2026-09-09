# T9310: Silent app update (T8460): confirm it actually works on staging, then close the residual gaps

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-09
**Updated:** 2026-09-09

## Problem

T8460 ("silent app update, no blocking interstitial") landed on master 2026-09-03 (commit `8f479621`,
build 4437) to delete the blocking full-screen wall ("A new version is ready" / "Update now") and
replace it with a passive bottom-right progress card that never requires a click.

On 2026-09-09 the user reported **still seeing the old blocking popup on staging**. That has to be
explained before anything else is changed: either the fix is not reaching users, or the sighting has
a benign explanation. This task settles that, then closes three real gaps found while reviewing the
shipped implementation.

### Evidence already gathered (2026-09-09, do not re-derive)

| Check | Result |
|-------|--------|
| `GET https://reel-ballers-api-staging.fly.dev/api/version` | build **4815** |
| staging `index.html` script | `/assets/index-DYAeD_Dj.js` |
| that bundle's baked build (`[Build] 58bc34b0 (#4815)`) | **4815** |
| `"A new version is ready"` in that bundle | **0 occurrences** |
| `"Update now"` in that bundle | **0 occurrences** |
| `"Updating to the latest version"` / `update-progress-card` | 1 each |
| prod `GET https://api.reelballers.com/api/version` | build **4290** (still pre-T8460) |

So the code staging currently serves contains only the new silent card. The old wall is not in it.

### Leading hypothesis (NOT yet confirmed)

**The bundle that decides how to present an update is the OLD one, not the new one.** A browser whose
service-worker precache predates build 4437 boots the old T5070 code, sees the server is ahead, and
draws its own blocking wall. Staging's new bundle is already downloaded and waiting behind it.
Clicking "Update now" is what lets the new code take over. This burns off **once per browser profile
per device**, so a phone, a second laptop, or a container-port origin each still owe one wall.

This is plausible but unproven against the user's actual sighting. If a client that was already on
build 4437 or higher drew a blocking wall, the hypothesis is dead and this is a real bug.

## Solution

Two parts, in order. Part 1 gates Part 2: do not start changing update logic until the staging
sighting is explained.

### Part 1: explain the staging sighting

1. Establish what build the user's client was running **at the moment the wall appeared**.
   `src/frontend/src/main.jsx:26` prints `[Build] <hash> (#<number>)` on every boot. Below 4437
   confirms the stale-client theory. At or above 4437 refutes it.
2. If refuted, treat it as a live bug and reproduce it. Real-SW coverage already exists as a fixture
   (`e2e/T6230-update-gate-real-sw.spec.js`, `npm run test:e2e:sw-gate`) and can serve two genuinely
   different builds from a self-owned origin, which is the only honest way to exercise this.
3. Either way, investigate one mechanism that could legitimately keep staging clients stale longer
   than expected, because it is real regardless of the outcome above:
   **`registerType: 'prompt'` plus a deliberately no-op `onNeedRefresh`**
   (`src/frontend/src/utils/pwaUpdate.js:86-152`) means the ONLY thing that ever activates a waiting
   bundle is `checkServerVersion` -> `requireUpdate` -> `runUpdate`. A client that never trips
   `checkServerVersion` (a logged-out visitor making no API calls, or one sitting inside the
   5-minute probe cooldown) can hold an old bundle indefinitely with the new one installed and
   waiting. Confirm whether that window is as wide as it looks, and whether it explains repeat
   sightings.
4. Also check the mundane deploy-plumbing candidates before concluding: Cloudflare Pages cache
   headers on `index.html`, and `cleanupOutdatedCaches` / `navigateFallback` behavior in
   `src/frontend/vite.config.js:38-84`.

Record the verdict in the Progress Log. If it was the one-time transition, say so plainly and close
Part 1: no code change is warranted for it.

### Part 2: close the residual gaps

**Gap A (highest value): a reload can land mid-scrub.**
`isQuiescent` (`src/frontend/src/stores/updateGateStore.js:67`) checks exports, uploads, open modals,
and the 30s cold-boot guard, but never "is the user actively interacting right now". Someone
scrubbing the Focus timeline can be reloaded out from under themselves. Their keyframes survive (the
flush runs the framing save) but playhead, zoom, selection, and undo history are all lost. Add an
input-idle condition, roughly "no pointer or key event for about 5s", so the reload lands in a
genuine pause. Cheap, synchronous, no persistence involved.

**Gap B: a deferred update can stall longer than it should.**
`requireUpdate` only re-tests quiescence when `checkServerVersion` is called again, and that only
fires on an API response or the visibility poll (`src/frontend/src/utils/appVersion.js:104-107`,
`src/frontend/src/utils/pwaUpdate.js:117-151`). Closing a modal, finishing an upload, and the
cold-boot guard expiring are all silent events: none of them re-tests. Add a cheap local re-test.
Quiescence is a zero-network state read, so it can run on a short timer while `isUpdateRequired` is
true, or unthrottled on `visibilitychange` (only the `/api/version` fetch needs the 5-minute
throttle, not the state check).

**Gap C: a missed install window costs a full 5 minutes.**
`PROBE_MIN_GAP_MS` (`src/frontend/src/utils/appVersion.js:68`) is 5 minutes, but the probe waits only
`SW_INSTALL_TIMEOUT_MS` (`src/frontend/src/utils/pwaUpdate.js:21`) = 10s for a still-installing
worker. On a slow connection the first probe after a deploy answers "no bundle" purely because
installation had not finished, and the client is then locked out of probing for 5 minutes.
Distinguish "still installing" from "genuinely nothing waiting" in `probeForWaitingBundle`
(`pwaUpdate.js:216-237`) / `hasNewerBundle` (`appVersion.js:138-166`) and use a much shorter cooldown
(about 30s) for the former.

**Gap D (judgement call, optional):** the "Update paused" Retry button is the last remaining gesture
in the whole flow. A transient network blip on `flush-verify` currently parks a card in the corner
waiting for a click. Consider auto-retrying with backoff a few times and showing Retry only after
those fail, which keeps the zero-gesture promise for the common case. Decide explicitly; do not
silently skip.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/updateGateStore.js` - `isQuiescent` (Gap A), `requireUpdate` re-test (Gap B), `runUpdate` error path (Gap D)
- `src/frontend/src/utils/appVersion.js` - `PROBE_MIN_GAP_MS`, `hasNewerBundle`, `checkServerVersion` (Gaps B, C)
- `src/frontend/src/utils/pwaUpdate.js` - `probeForWaitingBundle`, `SW_INSTALL_TIMEOUT_MS`, resume poll, `onNeedRefresh` no-op (Part 1 item 3, Gap C)
- `src/frontend/src/components/UpdateGateModal.jsx` - the progress card View (Gap D only)
- `src/frontend/vite.config.js` - `VitePWA` options, `registerType`, `cleanupOutdatedCaches` (Part 1 item 4)
- `src/frontend/src/utils/modalOcclusion.js` - `isAnyModalOpen`, consumed by `isQuiescent`
- `src/frontend/src/main.jsx` - the `[Build]` console line used for the Part 1 diagnosis

### Related Tasks
- Follows: T8460 (silent app update, STAGING as of 2026-09-03) and its predecessors T5070 / Tbug40p / Tbug41s
- Note: T8460 has not reached prod yet (prod build 4290 is below 4437). The NEXT prod deploy, whenever
  it happens, will show every prod user the old wall exactly once, for the same stale-client reason.
  That is expected, not a regression, and is worth saying out loud before the deploy.
- **T8460 gets no special deploy treatment** (decided 2026-09-09). It ships in the normal batch with
  the other ~88 tasks at STAGING. Deploying it early saves nobody a wall: the wall is spent exactly
  once per browser either way, so going early only buys an extra deploy cycle. The only case where
  early would pay is several intermediate prod deploys before the batch, which this repo's cadence
  (prod last deployed 2026-09-01, master 527 commits ahead) does not do.

### Technical Notes
- The gate is deliberately never raised until the new bundle is fully downloaded and installed
  (`registration.waiting` confirmed). There is nothing left to download after the trigger, so a
  "disabled Refresh button that enables when ready" would be dead UI: it would be born enabled. The
  only post-trigger latency is one `POST /api/sync/flush-verify` round trip, which is sub-second.
- `exportStore` / `uploadStore` are pulled into `updateGateStore` by **dynamic** import on purpose. A
  static import caused a production-only Rollup TDZ crash. Do not "clean this up".
- Do not turn any of this into a `useEffect` that watches state and writes. The re-test in Gap B must
  stay a scheduled or gesture-driven check, consistent with the project's gesture-based persistence
  rule.

### Existing Test Coverage
- `src/frontend/src/stores/updateGateStore.test.js` - quiescence gating, flush/reload ordering, re-entrancy
- `src/frontend/src/utils/appVersion.test.js` - the build-comparison truth table and bundle-probe cases
- `src/frontend/src/utils/pwaUpdate.test.js` - `onNeedRefresh` must not gate, reloader wiring
- `src/frontend/e2e/update-gate.spec.js` - T8460 non-blocking assertions at 1280px and 390x844
- `src/frontend/e2e/T6230-update-gate-real-sw.spec.js` - real SW lifecycle across two real builds (`npm run test:e2e:sw-gate`)

## Implementation

### Steps
1. [ ] Part 1: establish the client build at the time of the sighting; confirm or refute the stale-client hypothesis
2. [ ] Part 1: investigate the `registerType: 'prompt'` + no-op `onNeedRefresh` activation window
3. [ ] Part 1: check Cloudflare Pages cache headers on `index.html` and the SW cleanup options
4. [ ] Part 1: write the verdict into the Progress Log before touching update logic
5. [ ] Gap A: add an input-idle condition to `isQuiescent`
6. [ ] Gap B: re-test quiescence on a cheap local trigger, not only on `checkServerVersion`
7. [ ] Gap C: separate "still installing" from "nothing waiting" and shorten that cooldown
8. [ ] Gap D: decide on auto-retry before Retry, and record the decision either way
9. [ ] Extend the three unit test files for each gap actually changed
10. [ ] Run `npm run test:e2e:sw-gate` plus `e2e/update-gate.spec.js`

### Progress Log

**2026-09-09**: Filed from a user report of the old blocking popup on staging. Verified staging serves
build 4815 with zero occurrences of the old wall's strings, so the deployed code is correct and the
sighting most likely came from a stale client bundle. That remains unconfirmed and is Part 1 of this
task. The three gaps in Part 2 were found by reading the shipped T8460 implementation and are
independent of how Part 1 resolves.

## Acceptance Criteria

- [ ] The staging sighting has a written, evidence-backed explanation: either confirmed stale client (no code change needed) or a reproduced bug with a fix
- [ ] The activation window created by `registerType: 'prompt'` + no-op `onNeedRefresh` is characterized, and either bounded or documented as acceptable
- [ ] An update never reloads the page while the user is actively interacting with an editor
- [ ] An update deferred for non-quiescence resumes without needing new API traffic to nudge it
- [ ] A probe that misses the install window retries in well under 5 minutes
- [ ] Gap D has an explicit recorded decision
- [ ] Unit tests cover each changed gap; `npm run test:e2e:sw-gate` and `e2e/update-gate.spec.js` pass
