# Playwright E2E Triage — 2026-08-25

Source run: `playwright-full-run.log` (local run against `localhost`, master branch,
348 passed / 144 failed / 23 skipped / 34 did not run, 4.6h wall-clock).

**Cross-reference note:** `docs/testing/known-failures.md` currently contains **zero
Playwright e2e entries** (its rows are all backend pytest / frontend Vitest unit
tests). So every one of the 144 failures below is a fresh categorization — none could
be marked "already known" against that file. Recommend backfilling
`known-failures.md` with the entries below that get classified **Environment/scope
mismatch** or **Likely flaky/timing**, once a maintainer confirms them, so future runs
stop re-litigating the same rows.

## Methodology

144 failure entries were extracted from the log's numbered failure-summary section
(lines 1632-7454, one `N) [chromium] › ...` block per failure with Playwright's error
text / call log / stack trace). They were split into 6 batches of ~24 (in spec-file
order, since Playwright's failure list is already roughly file-sorted) and each batch
was investigated in parallel: read the failure's error/call-log text, read the spec
file at the failing line, read the relevant frontend/backend source and the matching
`.claude/knowledge/*.md` domain doc, then categorized.

**Global finding before the per-cluster detail:** `playwright.config.js` sets a
**300000ms (5-minute) local per-test timeout** (deployed-target runs get 60s instead —
see `PER_TEST_TIMEOUT` in the config) and a 60s `expect()` timeout. A very large share
of the 144 failures — see the Slow Tests section — ran to almost exactly one of these
ceilings (5.1-5.5m or 1.0-1.4m) rather than failing fast with a specific assertion
mismatch. That is itself a signal, not noise: it means the test was stuck polling for
a DOM state (an element to enable/appear/click-through) that never arrived, and it
also means these 70+ timed-out failures alone account for several hours of the 4.6h
wall-clock — fixing (or fast-failing) them is probably the single highest-leverage
lever for the separate "get the suite under 10 minutes" goal.

---

## Summary

Six batches of ~24 failures each were investigated in parallel (roughly in spec-file
order). Approximate category breakdown across all 144 (a few spec files' failures span
a batch boundary and are reported under both batches below rather than merged, to keep
each batch's own evidence intact):

| Category | ~Count | Notes |
|---|---|---|
| Stale/broken test (assertion/selector predates a later shipped change) | ~55 | The largest bucket by far — mostly T6890 (Edit/Rename relocated to pencil icons), T6660 (Player intro card -> Athlete Intro Card), T6630 round 4/6/7 (region/element model + textdiag harness), and other UI copy/structure drift |
| Environment/scope mismatch (wrong precondition, `@staging-gate` run locally, stale real-account data) | ~45 | Includes the whole `tutorial-capture-*` trio, several fixture-drift clusters, and the T6010/T6040/T6020 quest-achievement cluster |
| Likely real regression (confirmed or high-confidence hypothesis) | ~15 | See "Concrete real bugs found" below — several have exact file:line fixes |
| Likely flaky/timing (shared real-account concurrency, animation/transition races) | ~20 | Several explicitly need an isolated rerun to confirm before any fix |
| Needs live-browser verification (evidence inconclusive from static read) | ~9 | Listed per-cluster below |

**Concrete real bugs found (ready to fix, not just hypotheses):**
1. **`ProjectManager.jsx`/`GalleryButton.jsx` — "My Reels" button's accessible name is unstable.** It folds a live unread-count badge into the computed name and hides the text entirely below the `sm` breakpoint, so `getByRole('button', {name:'My Reels', exact:true})` — and real screen readers — can't reliably find it. Root cause of 3 failures in `t5672-drawer-aspect-split.spec.js`. Fix: static `aria-label="My Reels"`, mark the badge `aria-hidden`.
2. **`questStore.js`'s `recordAchievement()` is missing the `rbNonDataWrite: true` marker** that every sibling lifecycle-write call site has. `App.jsx`'s `returned_home` achievement fires reactively on Home-screen mount for any account whose quest_1 is already complete, tripping the "could not save to the cloud" alarm on an otherwise passive load. Root cause of 5 failures across `T5960`/`T6010-T6020`/`T6040`. One-line fix in `questStore.js`.
3. **`ReelTile.jsx:145` hardcodes `menuHeight = 300`** (comment falsely claims "actual is measured") used to decide flip-direction and position a flipped kebab menu — the real menu is now taller (more items added since), so a flipped menu's bottom overflows the viewport by ~45px. Root cause of 1 failure in `T6300`, likely affects any consumer of the same flip logic.
4. **`introCardEditorConstants.js`'s `SLOT_META.title` label ("Athlete Name") is defined but never rendered anywhere** — `IntroCardRail.jsx` only maps `FACT_SLOTS`, which excludes the title slot. A real, shipped-incomplete UI gap from T6620, not covered by any unit test. 1 failure in `T6620-defects.qa.spec.js`.
5. **Two stray leaked clips (ids 178, 179) confirmed via direct DB query** on the real dev account's game 6, empty-named artifacts from an earlier test run's incomplete cleanup — sitting at `t=0-3s` and `t=21-33s`, which several specs assume is a clear seek zone. Root cause of 7 T5700/T5725 failures. Fix: `DELETE` those two rows (`X-Profile-ID: 9fa7378c`), and harden `ensureAddClipVisible` in the affected specs to verify the seek point is actually clip-free rather than trusting a hardcoded offset.
6. **`page.locator('video')` is unscoped in `T6700`/`T6710`**, and now also matches ~30 per-tile hover-preview `<video>` elements shipped by the T6420/T6820 tile-preview feature. Root cause of 6 failures — rescope to `[data-testid="collection-player-backdrop"] video`.
7. **`textdiag/main.jsx` (dev-only test harness) still calls the pre-T6630 `useTextOverlays()` API** (`addText`, `moveTextStart`, etc.) that no longer exists — the hook now exports `addRegion`/`moveRegionStart`/etc. The harness throws on mount, so no text block ever renders. Root cause of at least 16 failures across `T5225-text-lever-drag.qa.spec.js` and `T6610-text-body-drag.qa.spec.js` (and cascades into `T6630-text-add-remove-drag.qa.spec.js`'s first test). One file fix.
8. **`CollectionPlayer.jsx`'s close (X) button has no `aria-label`/text**, so it has no accessible name at all — contributes to a `T6300` failure whose test's fallback close-selector can never match it. Fix: add `aria-label="Close"`.

Everything else below is either a stale-test fix (update or delete the assertion), an
environment/fixture issue (re-seed, exclude from unattended runs, or fix a fragile
`find()`-based synthetic-data seed), or flagged as needing a live rerun before writing
a fix.

---

## Failure Clusters

Organized by the batch that investigated them (batches are contiguous slices of the
144-entry failure list, roughly spec-file-ordered — a few spec files straddle a batch
boundary and so appear under two headings below with their own distinct test names).

### Batch 1 — entries ~1-24 (log lines 1632-2469)

**`bug27p-expired-annotations.spec.js:59`** — *Environment/scope mismatch.* `beforeAll` asserts game 5's `storage_status === 'expired'` and got `'active'` — the spec's own header says a separate QA harness must flip `game_storage.storage_expires_at` into the past first; that harness wasn't run before this sweep. Not a code bug — run the harness first or exclude from unattended runs.

**`bug39-update-gate-aggressive.qa.spec.js:36,:101`** (2 tests) — *Stale/broken test.* Both call a Vite-dev API that no longer exists: `checkAppVersion`/`acknowledgeAppVersion` aren't exported anywhere in `appVersion.js`, and `useUpdateGateStore.getState().setUpdateSW` doesn't exist (current API is `setSwReloader(fn)`; `requireUpdate({needsMigration=false}={})` takes an options object, not a string reason). This predates the T5070/Tbug40p/Tbug41s refactor that replaced the module's entire public surface. Spec's own comment says gate logic is "also fully covered by Vitest" — safe to delete if nobody wants to rewrite it against the current API.

**`derisk-staging-endcard-copylink.qa.spec.js:66`** (`@staging-gate`) — *Likely flaky/timing.* `TypeError: Failed to set currentTime ... non-finite` — `video.duration` was `NaN`. The helper only waits for the `<video>` element to attach, not for `loadedmetadata`/`readyState>=1`; the share-page video is composed server-side per request (`compose_serve_time`) and can take real wall-clock time, especially under this bulk run's load. Fix: wait for `readyState>=1` (or the `loadedmetadata` event) before reading `.duration`.

**`derisk-staging-export.qa.spec.js:140`** (`@staging-gate`) — *Likely real regression, needs verification.* The spec is designed to self-diagnose and treats "video loads but Export panel doesn't mount within 60s" as a real mount-logic regression, not a skip. That's exactly what happened here (`diag.loads === true`, ruling out the documented T6120 "missing R2 object" explanation). Caveat: this ran against local dev's copy of the account, not staging, despite the filename. Needs a focused rerun with a trace to find why `OverlayModeView`'s Export button didn't mount despite `effectiveOverlayVideoUrl` being set — don't dismiss as environment noise without checking the trace; this is exactly the class of bug the test exists to catch.

**`full-workflow.spec.js:227`** ("1. Project Manager loads correctly") — *Stale/broken test.* Expects the Reel Drafts tab to be immediately clickable for a brand-new zero-clip account, but `ProjectManager.jsx` (T6830) deliberately disables that tab until a clip is extracted — already covered by an existing unit test (`ProjectManager.homeTabDefaults.test.jsx`). Delete/update; contradicts a deliberate, already-tested product change.

**`new-user-flow.spec.js:488`** ("Complete all 4 quests and see Vamos dialog") — *Needs verification, possibly a stale-read race.* One of Quest 1's 3 steps never marks done in the final aggregate `getQuestProgress` read despite each step being individually polled and (apparently) passing earlier in the same test. Plausible race between the last `waitForQuestStep` and the final progress fetch. Needs the trace to identify which step, before concluding flaky vs. real.

**`regression-tests.spec.js:1425,:1474,:1541,:1644`** (4 tests, ONE shared cause) — *Stale/broken test.* The shared helper `navigateToProjectFromHome` waits for `h2:has-text("Your Reels")` (zero matches anywhere in the app — the tab is now "Reel Drafts" per T6830) and a fallback regex assuming `16:9` when the actual default is `9:16`. Both selector paths fail silently, so no project ever gets selected and the mode switcher renders nothing. One fix (update both selectors, likely to `[data-testid="project-card"]` + the correct aspect string) clears all 4.

**`T-egress-livedrive-2026-08-11.qa.spec.js:174,:238`** (2 tests, shared cause) — *Likely flaky/timing, possibly minor real drift.* Both report an identical composed duration 2.78s over the 2.5s tolerance (itself already described in the spec as "generous on purpose"). Identical numbers confirm one shared underlying reel, not two bugs. Re-run in isolation; if it reproduces consistently, `ffprobe` the actual output for extra segments before just bumping the tolerance.

**`T4110-reedit-reel-persistence.spec.js:38`** — *Environment/scope mismatch.* The spec's own header states it's an INVESTIGATION spec with every check `.soft()`, not a guardrail. Failed expecting a pre-existing auto-created "Game Highlights" draft for game 6 that doesn't currently exist in this env. Not a regression signal by design.

**`T4120-self-verify-durability.spec.js:35`** — *Environment/scope mismatch.* Requires `MODAL_ENABLED=false` (must run via `dev-verify.sh`, which sets it); this bulk sweep's backend had Modal enabled, which the test explicitly refuses to run against. Not a bug — exclude from generic full-sweep invocations.

**`T4550-overlay-transform.qa.spec.js:61` + `T4880-mobile-editor-reachable.spec.js:64,:99`** (3 tests, shared cause) — *Likely real regression (in a shared test helper, not product code).* Both files define an identical `openFramingDraft` helper with a title regex requiring a `[tags]` bracket segment — but `DraftTile.jsx` hardcodes `tags: []` for every branch of the single-clip Framing summary segment, so a normal single-clip draft's title never has brackets and the regex can never match it (a fixture-guaranteed case the regex structurally excludes, not a data problem). Fix: make the bracket group optional in the shared regex, or better, add a stable `data-testid` to the chip and switch both specs to it.

**`T4780-tutorial-quest-steps.spec.js`** (4 tests, 2 causes):
- AC1 (`:74`) + AC7 (`:230`) — *Stale/broken test.* Assert the generic `"Watch the tutorial"` string; actual titles are now quest-specific (`'Watch Annotate Tutorial'`, etc.) per `questDefinitions.jsx`. Update to check the quest-specific titles or match the pattern `/Watch .+ Tutorial/i`.
- AC3 (`:112`) — *Stale/broken test.* Expects a `0.75x` default/option; `TutorialVideoModal.jsx` now defaults to `1x` and offers `0.85x` instead of `0.75x`. Update the assertion.
- AC6 (`:204`) — *Likely flaky/timing.* Races a fixed 2s sleep against `recordAchievement`'s fire-and-forget POST+refetch+render chain. Replace the fixed sleep + one-shot count check with a polling assertion (`toHaveCount(1, {timeout: 8000})`).

**`t4800-orphan-drafts.qa.spec.js:63`** — *Environment/scope mismatch.* Spec header states the fixture account's profile SQLite must be seeded out-of-band with specific draft rows; that seed step wasn't run before this sweep. Not a regression — run the seed first, or add a test-only seed API seam.

**`T4850-move-reels.spec.js:143`** ("single-profile account never sees the Move affordance") — *Likely flaky/timing OR real gap, needs verification.* Spun to the full 5-minute timeout waiting for a reel card that never rendered, even though the backend seed call succeeded synchronously. The test bypasses real UI (`bootAs()` manually flips Zustand state) rather than clicking through — a plausible-but-unconfirmed lead. Needs a headed/traced rerun; check whether `useCollections`'s fetch is keyed on something the seed seam doesn't trigger (e.g. a `collectionsVersion` bump).

### Batch 2 — entries ~25-48 (log lines 2470-3510)

**`T4900-overlay-action-failure-visibility.spec.js:50`** — *Likely real regression, medium confidence, needs live confirmation.* The failure toast/Retry button render correctly (proving `overlayActionStore.failedActions` was populated), but the export button's `title` attribute — sourced from the exact same store field via `ExportButtonContainer` — reads `null`. Wiring looks correct on paper. Hypothesis: the test injects the failure via an absolute-path dynamic `import()` while the component imports the same file via a relative specifier; if Vite HMR ever cache-busted one of these mid-run, the two specifiers could resolve to two independent Zustand store instances (toast still fires via a separate shared Toast store; the button's subscription would miss it). Needs a live devtools check comparing module identity — if confirmed, drive this test through real UI (abort a real network route) instead of a back-door store import.

**`T5070-blocking-update-gate.spec.js`** (4 tests):
- Test B (`:85`, proven) — *Stale/broken test.* Mocks a header (`x-app-version`) and reads a `.reason` field that no longer exist anywhere in current code — the entire mismatch-detection mechanism was replaced by Tbug40p/Tbug41s (`__APP_BUILD__`/`X-App-Build` comparison + a required `bundleProbe`, deliberately absent on a dev server). Delete/rewrite against the current mechanism.
- Tests A, C, D (`:41,:135,:183`, unconfirmed) — *Likely flaky/timing or stale, needs a live check.* Call `requireUpdate('sw')` with a stale positional-string argument (current signature takes an options object) — this doesn't throw, it just silently no-ops the `needsMigration` flag, and by static reading the gate should still appear. All three fail identically to the provably-stale Test B, which is suspicious. Needs a live-browser repro (`requireUpdate('sw')` in a real tab) to tell genuine bug from environment/dev-server-state noise; update the stale call signature regardless.

**`T5130-sport-ball-playhead.qa.spec.js`** (2 tests) — *Stale/broken test, spec-robustness bug not product bug.* The test logs in as the real authenticated user then navigates to `/shared/{token}` on the SAME page — `App.jsx`'s public-share-only render path is gated on `!isAuthenticated`, so it's skipped, and the full authenticated dashboard (with its own ~7 background `<video>` tags) stays mounted underneath, breaking an unscoped `page.locator('video')`. Fix: visit the share link in a fresh, unauthenticated `browser.newContext()` to match real public-viewer semantics.

**`T5190-intro-upload-consent.spec.js:214`** + **`T5215-intro-attachment.qa.spec.js`** (11 tests total, one shared cause) — *Stale/broken test.* T6660 renamed "Player intro card"/"Intro cards" to "Athlete Intro Card(s)" everywhere in the app; both specs' shared helpers (`openManageProfileEdit`, `ensureAtLeastOneCard`) still wait for the old strings, which no longer exist anywhere (confirmed via a full-source grep). Because `T5215`'s `setup` test crashes on this before it can grant consent, the other 9 `T5215` tests then fail differently — clicking a `disabled` card option (consent never got granted this run) and spinning the full 5-minute actionability-retry ceiling. One 2-line fix (update both stale strings) should resolve all 11.

**`T5225-text-lever-drag.qa.spec.js:219,:236,:248,:267`** (4 of the file's 10 tests; see Batch 3 and the harness fix in the Summary's "Concrete real bugs" #7 for the other 6 and the root cause) — *Likely flaky/timing, per Batch 3's fuller analysis of this file.*

### Batch 3 — entries ~49-72 (log lines 3511-4480)

**`T5225-text-lever-drag.qa.spec.js:219,:236,:248,:267`** (4 tests) — *Likely flaky/timing.* All 4 fail at the same `waitForBlock()` helper used successfully by 6 OTHER tests earlier in the same file/run — identical code, subset failing, durations matching a timeout-cluster pattern. Points to Vite dev-server/CDP resource contention under the full parallel run rather than a deterministic app bug (a real rendering bug would fail all 10, not a trailing subset). Rerun in isolation to confirm; if it still fails intermittently alone, escalate as a real race in `useTextOverlays`/`TextLayer` init. (Note: the harness itself has a SEPARATE, confirmed-real bug — see Batch 2/6's `textdiag/main.jsx` stale-API finding, which explains the file's OTHER 6 failures.)

**`t5672-arrows-screenshot.spec.js`** (2 tests) — *Stale/broken test.* Waits for a "Scroll right" arrow gated on carousel-row overflow; since T6810 split drafts into many small per-stage+per-aspect rows, individual rows rarely overflow anymore at these viewport widths on the real (undecorated) account. Needs synthetic overflow data seeded, like sibling specs already do.

**`t5672-carousel-chevrons-auto-badge.spec.js:146`** — *Stale/broken test (fragile seed).* Derives a synthetic draft's `aspect_ratio` via `current.find(p => ...)` against the live account; if no draft currently satisfies both predicates, the spread yields `undefined` and a persisted (non-'all') aspect filter can silently exclude the synthetic draft from ever rendering. Fix: set `aspect_ratio` explicitly on the synthetic objects instead of deriving it. (Side note: found a possible pre-existing violation of the "no persisted view state" rule — `ProjectManager.jsx` persists `aspectFilter`/`statusFilter`/`creationFilter` — worth a follow-up ticket independent of this test fix.)

**`T5672-drafts-tiles-carousel.spec.js:31`** — *Stale/broken test.* Assumes the first draft tile is always portrait; T6800 made NOT_STARTED/uncropped drafts intentionally render at source (often landscape) aspect until real crop keyframes exist. Pick a tile confirmed past framing before checking aspect, or split into per-stage-row assertions.

**`t5672-drawer-aspect-split.spec.js:63,:112,:149`** (3 tests, ONE shared cause) — *Likely real regression* — see Summary "Concrete real bugs found" #1 (My Reels button accessible-name bug). Confirmed by contrast with `T5673-drawer-polish.qa.spec.js`, which deliberately bypasses this exact button via a direct store call and fails on a different, later error.

**`t5672-screenshot-verify.spec.js:16`** — *Stale/broken test.* Unscoped `text=` locator resolves to 2 elements (the synthetic draft's tile plus an unrelated real draft whose name happens to contain the same substring) — unsafe since T6810 introduced multiple stage-row groupings. Scope to a stable container + `.filter({hasText})`.

**`T5673-drawer-polish.qa.spec.js:85,:189`** (2 tests, shared cause) — *Stale/broken test (fragile selector, triggered by backend load).* `PANEL_SELECTOR = '.fixed.right-0.top-0'` also matches `ConnectionStatus`'s "Connecting to server..." banner, which stays mounted longer than usual under this run's heavy backend load. The spec's own comment already documents one prior collision with this same class-guessing approach. Give `DownloadsPanel` a stable `data-testid` instead.

**`T5673-my-reels-tiles.qa.spec.js:135`** — *Stale/broken test.* T6890 moved Rename from the kebab menu to a standalone pencil icon beside the name (confirmed by the component's own unit test). Update the assertion to target the pencil button instead of a kebab menu item.

**`T5674-overlap-overflow.qa.spec.js:240`** — *Environment/scope mismatch, needs live confirmation.* The crop reticle never mounts; project-selection fallback (`projects.find(p => p.working_video_id) || projects[0]`) may be landing on a draft with no video to crop if the real account currently has zero drafts with `working_video_id` set. Needs a live check of the account; harden the fallback to skip loudly instead of driving an unsuitable project.

**`T5675-home-hero-legibility.spec.js:56`** (360px iteration) — *Likely flaky/timing, inconclusive from static read.* Couldn't find any code path that would hide/split the wordmark specifically at 360px; given other evidence in this batch of backend/session slowness under load, more likely a slow/incomplete login+render at the check moment than a CSS regression. Check the test's own saved failure screenshot before deciding.

**`T5681-games-poster-grid.spec.js:178,:221`** (2 tests, shared cause) — *Stale/broken test.* Same T6890 change as `T5673-my-reels-tiles`: "Edit game" is now a standalone always-present per-tile pencil icon (not gated behind the kebab), so an unscoped role query matches all 9 game tiles on the page (strict-mode violation) instead of one. Scope to the specific tile under test.

**`T5700-team-layer-interactive.qa.spec.js:145,:156,:232,:276,:342`** (5 tests) — *Environment/scope mismatch* — see Batch 4's Cluster A for the confirmed root cause (two stray leaked clips in the real DB) and fix, which also covers 3 more failures of this same file plus `T5700-two-lanes`/`T5725-teammates-team-only`.

### Batch 4 — entries ~73-96 (log lines 4481-5403)

**Cluster A — `T5700-team-layer-interactive.qa.spec.js:401,:464,:478` + `T5700-two-lanes.qa.spec.js:113,:129` + `T5725-teammates-team-only.qa.spec.js:114,:182`** (7 tests, shared cause, DB-CONFIRMED) — *Environment/data mismatch* — see Summary "Concrete real bugs found" #5. Two stray empty-named clips (ids 178, 179) confirmed via direct SQLite query on the real account's game 6, sitting exactly where these specs seek assuming clear space. `AnnotateContainer.jsx`'s auto-select-on-seek effect re-fires even after the test's own Escape-retry, so this is genuinely un-recoverable by the test as written. Fix: delete the two rows; harden the shared `ensureAddClipVisible` helper (used identically across all 3 spec files) to verify the seek point is clip-free rather than trusting a hardcoded offset.

**`T5700-two-lanes.qa.spec.js:191`** — *Stale/broken test.* `getByTitle('My Athlete layer')` never resolves — per the T6400 invariant (documented in `annotate.md`), only the Team layer gets a row marker at all; My Athlete rows are unmarked by design, and no `title` attribute exists on clip-list rows anymore. Use a valid row selector instead.

**`T5710-per-layer-recap.spec.js:90`** — *Stale/broken test (test-infra gap).* Self-seeds a game via a raw backend test seam, then clicks "Games" with no reload/invalidate in between — the Games tab button is pure local UI state and never refetches; `gamesDataStore` only refetches on auth transition or an explicit invalidate call. Add a reload or explicit `invalidateGames()` call after seeding.

**`T5770-admin-weekly-usage.spec.js:33`** — *Environment/scope mismatch.* Depends on an externally pre-seeded admin user not present in the current dev Postgres — either the seed script wasn't (re-)run, or dev Postgres was truncated by an unrelated backend pytest run since (a known project landmine), or the admin list has grown past the unpaginated `page_size=50` the spec assumes. Re-run the seed script; if still missing, the spec needs pagination/search instead of assuming page 1.

**`T5780-framing-effective-duration.qa.spec.js:102` + `T5790-export-credit-cost-estimate.qa.spec.js:91,:181`** (3 tests, shared cause) — *Environment/data mismatch.* Both specs' `openFirstFramingDraft`-style helper waits specifically for a "Not started" project card; `FIXTURE-CONTRACT.md` only promises "≥1 framed project," not specifically one still un-started, and the real account's drafts have likely all progressed past that status through ongoing QA use. Extend the fixture contract to guarantee an un-started draft, or have these specs create their own throwaway one.

**`T5820-reference-link-cards.qa.spec.js`** — ALL 5 of its tests fail (`:86,:87,:88,:89,:90` in the run) — *Likely flaky/timing (infra), with a real-regression possibility flagged for follow-up.* Unlike its neighbors, this spec is fully self-contained (mocked APIs, `test-login`) with zero real-account dependency — no code defect found on read. Notably even a "sanity check unmodified game tile" test (criterion 4) fails at its very first, code-untouched assertion, which points toward an infra-level issue (this run was 4.6h on a local dev stack; there's project precedent for `uvicorn --reload`/dev-server degradation over long sessions) rather than 5 independent product bugs. Re-run this file alone against a freshly-restarted dev server first; only chase the `[data-reference-card]` click chain live if it still fails isolated.

**`T5900-reel-preview-overflow.qa.spec.js:41`** — *Likely flaky/timing, with a concrete regression candidate.* A single Escape doesn't close the preview if the player entered fullscreen first (`MediaPlayer.jsx`'s Escape handler exits fullscreen on the first press, only closes on a second press once out of fullscreen) — needs the test's own saved evidence to confirm whether fullscreen was engaged during this run. If so, the test needs two Escapes or should use the explicit close (X) button instead.

**`T5930-update-gate-single-through-login.qa.spec.js:41`** — *Stale/broken test, confirmed.* Calls `setUpdateSW`/`setWaitingProbe`/a string-based `requireUpdate('version-mismatch')` — none of which exist in the current `updateGateStore.js` (only `setSwReloader`/`requireUpdate({needsMigration})`). Targets a dead API surface entirely replaced by Tbug40p/Tbug41s. Rewrite against the current design or delete if `updateGateStore.test.js`'s existing unit coverage of the same scenario is sufficient — confirm coverage continuity first.

**Cluster E — `T5960-conflict-alarm-gated-on-write.spec.js:133` + `T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js:118,:310` + `T6040-reader-sees-stale-data-silently.spec.js:122`** (4 tests here; 5 total across batches 4/5, see Batch 5 for the other 4 in this same cluster) — *Likely real regression* — see Summary "Concrete real bugs found" #2 (`recordAchievement` missing `rbNonDataWrite`). Confirmed live: `hasAttemptedWrite` flips true ~1-2s after a passive Home load whenever the account's quest_1 is already complete, via the unmarked `returned_home` achievement POST — every other lifecycle/telemetry write in the codebase is correctly marked exempt; this one call site was missed.

### Batch 5 — entries ~97-120 (log lines 5360-6350)

**`T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js:310`** — same root cause as Cluster E above (live-reproduced independently in this batch, confirming the `syncStore.js`/`SyncStatusIndicator.jsx` code itself matches its documented design — the ONLY fix needed is the `recordAchievement` marker).

**`T6040-reader-sees-stale-data-silently.spec.js:122,:172,:207,:244`** (4 tests) — same root cause as Cluster E; all 4 defeated by the identical `returned_home` auto-fire (2 expect the alarm hidden, 2 expect the reader-conflict-notice variant which never renders once `hasAttemptedWrite` flips the code path to the alarm branch instead).

**`T6190-project-open-fetches.qa.spec.js:89,:144,:178,:204`** (4 tests, one shared cause) — *Environment/scope mismatch, live-confirmed.* `openFramingChip()`'s regex only matches the SINGLE-clip per-clip title format; the real dev account's only current reel draft is a 3-clip aggregate with a different title format entirely, confirmed by dumping every `[title]` attribute live. Re-seed a single-clip framed draft (restores `FIXTURE-CONTRACT.md` guarantee #2), or widen the regex to accept both formats.

**`T6230-update-gate-real-sw.spec.js:196`** — *Likely flaky/timing.* Reproduced live TWICE with two DIFFERENT failure signatures (dialog never appeared vs. `navigator.serviceWorker` undefined) — strong evidence of genuine ServiceWorker-lifecycle non-determinism in headless Chromium, not a logic bug. Needs several repeated isolated runs to confirm consistency before any fix; if consistent, look at whether `waitForSwReady` can race SW registration.

**`T6300-reel-tile-persistent-actions.qa.spec.js:149,:218,:264`** (3 tests, 3 independent causes):
- `:149` (criterion 2) — *Stale/broken test.* T6890 removed Rename from the kebab/bottom-sheet entirely (now a standalone pencil icon) — same change as the `T5673`/`T5681` findings above.
- `:218` (criterion 3) — *Likely real regression, confirmed* — see Summary #3 (`ReelTile.jsx:145` hardcoded `menuHeight=300`).
- `:264` (criterion 4) — *Likely real regression, needs one more live pass.* Reproduced live: the `CollectionPlayer` dialog doesn't close on Escape in this flow and blocks the rest of the test for its full timeout; its close button also has no accessible name at all (add `aria-label="Close"` regardless — Summary #8). Needs a console-trace of the Escape keydown listener to confirm whether it's a genuine handling regression or a focus/timing quirk specific to this test's sequencing.

**`T6320-my-reels-playhead.qa.spec.js:78`** — *Likely real regression, needs one more live pass.* The full prop chain from "Play all" click through to the sport-ball glyph render is correctly wired by static read, and a characterization test pins the same render path green under mocked props — so the gap is specifically in real runtime state (possibly `currentProfile`/`profiles` not yet populated) at the moment a MULTI-reel "Play all" fires, vs. the single-reel path which may differ in timing. Needs a live console-log of `storyPlayerHandleGlyph`/`currentProfile.sport` at that exact moment.

**`T6400-inherit-last-clip-layer.qa.spec.js:141,:167`** (2 tests) — *Environment/scope mismatch.* The spec's own header explicitly requires seek offsets (30s/90s) that fall outside any real clip on game 6; more clips have since been annotated on that shared game, so the offsets likely now land inside a real clip. Point at a genuinely empty stretch, or use a dedicated fixture game not subject to ongoing shared-account annotation.

**`T6480-text-editor-contrast.qa.spec.js:102`** — *Stale/broken test, confirmed.* Searches for a footer note that was deliberately removed by user request (pinned by an existing unit test: `TextSpecEditor.presets.test.jsx` explicitly asserts it's gone). Delete this test case.

**`T6510-preview-image-frame-choice.qa.spec.js:149,:174,:201,:226,:292` + `T6560-preview-image-never-cleared.qa.spec.js:138,:271`** (7 tests, ONE shared cause, live-confirmed) — *Environment/scope mismatch.* Both specs' draft-selection helper picks the first "loadable" In-Overlay draft by checking only for a streamable working video — but the specific draft it resolves to (verified live) has NEITHER of the two possible action buttons the helper's two variants look for (it's in some third UI state neither accounts for). Harden the helper to verify an action button actually exists before selecting a candidate, skipping to the next if not.

**`T6600-modal-z-order.qa.spec.js:148,:191`** (2 tests, 2 independent causes):
- `:148` — *Environment/scope mismatch, needs a live check.* The test tries to create an intro card to test deletion against, but the account may lack an intro-card creation prerequisite (e.g. a required photo); the test's own honest `test.skip` escape hatch never gets reached before timing out. Needs a live run with per-step logging to find exactly which creation step stalls.
- `:191` — *Likely flaky/timing.* Reads `boundingBox()` on a CSS-slide-in-animated drawer element likely before its transition settles, causing the DOM-point probe to sample a stale position. Add an explicit settle-wait before probing.

### Batch 6 — entries ~121-144 (log lines 6351-7454)

**`T6610-text-body-drag.qa.spec.js`** — ALL 10 of the file's tests (lines 95,112,135,149,162,196,233,245,260,280) — *Likely real regression, in dev-only test-harness code* — same `textdiag/main.jsx` stale-API root cause as `T5225`, see Summary #7.

**`T6620-defects.qa.spec.js:130,:182,:244`** (3 tests, 2 causes):
- `:130,:182` — *Environment/data mismatch.* `openOverlay()` times out waiting for real video hydration on a hardcoded real-account project id (50) — matches the documented T6100 "dangling `working_video` ref" pattern, which `.claude/knowledge/keyframes-framing.md` specifically flags Overlay as prone to. Check/restore project 50's R2 ref, or make the spec probe for a suitable project instead of hardcoding one that can rot.
- `:244` — *Likely real regression, confirmed* — see Summary #4 (`SLOT_META.title` "Athlete Name" label defined but never rendered anywhere in the rail).

**`T6630-round7-evidence.qa.spec.js:220`** — *Likely flaky/timing.* The app legitimately renders TWO `overlay-settings-tabs` containers simultaneously (dual-aspect hosts, confirmed by an existing unit test); the locator's `:visible` filter can pin to the wrong host mid-transition. The spec's own preamble already documents concurrent real-account test crosstalk as a known confound. Needs an isolated rerun; if it still fails, scope the locator to the specific active host rather than a fresh `:visible` re-query.

**`T6630-text-add-remove-drag.qa.spec.js:318`** — *Stale/broken test, confirmed.* Waits for a global "Add Text" button that T6630 round 6 deliberately removed by explicit user direction (documented in the component's own docstring and pinned by `TextLayer.test.jsx`). The entire test premise was invalidated by a later round of the same task. Delete or fully rewrite against the current per-region add-element flow.

**`T6700-owner-inapp-intro.qa.spec.js:228,:288,:367` + `T6710-intro-timeline-segment.qa.spec.js:196,:364,:406`** (6 tests, shared cause, confirmed) — *Stale/broken test* — see Summary #6 (`page.locator('video')` too broad after the T6420/T6820 tile-preview feature added ~30 hover-preview `<video>` elements to the grid).

**`tutorial-capture-framing.spec.js` + `tutorial-capture-overlay.spec.js` + `tutorial-capture-publish.spec.js`** (3 files) — *Environment/scope mismatch, not functional tests at all.* All three are explicitly documented as developer screen-recording scripts requiring hand-staged account state (a draft at a specific pipeline stage, a specifically-named draft reaching "Done"), not assertions meant for unattended runs. `publish` likely cascades from `overlay` never completing its manual staging step. Recommend excluding `tutorial-capture-*` (all but `-annotate`, which passed) from the default suite glob entirely — reserve for a separate manual invocation.

---

## Slow Tests (runtime-reduction target list)

These are every test (passing or failing) whose duration was notable. Failing tests
with a duration are cross-referenced to their cluster section above for the
category/hypothesis; they're listed again here because the runtime-reduction effort
needs the duration data regardless of pass/fail.

### 5+ minutes (hit the local 5-minute test-timeout ceiling — all FAIL)

| Duration | Spec file | Test |
|----------|-----------|------|
| 5.5m | `t5672-drawer-aspect-split.spec.js:63` | drawer aspect split at 1280px: two rows, portrait first, legible chips |
| 5.4m | `T5215-intro-attachment.qa.spec.js:212` | b: selecting a card persists across reload (resolved name) |
| 5.4m | `T5215-intro-attachment.qa.spec.js:928` | ROUND 3: Escape cancels with no write; Enter commits |
| 5.3m | `t5672-drawer-aspect-split.spec.js:112` | drawer aspect split at 390px: two rows still legible on mobile |
| 5.3m | `t5672-drawer-aspect-split.spec.js:149` | drawer: single-aspect game shows no aspect chip (unchanged look) |
| 5.3m | `T5700-two-lanes.qa.spec.js:191` | QA3: single track (not two lanes) and sidebar bottom controls stay reachable |
| 5.3m | `T5790-export-credit-cost-estimate.qa.spec.js:91` | credit estimate is live, equals ceil(output), and matches the modal |
| 5.3m | `T5820-reference-link-cards.qa.spec.js:285` | criterion 2: click navigates to the owning game — BOTH directions |
| 5.3m | `T5820-reference-link-cards.qa.spec.js:332` | criterion 2b: click navigates + highlights a MULTI-VIDEO owning game |
| 5.2m | `T5215-intro-attachment.qa.spec.js:282` | BUG REPRO (round 2): reopening the picker after RELOAD must visibly mark the stored selection |
| 5.2m | `T5215-intro-attachment.qa.spec.js:613` | ROUND 2: thumbnail shows the shared intro badge when an intro is attached (after reload) |
| 5.2m | `T5780-framing-effective-duration.qa.spec.js:102` | output-length chip is live, source-timeline safe, and responsive |
| 5.2m | `T5790-export-credit-cost-estimate.qa.spec.js:181` | estimate line is present and non-overflowing on mobile + desktop |
| 5.2m | `T5820-reference-link-cards.qa.spec.js:360` | criterion 3: owning game deleted -> visible notice, no crash, no silent no-op |
| 5.1m | `full-workflow.spec.js:227` | 1. Project Manager loads correctly |
| 5.1m | `T4850-move-reels.spec.js:143` | c6: single-profile account never sees the Move affordance |
| 5.1m | `T5215-intro-attachment.qa.spec.js:817` | ROUND 3: card click plays the motion preview and does not write; OK commits exactly one write |
| 5.1m | `T5215-intro-attachment.qa.spec.js:884` | ROUND 3: Cancel closes the popup with zero writes |
| 5.1m | `T5820-reference-link-cards.qa.spec.js:260` | criterion 1+5: reference renders as a link card |
| 5.1m | `T6510-preview-image-frame-choice.qa.spec.js:149` | default resolves + is SHOWN, and the upload affordance is gone |
| 5.1m | `T6510-preview-image-frame-choice.qa.spec.js:174` | moving the marker updates the shown still |
| 5.1m | `T6510-preview-image-frame-choice.qa.spec.js:201` | "Use current frame" picks the playhead frame |
| 5.1m | `T6510-preview-image-frame-choice.qa.spec.js:226` | reload persists the choice and writes nothing back on load |
| 5.1m | `T6510-preview-image-frame-choice.qa.spec.js:292` | grandfathered upload reel keeps its custom cover + one-way switch |
| 5.1m | `T6560-preview-image-never-cleared.qa.spec.js:138` | no marker interaction clears the preview frame; a deliberate drag still moves it |
| 5.1m | `T6560-preview-image-never-cleared.qa.spec.js:271` | the H.264 export-info line is gone (item 2) |

### 1-4 minutes (FAIL unless noted PASS)

| Duration | Spec file | Test |
|----------|-----------|------|
| 3.3m | `T4110-reedit-reel-persistence.spec.js:38` | T4110 live repro: re-edit a game-6 reel, export, move to My Reels, reload |
| 3.1m | `tutorial-capture-annotate.spec.js:74` | capture annotate tutorial footage **(PASS — still 3.1m, worth trimming)** |
| 3.0m | `T6600-modal-z-order.qa.spec.js:148` | nested ManageProfiles -> IntroCards -> ConfirmationDialog order |
| 2.0m | `T6300-reel-tile-persistent-actions.qa.spec.js:338` | criterion 4: every existing action still fires |
| 1.6m | `tutorial-capture-overlay.spec.js:17` | capture overlay tutorial footage |
| 1.4m | `T6620-defects.qa.spec.js:244` | legacy title_text shows the profile Full Name |
| 1.4m | `T6700-owner-inapp-intro.qa.spec.js:288` | criterion-2-and-3: owner collection play shows exactly ONE pre-roll |
| 1.3m | `T5225-text-lever-drag.qa.spec.js:206` | a real mouse drag still moves the START lever |
| 1.3m | `T6700-owner-inapp-intro.qa.spec.js:228` | criterion-1-and-3: owner single-reel play shows pre-roll then auto-continues |
| 1.3m | `T6710-intro-timeline-segment.qa.spec.js:196` | B1/AC1/AC2/AC4: composite scrubber visible+clickable |
| 1.3m | `T6710-intro-timeline-segment.qa.spec.js:364` | AC2: forward auto-continue |
| 1.2m | `T5225-text-lever-drag.qa.spec.js:115` | coarse: START lever right |
| 1.2m | `T5225-text-lever-drag.qa.spec.js:219` | clicking empty track adds a second text block |
| 1.2m | `T5225-text-lever-drag.qa.spec.js:236` | toggling a block flips enabled without deleting it |
| 1.2m | `T5225-text-lever-drag.qa.spec.js:248` | deleting a block removes it |
| 1.2m | `T5225-text-lever-drag.qa.spec.js:267` | evidence artifacts capture |
| 1.2m | `t5672-carousel-chevrons-auto-badge.spec.js:146` | Game groups render stage rows |
| 1.2m | `T5673-my-reels-tiles.qa.spec.js:135` | tile actions incl. Move-to-profile CONFIRM flow |
| 1.2m | `T5960-conflict-alarm-gated-on-write.spec.js:133` | criterion 1: passive load with a conflict marker -> NO alarm banner |
| 1.2m | `T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js:310` | auth writes (verify-otp/logout shape) do NOT arm the gate |
| 1.2m | `T6040-reader-sees-stale-data-silently.spec.js:122` | criterion 1: conflict + zero writes -> quiet non-alarm notice |
| 1.2m | `T6040-reader-sees-stale-data-silently.spec.js:172` | criterion 3: failed + zero writes -> still renders nothing |
| 1.2m | `T6300-reel-tile-persistent-actions.qa.spec.js:149` | criterion 2 (CRITICAL): touch-Windows repro |
| 1.1m | `derisk-staging-export.qa.spec.js:140` | staging export pipeline + publish |
| 1.1m | `T4780-tutorial-quest-steps.spec.js:74` | AC1 — Quest 1 shows "Watch the tutorial" as first step |
| 1.1m | `T5070-blocking-update-gate.spec.js:41` | A — gate blocks interaction/login, no dismiss affordance |
| 1.1m | `T5070-blocking-update-gate.spec.js:135` | C — flush failure keeps the gate up |
| 1.1m | `T5190-intro-upload-consent.spec.js:214` | UI: profile surface uploads a photo, ticks consent |
| 1.1m | `T5225-text-lever-drag.qa.spec.js:127` | coarse: END lever right |
| 1.1m | `T5225-text-lever-drag.qa.spec.js:138` | lever hit-target is >=44px on coarse pointers |
| 1.1m | `T5225-text-lever-drag.qa.spec.js:164` | dragging the END lever near the clip boundary SNAPS onto it |
| 1.1m | `T5225-text-lever-drag.qa.spec.js:185` | dragging the END lever FAR from the clip boundary free-parks |
| 1.1m | `T5290-recap-mobile-redesign.spec.js:174` | portrait: full-width video, no overflow, immersive collapse **(PASS)** |
| 1.1m | `T5675-home-hero-legibility.spec.js:56` | home hero + GameCard legibility across widths |
| 1.1m | `T5820-reference-link-cards.qa.spec.js:382` | criterion 4 + perf: real games render unchanged |
| 1.1m | `T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js:118` | passive load with a failed marker -> NO alarm banner |
| 1.1m | `T6040-reader-sees-stale-data-silently.spec.js:207` | criterion 5: the reader's Reload reaches the restore path |
| 1.1m | `T6040-reader-sees-stale-data-silently.spec.js:244` | responsive: reader notice does not overflow at 375px |
| 1.1m ×10 | `T6610-text-body-drag.qa.spec.js` (lines 95,112,135,149,162,196,233,245,260,280) | ALL 10 failures in this file are ~1.1m — strong shared-cause signal |
| 1.0m | `T5070-blocking-update-gate.spec.js:183` | D — successful flush proceeds past the barrier |
| 1.0m | `T6230-update-gate-real-sw.spec.js:196` | case 2 (OVER-CORRECTION GUARD) |
| 1.0m | `T6630-round7-evidence.qa.spec.js:220` | R7-1: the Text tab panel goes STRICTLY empty |

### 30-59 seconds

| Duration | Spec file | Test | Pass/Fail |
|----------|-----------|------|-----------|
| 58.1s | `T5710-per-layer-recap.spec.js:90` | Team Recap and {Athlete} Recap show layer-pure clip rails | FAIL |
| 50.5s | `T5674-overlap-overflow.qa.spec.js:115` | AC1 — report pill never overlaps controls | PASS |
| 49.4s | `T4770-new-user-flow-perf-walkthrough.spec.js:191` | cold-cache full journey | PASS |
| 48.2s | `regression-tests.spec.js:1644` | Create project from library clips @full | FAIL |
| 46.0s | `regression-tests.spec.js:1474` | Framing: crop window is stable (no infinite loop) @smoke | FAIL |
| 45.4s | `regression-tests.spec.js:1541` | Framing: spacebar toggles play/pause @smoke | FAIL |
| 45.0s | `regression-tests.spec.js:1425` | Framing: video first frame loads @smoke | FAIL |
| 44.3s | `T4900-overlay-action-failure-visibility.spec.js:50` | B+C+D+E — happy path then failure burst then retry-success | FAIL |
| 38.0s | `T5290-recap-mobile-redesign.spec.js:220` | landscape: side-by-side layout unchanged, no overflow | PASS |
| 37.0s | `T6300-reel-tile-persistent-actions.qa.spec.js:230` | criterion 2b: a real coarse-pointer device (iPhone) | PASS |
| 36.7s | `T6190-project-open-fetches.qa.spec.js:144` | criterion 6a: 0 health on the SPA project-open transition | FAIL |
| 36.4s | `clip-selection-state-machine.spec.js:202` | Complete state machine verification @t690 | PASS |
| 34.3s | `T6190-project-open-fetches.qa.spec.js:204` | annotate -> framing invalidates clips | FAIL |
| 33.6s | `T6190-project-open-fetches.qa.spec.js:178` | criterion 6b: connection banner shows in the editor when health fails | FAIL |
| 33.3s | `T4550-overlay-transform.qa.spec.js:61` | Framing: crop overlay placed + drag lands accurately | FAIL |
| 33.2s | `T4880-mobile-editor-reachable.spec.js:99` | Overlay: Create Reel control reachable + clickable | FAIL |
| 32.6s | `T4880-mobile-editor-reachable.spec.js:64` | Framing: Export control reachable + clickable | FAIL |
| 32.6s | `T6190-project-open-fetches.qa.spec.js:89` | project-open fires 0 games, 1 clips-list, 0 health | FAIL |
| 32.2s | `T6730-seek-back-to-intro.qa.spec.js:264` | REAL mouse gesture, no settle, repeated | PASS |
| 30.6s | `T6620-defects.qa.spec.js:130` | the eye HIDES it (even selected), and it persists hidden | FAIL |

**Pattern:** `T6190-project-open-fetches.qa.spec.js` (all 4 of its failures, 32-37s
each) and `regression-tests.spec.js` (3 of its Framing @smoke failures, 45-46s each)
cluster tightly around the same duration within their own file — consistent with each
file having its own shared setup/wait-condition problem rather than 4 (or 3)
independent per-test bugs. See their cluster writeups above for the specific
hypothesis.

---
