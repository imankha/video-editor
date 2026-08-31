# The `@staging-gate` pre-deploy gate (T5400, lanes: T7800)

`@staging-gate` is a **curated, fast, reliable subset** of the E2E suite that answers a
single question in one run: **"is staging safe to promote to prod / start manual testing?"**
It is separate from the full local suite (which mixes reliable specs with local-only /
data-heavy ones). Against staging the gate targets **under ~20 min wall clock**, achieved
by running three parallel LANES (T7800).

## Lanes (T7800)

Every gate member carries `@staging-gate` plus a lane tag in its title (`T5676` spans
two lanes, one per describe). Each lane runs as its OWN Playwright process with its own
account env, because specs read `E2E_REAL_EMAIL` / `E2E_REAL_PROFILE` into module
constants at import time (per-process env is the account seam; Playwright projects
cannot set per-project env). EVERY lane gets its own account: concurrent write sessions
on one account cause `stale_baseline` R2 CAS freezes, and even a light-write/read
pairing is only provably safe when staging runs a single API machine (a second machine
gives each session its own profile.sqlite copy, and the CAS loser freezes; staging has
`auto_start_machines = true`, so the machine count is not guaranteed). Alias clones are
one seed command each, so no lane shares.

| Lane | Account | Character | Members |
|------|---------|-----------|---------|
| `@gate-a` | `imankh@gmail.com` / `9fa7378c` | ALL heavy writes (real exports, publish, share links) | `staging-smoke`, `derisk-staging-export`, `derisk-staging-endcard-copylink` |
| `@gate-b` | alias clone 1 (`e2e-gate@test.local`) | browsing + light writes (crop drag, share link) | `game-loading`, `annotate-game-clock`, `T4550-overlay-transform`, `T4190-my-reels-group-visibility`, `T5677-home-deeplinks`, `T7350-mobile-share-routing`, `T5642-overlay-working-video-presigned`, `T5676` (real-account describe), `bug38-autoselect-and-frame-step` |
| `@gate-c` | alias clone 2 (`e2e-gate2@test.local`); the mocked specs need no account | public viewers + slow reads + local-only members that skip loudly on a deployed target | `collection-share`, `shared-viewer-affordance-gating`, `T5290-recap-mobile-redesign`, `T5681-games-poster-grid`, `T7100-reel-download-feedback`, `T8160-upload-transport-probe` (novel-hash multipart transport; own test-login session), `T5710-per-layer-recap` (local-only, seam), `bug38-harness` (local-only, dev harness), `T5676` dev-harness describe (local-only) |

A cold-machine caveat for phantom REDs: the runner warms `/health`, but if a lane's
traffic wakes a SECOND, cold staging machine, that lane's first tests can hit the ~145s
cold start against the 60s deployed per-test timeout and fail spuriously. If a RED lane's
first failures are all timeouts, check `fly machines list -a reel-ballers-api-staging`
before believing them.

The authoritative machine-readable inventory is `helpers/targetEnv.js`
(`STAGING_GATE_SPECS`, printed by `global-setup` on every deployed-target run).

## Runbook: running the gate against staging

```bash
# Step 0 — staging prep (SUPERVISOR/host step, needs cross-env creds + fly CLI).
# Order matters: a live (or suspended) machine re-uploads its stale profile.sqlite
# over a fresh copy (local-ahead guard).
#   0a. fly machine stop <id> -a reel-ballers-api-staging     # STOP, not suspend
#   0b. fly proxy 15432:5432 -a reel-ballers-db-staging       # staging PG proxy
#   0c. seed all 3 accounts (idempotent; resets gate-run drift and guarantees the
#       export spec a framed draft) — commands in FIXTURE-CONTRACT.md § Seeding
#   0d. fly machine start <id> -a reel-ballers-api-staging
#   0e. POST /api/admin/migrate with an admin session — POSTGRES track only.
#       T5083/T5085: user_db/profile_db migrate JUST-IN-TIME at the per-user load
#       seam, so the freshly seeded accounts migrate themselves on the gate's first
#       login. Budget for it: that first dev-login pays the seam's migration cost
#       for every seeded profile (observed minutes, not seconds, right after a
#       re-seed), which is why the runner's dev-login probe can look "hung".

# Step 1: run the three lanes concurrently (~10-14 min typical):
bash scripts/staging-gate.sh
```

The runner warms `/health` (staging cold start is ~145s), probes `dev-login` for both
fixture accounts (fails fast when a seed is missing), launches the three lanes with
per-lane `E2E_RESULTS_DIR` report paths, and prints one aggregated verdict. Single-lane
runs: `npm run test:e2e:gate-a` (or `-b` / `-c`) with the usual `E2E_*` env.

Record actual per-lane times here after gate runs so the budget stays measured, not
estimated.

**Measured (2026-08-26, first full green run, machine at shared-cpu-4x/4096):**
**5m 48s wall clock.** Lane A: 6 passed in 2.9m (incl. a REAL overlay export -> final
video -> publish on a pre-framed draft); lane B: 13 passed in 5.1m; lane C: 21 passed in
5.7m. An unframed draft adds a framing render to lane A (budget up to the spec's 15-min
cap); the re-seed resets the fixture so the pre-framed fast path is the norm.

**Machine-size requirement (measured 2026-08-26):** on the default staging VM
(shared-cpu-1x/2048) the 3 concurrent lanes SATURATE the single shared vCPU — request
times hit 8-14s (posters, share compose) and past Fly's proxy timeout the API returns
502s, cascading into ~19 phantom failures and a 16m40s wall clock. On shared-cpu-4x/4096
the same suite is fully green in 5m48s. Until the runner scales the machine itself,
gate prep must temporarily scale up (and revert after):
`fly machine update <id> -a reel-ballers-api-staging --vm-size shared-cpu-4x --vm-memory 4096 -y`

## What's in it (coverage view)

| Surface | Spec |
|------|--------|
| API health + auth/session-init (R2 download path) | `staging-smoke.spec.js` |
| Export pipeline (framing → overlay → final) + publish | `derisk-staging-export.qa.spec.js` |
| Share end card + copy-link dedup | `derisk-staging-endcard-copylink.qa.spec.js` |
| Annotate: game opens, clip markers render | `game-loading.spec.js` |
| Annotate playback + game clock | `annotate-game-clock.spec.js` |
| Framing crop-overlay placement + drag round-trip | `T4550-overlay-transform.qa.spec.js` |
| My Reels groups + unwatched chips | `T4190-my-reels-group-visibility.spec.js` |
| Deep links / tab persistence / route fallbacks | `T5677-home-deeplinks-route-fallback.spec.js` |
| Share routing: desktop modal vs mobile native sheet | `T7350-mobile-share-routing.qa.spec.js` |
| Overlay working-video presigned load | `T5642-overlay-working-video-presigned.qa.spec.js` |
| Aspect-aware video stage (real account) | `T5676-aspect-stage-alignment.qa.spec.js` |
| Auto-spotlight + frame-step | `bug38-autoselect-and-frame-step.qa.spec.js` |
| Public shared viewers (collection + affordance gating) | `collection-share.spec.js`, `shared-viewer-affordance-gating.spec.js` |
| Recap player responsive layout | `T5290-recap-mobile-redesign.spec.js` |
| Games poster grid (poster-load branch needs real R2) | `T5681-games-poster-grid.spec.js` |
| Reel download feedback (real server compose) | `T7100-reel-download-feedback.qa.spec.js` |

Still uncovered by the gate, on purpose: upload/extract pipeline (would push real media
into staging R2 + Modal per run; covered by one upload in the manual pass), collection
download (`T7040` needs a local ffprobe; local-only), the annotate save gesture and
monetization UI (T7810 adapts `T7540` / `t4940` in).

The set deliberately **excludes**:

- `LOCAL_ONLY_SPECS` (the `/api/test/*` seam specs, the Vite-dev-module unit specs, and the
  `*diag.html` **dev-harness** specs) — they can't run on a deployed build. See
  `helpers/targetEnv.js`.
- `screen-usability.spec.js` — the viewport-emulation audit. Neither Chromium nor WebKit
  reproduces **iOS Safari's dynamic-toolbar `100vh` chrome**, so this is a documented
  **emulation blind spot**, NOT a staging signal. It is documented in
  `src/frontend/e2e/helpers/usabilityAudit.js` (see its "HONESTY CAVEAT") and blocked at
  the source by the repo-root `scripts/check-viewport-units.mjs` lint gate — it must not be
  counted as a gate failure.

## Running it single-process (legacy / local)

`bash scripts/staging-gate.sh` (above) is the staging entry point. A single serial
process still works when parallelism isn't wanted; from `src/frontend`:

```bash
E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
npm run test:e2e:staging-gate
```

- `E2E_BASE_URL` / `E2E_API_BASE` point the suite at the deployed target (see
  `playwright.config.js`); setting `E2E_BASE_URL` also flips the per-test timeout to 60s so a
  data/config miss fails fast instead of hanging. A serial run puts every spec on ONE
  account (fine: no concurrency) but takes the summed lane time (~20-30 min).
- `E2E_REAL_EMAIL` / `E2E_REAL_PROFILE` select the seeded fixture account (defaults already
  match the seed, so they're optional once imankh is seeded).

To run it locally against the dev stack, just `npm run test:e2e:staging-gate` with no env
overrides (it uses `localhost` + your local data; the local-only members like `T5710` and
the dev-harness specs then RUN instead of skipping).

## Trust guarantees

- **No `networkidle`.** Deployed-target waits use `domcontentloaded` + a real ready element
  (`helpers/appReady.js`), never a `networkidle` settle that never fires on a CDN.
- **Skip-with-reason, loudly.** Data-dependent gate specs that can't find their fixture data
  `test.skip(...)` with a `[T5400][SKIP]` `console.log` — a missing fixture is unmistakable in
  the output, never a green pass. A real regression and a missing fixture never look alike.
- **First-login retry is centralized.** `loginAsRealUser` retries a 5xx `dev-login` (staging PG
  stale-pool blip) up to 3× — specs don't re-implement it.

---

# T6230 — the real-browser update-gate SW test (NOT a `@staging-gate` member)

`T6230-update-gate-real-sw.spec.js` is the automated regression guard T6210 asked for: it
exercises `pwaUpdate.probeForWaitingBundle` against a REAL Chromium ServiceWorker, so the
suite goes RED if the probe stops reporting a waiting bundle (the over-correction that
would silently make the gate never fire) or if the T6210 loop (gate on server-ahead alone)
is reintroduced. Run it with `npm run test:e2e:sw-gate`.

**Why it is NOT in `@staging-gate`, but IS in the local/CI suite.** The `@staging-gate`
subset answers "is the DEPLOYED staging build safe to promote?" This spec never touches
staging — it compiles and serves its OWN two builds from an in-process `node:http` origin
(`e2e/helpers/staticBuildServer.js`), so it gives zero signal about a deployed target and
would only slow the gate by two `vite build`s. It `test.skip`s when `E2E_BASE_URL` is set
(it owns its origin), matching `helpers/targetEnv.js`. Its value is pure local/CI
regression protection, which is where it runs.

**Why the dev server cannot host this test.** The Vite dev server builds no real
ServiceWorker, so the probe has no registration and — by T6210's deliberate tradeoff (no
probe registered = no gate) — never gates. The mechanism only exists against a BUILT,
SERVED app. Hence the fixture builds the app for real and serves it over
`http://localhost:<port>` (a secure context, so the SW registers).

**Two hard-won facts for the next person (so they aren't rediscovered):**

1. **Two successive `npm run build`s are byte-identical here.** The intuition that
   version.json's fresh `buildTime` diverges the bundle is FALSE: its only importer
   (`CropOverlay.jsx`) reads `versionInfo.environment` only, so rollup tree-shakes
   `buildTime` out. `diff A/sw.js B/sw.js` → identical. The fixture therefore injects a
   unique **marker file** into `public/` for build B (removed in a `finally`), forcing a
   distinct Workbox precache manifest → distinct `sw.js`. The spec asserts `swDiffers`.

2. **A reload resets the probe throttle.** `PROBE_MIN_GAP_MS` / `UPDATE_CHECK_MIN_GAP_MS`
   are 5 min, but `lastProbeAt` / `lastCheckAt` start at 0 on every fresh page load, so a
   navigation always gets one un-throttled check + probe. Drive the tests with reloads and
   you never touch — and must never weaken — the production throttle.

3. **Discover build B via Workbox, not a raw `registration.update()`, before triggering
   the gate.** vite-plugin-pwa only wires its controlling→reload listener for updates
   Workbox itself discovers on `register()`; a bundle staged by a raw
   `registration.update()` is an *external* update it won't auto-reload for — so
   "Update now" would activate the new SW but never reload the page. The spec polls
   `registration.waiting` (Workbox's own discovery on the reload) before raising the gate,
   which both matches a real deploy and makes the "Update now" reload deterministic.
