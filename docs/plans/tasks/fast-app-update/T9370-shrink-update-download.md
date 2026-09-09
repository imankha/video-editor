# T9370: Shrink the update download - a one-line deploy should not re-fetch the app

**Status:** TODO
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

## Notes

- Tier M. Frontend build config only, no runtime logic.
- **Check T8570 (initial-load perf investigation) first.** It is looking at bundle size for a
  different reason - cold-visit time to usable - and may already have the chunking analysis this
  task needs, or may have a conflicting proposal. Reconcile rather than duplicate.
- A build-config change is exactly the class of change that looks fine locally and breaks a real
  deploy. Verify on staging against a genuine second build before this is called done.
