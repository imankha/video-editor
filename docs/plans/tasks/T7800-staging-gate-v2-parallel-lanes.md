# T7800: Staging Gate v2 - 13 specs, 3 parallel lanes, 2 accounts, under 20 min

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-26
**Updated:** 2026-08-26

## Problem

The user's pre-manual-test runbook needs an automated staging gate covering ALL major
functionality in under 20 minutes. The existing `@staging-gate` subset (T5400, 5 specs)
covers auth/session-init, framing, export/publish, sharing, and recap layout, but leaves
these surfaces untested on staging: Annotate (game load, clip markers), games poster grid,
My Reels groups, reel download feedback, the public shared viewer, deep links/tab
persistence, and mobile/desktop share routing (the twice-regressed UA-sniff landmine,
T7350). The gate also runs serially on one account, wasting wall clock.

Full analysis (coverage matrix, lane design, timing budget):
https://claude.ai/code/artifact/c72bec50-25cc-455c-adfb-26691d573ecf

## Solution

Grow the gate from 5 to 13 specs (all already written; 7 just need the tag) and split it
into 3 parallel lanes run as 3 concurrent Playwright processes (specs read env at import
time, and Playwright projects cannot set per-project env, so process-level parallelism is
the zero-refactor mechanism):

- **Lane A `@gate-a`** (imankh@gmail.com / 9fa7378c, all heavy writes):
  `staging-smoke` -> `derisk-staging-export` -> `derisk-staging-endcard-copylink`
- **Lane B `@gate-b`** (second seeded account, reads + light writes):
  `game-loading`, `annotate-game-clock`, `T4550-overlay-transform`, `T5290-recap`,
  `T4190-my-reels-group-visibility`, `T5677-home-deeplinks`, `T7350-mobile-share-routing`
- **Lane C `@gate-c`** (mocked, no account + second account for slow reads):
  `collection-share`, `shared-viewer-affordance-gating`, `T5681-games-poster-grid`,
  `T7100-reel-download-feedback`

Why per-account lanes: concurrent write sessions on one account cause stale_baseline R2
CAS freezes (known from multi-container QA). Lane A owns all heavy writes; B/C share the
second account with only light/read traffic.

Estimated wall clock ~10-14 min typical, bounded ~16 min by the export spec's own timeout.

## Context

### Relevant Files (REQUIRED)

Tag + lane + fixture-guard additions (title-line edits, guards where missing):
- `src/frontend/e2e/staging-smoke.spec.js` - add `@gate-a` (keeps `@staging-gate`)
- `src/frontend/e2e/derisk-staging-export.qa.spec.js` - add `@gate-a`
- `src/frontend/e2e/derisk-staging-endcard-copylink.qa.spec.js` - add `@gate-a`
- `src/frontend/e2e/game-loading.spec.js` - add `@staging-gate @gate-b`
- `src/frontend/e2e/annotate-game-clock.spec.js` - add `@staging-gate @gate-b`
- `src/frontend/e2e/T4550-overlay-transform.qa.spec.js` - add `@gate-b`
- `src/frontend/e2e/T5290-recap-mobile-redesign.spec.js` - add `@gate-b`
- `src/frontend/e2e/T4190-my-reels-group-visibility.spec.js` - add `@staging-gate @gate-b` + env-driven identity
- `src/frontend/e2e/T5677-home-deeplinks-route-fallback.spec.js` - add `@staging-gate @gate-b` + env-driven PROFILE_ID
- `src/frontend/e2e/T7350-mobile-share-routing.qa.spec.js` - add `@staging-gate @gate-b`
- `src/frontend/e2e/collection-share.spec.js` - add `@staging-gate @gate-c`
- `src/frontend/e2e/shared-viewer-affordance-gating.spec.js` - add `@staging-gate @gate-c`
- `src/frontend/e2e/T5681-games-poster-grid.spec.js` - add `@staging-gate @gate-c`
- `src/frontend/e2e/T7100-reel-download-feedback.qa.spec.js` - add `@staging-gate @gate-c`

Hygiene (LOCAL_ONLY_SPECS inventory gaps found during analysis):
- `src/frontend/e2e/helpers/targetEnv.js` - add entries: T6190 (vite-module), T7360
  (vite-module), T7040 (local ffprobe + relative API), T5330 (test seam); update
  STAGING_GATE_SPECS inventory to the 13-spec set with lanes
- `src/frontend/e2e/T6190-project-open-fetches.qa.spec.js` - add skipOnDeployedTarget
- `src/frontend/e2e/T7360-concurrent-uploads.qa.spec.js` - add skipOnDeployedTarget
- `src/frontend/e2e/T7040-collection-download.qa.spec.js` - add skipOnDeployedTarget
- `src/frontend/e2e/T5330-share-signup-nuf.spec.js` - add skipOnDeployedTarget
- `src/frontend/e2e/annotate-annotations-render.spec.js` - migrate off hardcoded game 5
  (discover an ACTIVE game like annotate-game-clock does; loud skip when absent)

Seeding + runner:
- `scripts/copy_user_between_envs.py` - add `--to-email` flag (clone imankh to an alias
  account so the second account satisfies FIXTURE-CONTRACT.md automatically)
- `scripts/staging-gate.sh` - NEW: warm staging /health (cold start ~145s), verify both
  seeds via dev-login probe, launch 3 concurrent playwright processes (per-lane grep +
  per-lane env + separate --output/report paths), aggregate exit codes into one verdict
- `src/frontend/package.json` - `test:e2e:staging-gate` gains lane variants

Docs:
- `src/frontend/e2e/STAGING-GATE.md` - v2 lane model, runbook usage, re-seed cadence
- `src/frontend/e2e/FIXTURE-CONTRACT.md` - second-account section

### Related Tasks
- Builds on: T5400 (gate), T5420/T5320 (fixture contract), T7750 (default-run exclusion)
- Blocks: T7810 (phase 2: adapt T7540 annotate-save + t4940 credits into lanes)
- Related: T7770 (suite trim; different goal, keep sets consistent)

### Technical Notes
- Specs read `E2E_REAL_EMAIL`/`E2E_REAL_PROFILE` into module-scope consts at import time;
  per-process env is therefore the parallelism seam. Do NOT refactor to projects.use.
- `loginAsRealUser` is per-call parameterized and stateless (verified): multi-account in
  one machine is safe at the helper level.
- The export spec consumes the fixture's un-finalized draft and publishes a real reel per
  run: the runbook's step 0 is the (idempotent) seed copy for BOTH accounts. Seeding also
  guarantees a framed draft with an intact working-video R2 object, keeping the export in
  its fast 2-6 min path (unframed path is 8-16 min).
- Hardcoded identities found: T4190 (REAL_EMAIL + PROFILE_ID consts),
  t4940 (EMAIL const, phase 2), T5677 (PROFILE_ID const).
- T6190 criterion-4 permanently edits a real clip boundary with no restore (fixture-drift
  generator); its staging gating does not fix that but the task notes it for T7810/local.
- Seed execution against staging is a SUPERVISOR/host step (cross-env creds + Fly proxy),
  never run from a container.

## Implementation

### Steps
1. [x] Tag lane A members (`@gate-a`) in the 3 existing gate specs
2. [x] Tag + guard lane B members, fix T4190/T5677 identity consts
3. [x] Tag + guard lane C members
4. [x] targetEnv.js: STAGING_GATE_SPECS v2 inventory + 5 new LOCAL_ONLY_SPECS entries
5. [x] Gate the ungated local-only specs with skipOnDeployedTarget (T6190, T7360, T7040,
   T5330, and T5710, which was discovered tagged @staging-gate while depending on the
   seed-recap-game seam)
6. [x] Migrate annotate-annotations-render to active-game discovery
7. [x] copy_user_between_envs.py --to-email
8. [x] scripts/staging-gate.sh + package.json scripts
9. [x] Docs: STAGING-GATE.md + FIXTURE-CONTRACT.md
10. [x] Verify: lane collection A=6/B=16/C=29 tests, umbrella=51 in 19 files (exact
    union), default run leaks 0 gate tests; eslint 0 errors; py_compile + argparse OK;
    bash -n OK
11. [ ] Seed second account on staging + first timed full run (record per-lane times)

### Progress Log

**2026-08-26**: Task created from the Staging Gate v2 analysis (artifact above). Analysis
verified staging-safety, write-risk, and runtime for all 18 candidate specs.

**2026-08-26 (impl)**: Steps 1-10 implemented and committed (7c6f3241). Discovery during
implementation: the live @staging-gate tag membership had drifted to 13 files (bug38 x2,
T5642, T5676, T5710 were tagged after T5400's 5-file inventory); all were kept and given
lanes, with T5710 additionally gated local-only (it depends on /api/test/seed-recap-game
and would have hard-failed any deployed gate run).

**2026-08-26 (live runs)**: Full prep + 3 timed gate runs executed against staging.
Prep: 3 accounts seeded (--to-email worked end-to-end; two source-data issues found and
fixed along the way: a dangling final_videos row in dev imankh from the pre-T6770
ref-count-drift bug class, deleted with a JSON backup in the session scratchpad, and
dev's deferred R2 sync requiring a manual profile push), postgres migrated v023->v025.
Run 1 (1x/2048 VM): RED 16m40s, ~19 phantom failures from CPU-saturation proxy 502s +
export spec skipped (no un-finalized draft; created draft 73 as fixture). Run 2
(4x/4096): 5m43s, only 2 failures, both STALE SPEC SELECTORS (export button renamed to
"Export Focused Video"/"Add Overlay"; framingDraft chip regex = the documented
FIXTURE-CONTRACT bracket gotcha) - fixed in 29b9e867. Run 3: ALL GREEN in 5m48s with a
real export->final->publish. Machine reverted to 1x/2048 and restarted. Branch CI green.
Remaining for the user: merge verdict.

**2026-08-26 (review)**: Reviewer (Opus) found 1 BLOCKING + 4 MAJOR + 8 MINOR; all
addressed in c94b5ccb: invite_code unique-collision fix (re-derived per the app formula),
lane C moved to its own alias account (e2e-gate2@test.local; B/C sharing was only safe on
single-machine staging), by-path grepInvert lift (tagged specs collected 0 tests when run
by file path, breaking dev-verify.sh), honest runner output (no phantom html-report path),
clip_count discovery guards, plus the minors. Branch pushed. WAITING ON USER: (1) seed the
3 fixture accounts on staging (machines stopped; commands in FIXTURE-CONTRACT.md
§ Seeding), (2) run `bash scripts/staging-gate.sh` for the first timed gate run, (3) merge
verdict.

## Acceptance Criteria

- [x] `npx playwright test --grep @staging-gate --list` collects the full gate (as built:
  51 tests in 19 files — the live tag membership had drifted to 13 files before this
  task; all kept and laned, plus 8 new members)
- [x] Each lane grep collects exactly its lane set (A=6, B=16, C=29 tests; only T5676
  spans two lanes, one describe each)
- [x] Every data-dependent gate spec skips LOUDLY (named missing fixture), never silent green
- [x] `scripts/staging-gate.sh` runs 3 lanes concurrently (one account PER lane after
  review: imankh + 2 alias clones) and prints one aggregated verdict
- [x] T4190/T5677 respect E2E_REAL_EMAIL/E2E_REAL_PROFILE
- [x] The 5 inventory-gap specs (incl. T5710) skip loudly on a deployed target and are
  listed in LOCAL_ONLY_SPECS
- [x] copy_user_between_envs.py --to-email clones to an alias without touching the source
  account (google_id nulled, invite_code re-derived per the app's own formula)
- [x] First timed staging run completes under 20 min wall clock, times recorded in
  STAGING-GATE.md (2026-08-26: ALL LANES GREEN in 5m48s on a temporarily scaled-up
  shared-cpu-4x/4096 machine; A: 6 passed/2.9m incl. real export+publish, B: 13/5.1m,
  C: 21/5.7m. On the default 1x/2048 VM the lanes saturate the CPU into proxy-502
  phantom failures, so gate prep scales the machine up and reverts after; see
  STAGING-GATE.md § machine-size requirement)
