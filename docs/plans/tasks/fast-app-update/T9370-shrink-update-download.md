# T9370: Shrink the update download - a one-line deploy should not re-fetch the app

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-09
**Updated:** 2026-09-09

**Epic:** [Fast App Update](EPIC.md), child 3/4. **Blocked on [T9340](T9340-version-update-latency-investigation.md)'s measurement.**

## Problem

Between "the client notices a new build" and "the bundle is `waiting`" sits a full service-worker
precache of the new build. Nothing in the codebase records how big that is, or how much of it is
genuinely new after a typical deploy.

Two things make this worth measuring rather than assuming:

- The probe waits `SW_INSTALL_TIMEOUT_MS` = 10s (`utils/pwaUpdate.js:21`) for an installing worker to
  become `waiting`. T9310's Gap C fix means missing that window now costs ~30s instead of 5 minutes,
  but it still means the install routinely exceeds 10 seconds on real connections - which is
  evidence this leg is not small.
- This is the one leg that scales with the user's connection. On sideline cellular, the audience this
  product is built for, it plausibly dominates the other two legs combined.

## Solution

1. Measure what a representative deploy actually re-downloads: total precache manifest size, and the
   delta between two consecutive real builds. `dist/` plus the generated `sw.js` precache manifest
   have everything needed; no instrumentation required.
2. If a small source change re-downloads a large fraction of the app, fix the cause. Likely
   candidates, to be confirmed rather than assumed:
   - vendor code sharing a chunk with app code, so any app edit invalidates the vendor bytes;
   - chunk hashing that cascades, where one changed module renames several chunks;
   - assets in the precache manifest that do not need to be precached at all (fonts, tutorial media,
     anything already `no-cache` at the CDN or fetched on demand).
3. Re-measure and report the delta.

## Invariants

- **Correctness beats size.** `cleanupOutdatedCaches: true` and `clientsClaim: true` stay as they
  are; do not trade away the guarantee that an activated bundle is complete and self-consistent.
- Do not move an asset out of the precache if an offline-capable surface depends on it. Check what
  the app actually claims to do offline before pruning.
- `public/_headers` already sets `Cache-Control: no-cache` on `index.html`, `sw.js`, and
  `manifest.webmanifest` (T5070, re-confirmed by T9310). Leave that alone.

## Files

- `src/frontend/vite.config.js` - `VitePWA` options, `globPatterns`, rollup chunking
- `src/frontend/public/_headers` - read-only reference
- `dist/sw.js` precache manifest - the measurement artifact

## Tests

- `npm run test:e2e:sw-gate` - the real two-build fixture must still cross a version boundary cleanly
  after any chunking change; this is the test that would catch a broken precache
- `src/frontend/e2e/update-gate.spec.js`
- a production build must be diffed before and after, not just unit-tested

## Progress Log

**2026-09-10 — measured, fixed, re-measured (build config only).**

Measurement method: build two production bundles that differ by one trivial source line,
diff their Workbox precache manifests (`scripts/measure-update-download.mjs`). The delta =
bytes a client on the old build must fetch to reach the new one.

*Baseline (before):* the app rode in ONE ~1.14 MB `index` chunk mixing React + all vendor
+ app entry code. A one-line change re-downloaded **~73%** of the 2.1 MB precache regardless
of which file changed — the `index` hash changed and cascaded a fresh hash onto every lazy
route chunk that imported it (routes were byte-identical after stripping hashed import
specifiers, yet re-downloaded).

*Fix:* `manualChunks` splits the STABLE, always-eager vendor libs (react/react-dom,
zustand/immer, lucide-react; @stripe already split) and the app-shared foundation
(`src/stores`, `src/utils`, `src/config`) into their own content-hashed chunks. html2canvas /
mp4box stay lazy (naming them would hoist them eager and regress cold start — T8570's goal).

*After:*

| Deploy edits… | Baseline | After | 
|---|---|---|
| a component / App.jsx (common case) | ~73% | **~47%** |
| a store / util (foundational, wide fan-out) | ~73% | **~65%** |

Cold-start eager load: 1161 KB → 1169 KB (**+8 KB / +0.7%** — negligible). Total precache
unchanged (~2.1 MB). No new rollup warnings (baseline had 10 mixed-import warnings, this build
has 8). SW correctness untouched: `cleanupOutdatedCaches`/`clientsClaim`/`globPatterns` all
unchanged, so an activated bundle is still complete and self-consistent.

**2026-09-10 (later) — real-SW regression found in live QA, root-caused, fixed.**

Live QA ran the deferred e2e on a real stack: `e2e/update-gate.spec.js` 4/4 passed, but
`e2e/T6230-update-gate-real-sw.spec.js` (the two-build real-ServiceWorker fixture) hung 2/3
cases at `navigator.serviceWorker.ready` (300s timeout). Bisected to `vite.config.js` (reverting
just that file to master made all 3 pass).

*Root cause:* the first fix split the app foundation into THREE separate chunks — `app-stores`,
`app-utils`, `app-config`. But `src/stores`, `src/utils`, `src/config` form a static import
CYCLE (`src/utils/analytics.js` and `appVersion.js` import stores; `adminStore`/`authStore`/
`creditStore` import utils/config). In the baseline single `index` chunk rollup topologically
orders those modules so the cycle is safe. Splitting the cycle ACROSS chunks turned it into a
cross-chunk ESM cycle whose eager evaluation hit a Temporal-Dead-Zone `ReferenceError` at boot.
The entry chunk threw before `main.jsx` reached `registerSW()`, so the service worker never
registered and `.ready` never resolved — invisible to `npm run build` (a runtime error) and to
the jsdom/dev-server unit tests (neither uses prod chunking); only the real-browser fixture
caught it. A chunk-import-graph cycle detector on the built `dist/assets` confirmed exactly two
cross-chunk cycles: `app-stores -> app-utils -> app-stores` and `app-stores -> app-config ->
app-stores`.

*Fix:* merge the three cyclic dirs into ONE `app-foundation` chunk. They stay OUT of `index`
(so the update-download win is unchanged) but the cycle is once again intra-chunk, where rollup
applies the same ordering it already proved correct in the baseline `index` blob. The cycle
detector now reports zero cross-chunk cycles; the component-edit delta is still 46.7% and eager
load unchanged (1169 KB). Vendor chunks were never part of a cycle and are unchanged.

*Stopping point:* the residual cost is the 696 KB `index` chunk (App.jsx + eager shared
components) re-hashing on any eager-component edit, plus a store/util fan-out. Both are
partly intrinsic to content-hash cache-busting over a wide import graph. Pushing further
would require pinning `src/components` — which hoists lazy route-only components into an
eager chunk (a real cold-start regression) for diminishing returns — or lazy-loading more
of App.jsx's graph, which is runtime restructuring out of this task's scope.

## Notes

- Tier M. Frontend build config only, no runtime logic.
- **Check T8570 (initial-load perf investigation) first.** It is looking at bundle size for a
  different reason - cold-visit time to usable - and may already have the chunking analysis this
  task needs, or may have a conflicting proposal. Reconcile rather than duplicate.
- A build-config change is exactly the class of change that looks fine locally and breaks a real
  deploy. Verify on staging against a genuine second build before this is called done.
