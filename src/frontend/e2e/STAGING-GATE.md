# The `@staging-gate` pre-deploy gate (T5400)

`@staging-gate` is a **curated, fast, reliable subset** of the E2E suite that answers a
single question in one run: **"is staging safe to promote to prod?"** It is separate from
the full local suite (which is ~1.8h and mixes reliable specs with local-only /
data-heavy ones). The gate targets **well under ~15 min** against staging.

## What's in it

Tagged with `@staging-gate` in their test titles (grepped by Playwright), and inventoried
in `helpers/targetEnv.js` (`STAGING_GATE_SPECS`, which `global-setup` prints on every
deployed-target run):

| Spec | Covers |
|------|--------|
| `staging-smoke.spec.js` | API `/health` 200 + `dev-login` session + app shell renders (fastest signal) |
| `T5290-recap-mobile-redesign.spec.js` | recap player responsive layout (portrait/landscape/narrow/desktop), no overflow |
| `T4550-overlay-transform.qa.spec.js` | framing crop-overlay placement + drag round-trip; overlay/detection layer (rAF-leak free) |
| `derisk-staging-export.qa.spec.js` | export pipeline (framing → overlay → final) + publish, on a **discovered** draft |
| `derisk-staging-endcard-copylink.qa.spec.js` | branded end card on shared reel + collection; copy-link POST/toast dedup |

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

## How to run it against staging

Seed the fixture first (SUPERVISOR/host step — needs cross-env creds, see
[`FIXTURE-CONTRACT.md`](FIXTURE-CONTRACT.md) § Seeding). Then from `src/frontend`:

```bash
E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
E2E_REAL_EMAIL=imankh@gmail.com \
E2E_REAL_PROFILE=9fa7378c \
npm run test:e2e:staging-gate
```

- `E2E_BASE_URL` / `E2E_API_BASE` point the suite at the deployed target (see
  `playwright.config.js`); setting `E2E_BASE_URL` also flips the per-test timeout to 60s so a
  data/config miss fails fast instead of hanging.
- `E2E_REAL_EMAIL` / `E2E_REAL_PROFILE` select the seeded fixture account (defaults already
  match the seed, so they're optional once imankh is seeded).

To run it locally against the dev stack, just `npm run test:e2e:staging-gate` with no env
overrides (it uses `localhost` + your local data).

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
