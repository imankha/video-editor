# T5420: Finish making the staging e2e run honest (gate env-incompatible specs + derisk robustness)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-19
**Follows:** T5400 (trustworthy staging gate) — this closes the gaps the first full staging run exposed.

## Problem

The 2026-07-19 full staging run (78 passed / 36 failed / 36 skipped) proved T5400's curated
`@staging-gate` idea works, but two gaps remain so the FULL suite still "cries wolf" and the gate
itself has reds:

1. **~23 specs are environment-incompatible against a deployed target but were never gated** — they
   fail loudly instead of skipping with a reason. Two classes:
   - **Vite-module**: specs that `page.evaluate(() => import('/src/...'))` (auth-bypass via
     `/src/stores/authStore.js`, plus `updateGateStore`, `overlayActionStore`, `cacheWarming`,
     `questStore`, `uploadStore`, `tutorialVideos`, `questDefinitions`). Those `/src` paths exist
     only under the Vite dev server; a deployed CDN build bundles/hashes them → "Failed to fetch
     dynamically imported module". Same class as T4934's `LOCAL_ONLY_SPECS` vite-module category —
     just never inventoried for these specs.
   - **Seam**: specs hitting `/api/test/*` seams (dev/local-only) → HTML 404 → "Unexpected token '<'".
2. **The 3 `@staging-gate` derisk specs fail on data-discovery/fixture robustness, not product bugs**
   (collection end-card discovery picked a draft with `has_final_video=false`; copy-link found no
   `[data-testid="reel-card"]`; export-pipeline timed out waiting on the overlay Export button). The
   gate can't be green until these either discover suitable data or skip-with-reason when the fixture
   genuinely lacks it.

## Failing-spec inventory (from the 2026-07-19 run)
- **Vite-module → gate as local-only + `skipOnDeployedTarget`:** T5070-blocking-update-gate,
  collections, clip-selection-state-machine, cache-warming-console, T4900-overlay-action-failure-
  visibility, new-user-flow (auth-bypass import), + any spec whose only deployed failure is a
  `/src/*` dynamic import.
- **Seam → `skipOnDeployedTarget` (seam reason):** T3980-dev-login-real-data, tutorial-capture-*
  (annotate/framing/overlay/publish), sidebar-scrub-debug, profile-switch-isolation,
  T4110-reedit-reel-persistence, T4100-dedup-honest-message, bug27p-expired-annotations,
  T4860-admin-bulk-actions.
- **Data/timeout → skip-with-reason when the fixture lacks the data (loud, never silent):**
  full-workflow, annotate-game-clock, T4780-tutorial-quest-steps, T4190-my-reels-group-visibility.
- **Needs a real look (do NOT blanket-skip):** screen-usability mobile "Profile management" —
  `locator.click` timeout on the sport/profile switcher (resolves to it but click times out). This
  is a click/actionability issue, NOT a touch-target-size assertion, so likely pre-existing (not a
  T5360 regression). Confirm whether it reproduces on desktop / pre-T5360; if it's a real mobile
  audit bug, file it separately rather than skipping.

## Solution
1. **Gate vite-module + seam specs the T4934 way.** Add each to `LOCAL_ONLY_SPECS`
   (`e2e/helpers/targetEnv.js`) with the right category + `depends`, and add a
   `skipOnDeployedTarget(test, reason)` guard so they skip LOUDLY (global-setup already prints the
   inventory). Do NOT paper over a spec that could actually run — only gate genuine dev-only deps.
   Prefer, where cheap, migrating an auth-bypass to a deployed-compatible path (e.g. `dev-login`
   instead of the `/src/stores/authStore.js` import) so the spec KEEPS running on staging rather than
   skipping — note per spec whether you gated or migrated.
2. **Fix the derisk-trio robustness.** In `derisk-staging-export.qa.spec.js` /
   `derisk-staging-endcard-copylink.qa.spec.js`: discover data that actually fits the assertion
   (a published reel with `has_final_video=true` for the collection/copy-link; a draft in the right
   stage for export), and skip-with-reason (loud) when the seeded fixture genuinely lacks it. Update
   `FIXTURE-CONTRACT.md` if the gate now REQUIRES a published reel / shareable collection the seed
   must guarantee (coordinate with the supervisor, who owns seeding staging).
3. **Re-verify against staging.** Run the full suite AND `--grep @staging-gate` against staging; the
   goal: the full run shows only honest skips + genuine reds, and `@staging-gate` is GREEN (or every
   red is a real, filed bug). Report the before/after pass/skip/fail counts.

## Relevant files
- `src/frontend/e2e/helpers/targetEnv.js` — `LOCAL_ONLY_SPECS`, `skipOnDeployedTarget`
- the ~23 spec files above
- `src/frontend/e2e/derisk-staging-*.qa.spec.js` — data discovery + skip-with-reason
- `src/frontend/e2e/FIXTURE-CONTRACT.md` — any new fixture guarantee
- `src/frontend/e2e/global-setup.js` — already prints LOCAL_ONLY_SPECS (no change likely)

## Acceptance Criteria
- [ ] Every vite-module / seam spec that can't run on a deployed target skips LOUDLY (in
      `LOCAL_ONLY_SPECS` + `skipOnDeployedTarget`), or is migrated to a deployed-compatible path and
      still runs — no bare deployed-target failures from `/src` imports or `/api/test/*` HTML-404s.
- [ ] The 3 derisk `@staging-gate` specs pass against the seeded fixture OR skip-with-reason when the
      data is genuinely absent — no failure on unsuitable discovered data.
- [ ] `--grep @staging-gate` runs GREEN against staging in one shot (excluding any real, filed bug).
- [ ] The full staging run's failures are only genuine reds (each filed) — env/data specs skip.
- [ ] screen-usability mobile "Profile management" is diagnosed: fixed, filed as a real bug, or shown
      pre-existing and documented — not silently skipped.
- [ ] Before/after counts reported.

## Classification hint
M-tier, frontend test-infra only. No product code. Verify against staging (`E2E_BASE_URL=...`).
Note: T4550's Framing first-drag is a SEPARATE real bug (reopened as T5380b) — not in scope here.
