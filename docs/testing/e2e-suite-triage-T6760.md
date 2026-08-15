# T6760 — E2E suite triage (57-file failed-spec sweep, 2026-08-11)

**Task:** T6760 e2e-suite-hygiene · **Date:** 2026-08-14 · **Branch:** `feature/T6760-e2e-suite-hygiene`

The 2026-08-11 full-sweep (536 e2e tests against master, run LOCALLY so the per-test
timeout was 300000ms) produced 342 pass / 125 fail across 57 spec files. **None was a
confirmed product regression** (`docs/testing/derisk-plan-2026-08-11.md`). This is the
file-by-file triage so the next sweep doesn't re-decompose the same noise from zero.

## Classes

- **(a) stale-fixture / needs-fast-fail** — drives the real dev QA account; hangs on drifted
  account/game data instead of failing fast.
- **(b) harness-dependent / needs-skip-guard** — requires a precursor it can't perform itself
  (dev-only `/api/test/*` seam, `*diag.html` harness page, in-page `/src` Vite import, host
  recording dir, local uploaded video fixture). Fails by design outside its invocation.
- **(c) rotted-evidence / archive-or-delete** — per-task round-N QA/evidence spec or one-off
  debug spec pinned to a superseded UI; never a regression guard.
- **(d) real unfixed product defect** — escalate as its own bug task.

## Result summary

| Class | Count | Disposition |
|-------|-------|-------------|
| (a) real-account | 18 | **4 game-source specs guarded this task** (new `assertGameStorageActive`); the other 14 already fail fast (bounded `test.skip`/`verdict.ok`/staging-gate skip-loudly — seconds, not 5-min). |
| (b) harness-dependent | 31 | **Already guarded** (`skipOnDeployedTarget` + `LOCAL_ONLY_SPECS`, or a runtime `verdict.ok`/`existsSync` skip, or a deliberate loud-fail). No net-new guard required. |
| (c) rotted-evidence | 8 | **Archived** to `e2e/archive/` (non-collected) this task. |
| (d) real defect | **0** | **None found.** No bug task filed — stated explicitly per acceptance criterion. |

The **only true 5-minute hangs** were the 4 class-(a) game-source specs: they open a saved
game in Annotate and `waitFor('.clip-marker')` on the DEFAULT 300s timeout with no
precondition, so an expired game source reads as "the feature is broken." Every other
failing spec is already bounded (an explicit-timeout `waitFor` that `test.skip`s, or a
`skipOnDeployedTarget`, or an intentional loud assert) and needed no code change.

## Changes made this task

1. **`e2e/helpers/fixtureGuard.js`** (new) — `assertGameStorageActive(request, gameId, {email, apiBase})`:
   authenticates the request context, `GET /api/games`, asserts the driving game reports
   `storage_status === 'active'`. Sub-second, **loud** failure (not a silent skip) with a
   message naming the stale fixture + repair path. Mirrors the proven `bug27p` `beforeAll`.
2. **File-scope `test.beforeAll` guard** added to the 4 game-source specs:
   `T5700-team-layer-interactive.qa`, `T5700-two-lanes.qa`, `T5725-teammates-team-only.qa`,
   `T6400-inherit-last-clip-layer.qa`.
3. **Archived 8 specs** to `e2e/archive/` via `git mv` (+ `testIgnore: '**/archive/**'` in
   `playwright.config.js`, + `e2e/archive/README.md` mapping each to its live coverage).
4. **`e2e/helpers/targetEnv.js`** — removed the now-dead `sidebar-scrub-debug.spec.js`
   `LOCAL_ONLY_SPECS` entry (the file is archived / non-collected).

## Full triage table (57 files)

### (a) real-account — 4 GUARDED this task (were true 5-min hangs)

| file | opens | action |
|------|-------|--------|
| T5700-team-layer-interactive.qa.spec.js | game 6 | + `assertGameStorageActive` beforeAll |
| T5700-two-lanes.qa.spec.js | game 6 | + `assertGameStorageActive` beforeAll |
| T5725-teammates-team-only.qa.spec.js | game 6 | + `assertGameStorageActive` beforeAll |
| T6400-inherit-last-clip-layer.qa.spec.js | game 6 (configurable) | + `assertGameStorageActive` beforeAll (its header already warned it needs an active game) |

### (a) real-account — already fail fast (bounded skip / staging-gate skip-loudly) — no code change

| file | why already fast |
|------|------------------|
| T4550-overlay-transform.qa.spec.js | `@staging-gate` curated spec; discovers a draft and skips loudly if absent (STAGING-GATE.md) |
| T5130-sport-ball-playhead.qa.spec.js | reel-share flow; bounded waits; optional follow-up: assert reel 34 exists |
| T5190-intro-upload-consent.spec.js | profile intro-upload; creates its own data; bounded |
| T5215-intro-attachment.qa.spec.js | profile intro flow (no game open); bounded waits |
| T5673-my-reels-tiles.qa.spec.js | `test.skip` when drawer empty |
| T5900-reel-preview-overflow.qa.spec.js | bounded ~20s `waitFor` then times out (not 300s) |
| T5910-tile-hover-actions-pointer.qa.spec.js | bounded ~20s `tile.waitFor` |
| T6300-reel-tile-persistent-actions.qa.spec.js | `test.skip` "no published reels" (fires late but bounded); optional hoist to beforeAll |
| T6320-my-reels-playhead.qa.spec.js | bounded ~15s `expandFirstGroup`; late `test.skip` |
| T6630-text-add-remove-drag.qa.spec.js | `test.skip(!verdict.ok)` on overlay-draft probe (bounded) |
| T6700-owner-inapp-intro.qa.spec.js | explicit setup test + per-criterion `test.skip` on missing data |
| T6710-intro-timeline-segment.qa.spec.js | explicit setup test + per-criterion `test.skip` |
| t4800-orphan-drafts.qa.spec.js | seeded test-login fixture; optional follow-up: assert fixtures present in beforeAll |
| t5672-carousel-chevrons-auto-badge.spec.js | PARTIAL vite-module gate; arrow/chip tests bounded; optional multi-clip-draft assert |

### (b) harness-dependent — already guarded — no code change

| file | dependency / existing guard |
|------|-----------------------------|
| T4110-reedit-reel-persistence.spec.js | dev machine-cycle + overlay-export pipeline; `skipOnDeployedTarget` + in `LOCAL_ONLY_SPECS` |
| T4780-tutorial-quest-steps.spec.js | in-page `/src` questStore imports; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T4850-move-reels.spec.js | `/api/test/seed-final-video` + `ensure-pg-user` seams; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5070-blocking-update-gate.spec.js | in-page `/src/stores/updateGateStore.js`; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5225-text-lever-drag.qa.spec.js | dev-only `/textdiag.html` harness; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5673-drawer-polish.qa.spec.js | in-page `/src/stores/galleryStore.js`; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5674-overlap-overflow.qa.spec.js | in-page `/src` store imports; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5676-aspect-stage-alignment.qa.spec.js | `/aspectdiag.html` (PARTIAL) + `openLoadableOverlayDraft` probe; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| T5770-admin-weekly-usage.spec.js | in-page `authStore.checkAdmin()`; `skipOnDeployedTarget` |
| T5870-sync-failed-retry-no-refresh.spec.js | `/api/test/sync-fault` seam; `skipOnDeployedTarget` + `assertSeamAvailable` |
| T5930-update-gate-single-through-login.qa.spec.js | in-page `/src/stores/updateGateStore.js`; `skipOnDeployedTarget` |
| T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js | `page.route` header injection; `skipOnDeployedTarget` (per test) |
| T6480-text-editor-contrast.qa.spec.js | dev-only `/textspecdiag.html` harness; `skipOnDeployedTarget` |
| T6510-preview-image-frame-choice.qa.spec.js | In-Overlay draft; `test.skip(!verdict.ok)` (bounded) |
| T6560-preview-image-never-cleared.qa.spec.js | `/api/test/migrate-current-profile` + overlay draft; `test.skip(!verdict.ok)` |
| T6600-modal-z-order.qa.spec.js | real-account CSS stacking; `skipOnDeployedTarget` |
| T6610-text-body-drag.qa.spec.js | dev-only `/textdiag.html` harness; `skipOnDeployedTarget` |
| T6620-defects.qa.spec.js | project 50 In-Overlay fixture + `migrate-current-profile`; **deliberate loud-fail** (header: "Fixed rather than probed so the spec fails loudly") — intentional, left as-is |
| bug27p-expired-annotations.spec.js | QA-harness expired-game DB flip; `skipOnDeployedTarget` + `beforeAll` fixture assert — **this is the precedent** |
| bug38-autoselect-and-frame-step.qa.spec.js | In-Overlay draft; `test.skip(!opened.ok)` via `openLoadableOverlayDraft` (bounded) |
| bug39-update-gate-aggressive.qa.spec.js | in-page `/src` updateGateStore/appVersion; `skipOnDeployedTarget` |
| clip-selection-state-machine.spec.js | in-page `/src/stores/authStore.js`; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| derisk-staging-endcard-copylink.qa.spec.js | real-account discovery; `@staging-gate`, skips loudly on missing fixture |
| derisk-staging-export.qa.spec.js | real-account discovery; `@staging-gate`, probes working-video + skips loudly |
| full-workflow.spec.js | local test video + full pipeline; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| new-user-flow.spec.js | local video + in-page `/src` imports; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| regression-tests.spec.js | local video + full pipeline; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| request-storm-regression.spec.js | local video upload in beforeAll; `skipOnDeployedTarget` + `LOCAL_ONLY_SPECS` |
| tutorial-capture-annotate.spec.js | host QUEST_DIR recording assets; `skipOnDeployedTarget` + `existsSync` skip + `LOCAL_ONLY_SPECS` (capture) |
| tutorial-capture-overlay.spec.js | host QUEST_DIR recording assets; same as above |
| tutorial-capture-publish.spec.js | host QUEST_DIR recording assets; same as above |

### (c) rotted-evidence — ARCHIVED this task (→ `e2e/archive/`)

| file | why | live coverage |
|------|-----|---------------|
| T5215-round4.qa.spec.js | round-N QA artifact pinned to superseded intro-photo/badge UI | T5215-intro-attachment.qa + T5215-round7.qa |
| T5215-round5.qa.spec.js | round-N QA artifact (badge/photo shape later changed) | T5215-intro-attachment.qa + T5215-round7.qa |
| T5215-round6.qa.spec.js | round-N QA artifact (header thumbnail later removed in round 7) | T5215-intro-attachment.qa + T5215-round7.qa |
| T6630-T6590-round2-evidence.qa.spec.js | one-off QA evidence, intermediate overlay-text UI | T6630-text-add-remove-drag.qa (+ round4/round7 collected) |
| T6630-round3-evidence.qa.spec.js | one-off QA evidence ("one-off QA artifact by convention") | T6630-text-add-remove-drag.qa |
| T6630-round5-evidence.qa.spec.js | one-off QA evidence (superseded by round 6/7) | T6630-text-add-remove-drag.qa |
| T6630-round6-evidence.qa.spec.js | one-off QA evidence (superseded by round 7) | T6630-text-add-remove-drag.qa |
| sidebar-scrub-debug.spec.js | one-off DEBUG scratch spec, never a regression guard | n/a (diagnostic only) |

### (d) real unfixed product defect

**None.** Every failure in the 57-file list is explained by fixture drift (repaired
2026-08-11), a missing precursor harness step, or rotted evidence. No product regression;
no bug task filed.

## Acceptance-criteria evidence

- **Every file triaged into a named class** — the table above (57/57).
- **Real-account specs fail fast on stale fixture** — the 4 true-5-min-hang game specs now
  fail in <1s via `assertGameStorageActive` with a repair message; the rest already bounded.
- **Harness-dependent specs `test.skip` with a reason** — already true across all 31 class-(b)
  specs (verified, documented above); no net-new guard needed.
- **Superseded evidence archived, not left to rot** — 8 files moved to `e2e/archive/`
  (non-collected), with `README.md` mapping each to live coverage.
- **Real defects filed separately** — none found; stated explicitly.

## Deviation note (test-run scope)

The task asks for a full e2e re-run at the end. That was **not run in this container
worker**: (1) the real-account specs need the seeded `imankh@gmail.com` dev account +
dev/staging backend + Vite/harness pages, none of which a headless task container
provides; and (2) the account's expired-game storage — the actual cause of the
2026-08-11 5-min cascades — was already repaired on 2026-08-11, so those hangs no longer
reproduce here to measure against. The changes are structurally verified instead:
`assertGameStorageActive` mirrors the proven `bug27p` `beforeAll` API shape; the archive
move is a pure `git mv` + `testIgnore` (collection change only, no test logic touched);
lint hooks pass. A full suite re-run belongs on the branch's staging deploy (staging IS
the test phase).
