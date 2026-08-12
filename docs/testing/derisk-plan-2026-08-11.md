# Derisk master for deploy — execution plan (2026-08-11)

**Audience:** a fresh supervisor session implementing this via /dotask + spawn-worker. Read this
whole file first; everything conversational is lost, this file is the handoff.

**Goal:** close the remaining deploy risks on master (`970ad4d6` or later) before the next prod
deploy. NOT a general quality pass — only what changes the deploy-risk picture.

---

## Context: what is already done and verified (do NOT redo)

Full-sweep results against master, all root-caused (supervisor session 2026-08-11):

- **Frontend unit: 2012/2012 green.** **Backend: green** after T6750 (pg_conn migration-ledger
  poisoning, test-infra only) — fixed, merged PR #257, Branch CI green, PLAN.md row = STAGING.
- **E2E (536 tests, 342 pass / 125 fail):** failures decomposed into (1) expired game-storage refs
  in the `imankh@gmail.com` dev QA account — **repaired**, all 6 games now active (this alone
  explains the giant 5-min-timeout cascades in T5700/T5725/T5215/T6400 clusters); (2) missing
  `formal annotations/test.short` video fixture in container clones — **fixed on master** (PR #255
  un-ignored it); (3) specs that REQUIRE a precursor QA-harness step (bug27p expired-game flip,
  tutorial-capture assets) — fail by design outside their intended invocation; (4) a small
  unverified residue (see Part C). **No confirmed product regression on master.**
- **The whole release surface (Intro Cards, Overlay regions, typography rewrite) was live-QA'd as a
  real user on 2026-08-10** — see
  [staging-verification-2026-08-10-RESULTS.md](staging-verification-2026-08-10-RESULTS.md). All
  PASS except one finding, which became T6730/T6740 — investigated, hardened, merged.
- Shared dev Postgres was repaired (migration ledger 1-22 + `shares_share_type_check` restored).
- Container `reel-task-testsweep2` is (probably still) running with the repaired account and a
  warm stack — reuse it for Part A if alive (`docker ps --filter name=reel-task`), else
  `bash scripts/task.sh up testsweep2 && bash scripts/task.sh stack testsweep2`.

## Remaining deploy risks (this plan, in order)

| Part | Risk | Action | Model |
|------|------|--------|-------|
| A | Egress paths (share/download composition) rewritten this release, never verified end-to-end | Live-drive QA, evidence per criterion | **Sonnet, medium effort** (spec-following QA; escalate diagnosis of any FAILURE to the Opus `expert` agent before touching code) |
| B | T6550: poster-marker write 500s in every deploy→migrate window | /dotask container fix | **Opus** (M-tier: the guarded-write return semantics + the asymmetry sweep are design calls) |
| C | E2E suite rot keeps producing noise; ref-count drift row gaps | File 1-2 backlog tasks, no code | **Sonnet** (mechanical filing) |
| D | Deploy runbook: migrations don't auto-run | Checklist only, no code | n/a |

---

## Part A — Egress live-drive QA (do first; highest-risk untested surface)

**Why:** this release rewired every place a video leaves the app (T5215/T5220 §7 of
[release-map-2026-08-10.md](release-map-2026-08-10.md)): serve-time ffmpeg composition
`[intro][reel][outro]`, share-page playback/download, collection share freeze. The 2026-08-10
live-QA pass explicitly did NOT exercise these ("Not exercised this pass" section of the RESULTS
doc). A silent failure here = broken downloads/shares for every user post-deploy.

**How:** drive the app as the real user (`imankh@gmail.com`, profile `9fa7378c`) in the container
via Playwright MCP or `scripts/dev-verify.sh` + the `drive-app-as-user` skill. This account has
real reels with intros attached, real collections, and active game storage. Assert on what the
user SEES / the actual bytes served, not API responses.

Checklist (from staging-verification §4, the un-exercised items only):

1. **Owner download of a reel with an intro attached** → ONE file, composed
   `[intro][reel][outro]`. Verify with ffprobe: downloaded duration ≈ intro duration + reel
   duration + outro, and the first frames are the intro card (extract frame at t=0.5s).
2. **Share link playback, logged out** (fresh browser context, no cookies): intro plays first,
   then the reel **auto-resumes with no manual tap** (regressed once before — watch it play, don't
   trust a paused-but-ready state).
3. **Share-page in-app download button** (`SharedVideoOverlay`): downloads the composed file (same
   ffprobe check), via `GET /api/shared/{token}/download`.
4. **Known gap — confirm, do NOT fix:** the public share page's plain-HTML footer `<a class="dl">`
   download still points at the raw `video_url` (no intro/outro). Confirm current behavior and log
   it in the report; it's a documented product gap (release-map §7), not QA scope.
5. **Desktop Share button** on a reel → opens the app's own ShareModal, NOT the native OS share
   sheet (a real prior regression). Mobile emulation → native sheet path still used.
6. **Collection share freeze:** attach card to a collection → create share link → change the
   reel's intro afterward → the existing link must keep the frozen state.
7. **Re-export carries the intro forward:** re-export a reel with an intro attached → new version
   still has the same `intro_card_id` (query the API or DB after).

**Evidence:** screenshot per criterion (use `saveEvidence` from `e2e/helpers/qa.js` or MCP
screenshots) + ffprobe output pasted for 1 and 3. Write a report in the RESULTS doc's format and
append it to `staging-verification-2026-08-10-RESULTS.md` as a "§4 egress follow-up" section.

**Failure protocol:** a FAIL here is a real deploy blocker. Do not band-aid in place — spawn the
Opus `expert` agent for root cause, then file a task and /dotask it (Opus worker) with the
expert's analysis in the kickoff. Only then continue the remaining checklist items.

**Cleanup:** when Part A is done, `bash scripts/task.sh down testsweep2` (keep the checkout) or
`nuke` if disk pressure.

---

## Part B — T6550: guard the poster-marker write (deploy-window 500)

**Task file:** [docs/plans/tasks/T6550-poster-marker-write-unguarded.md](../plans/tasks/T6550-poster-marker-write-unguarded.md)
(already on master; PLAN.md row: Impact 6, Complexity 1, Priority 6.0, TODO).

**Why now:** migrations do not auto-run on deploy, so EVERY deploy opens a window where profile
DBs are below head. In that window, dragging the thumbnail marker 500s (`no such column`) because
the WRITE at `app/services/poster.py:572` is a bare UPDATE while the READ at :553 is
column-guarded. This release ships v034-v042, making the window bigger than usual.

**Pipeline:** M-tier /dotask container worker, **`--model opus`** (no Architect; the implementor
decides the guarded-write semantics — the task file demands "must not silently swallow the
gesture", so the worker has a real design call: surface an explicit, actionable failure the
frontend can show, not a silent no-op and not a raw 500).

Kickoff must include (besides the standard template):
- Knowledge doc: `.claude/knowledge/backend-services.md` § "Migration-window column guard audit
  (T5970)" — the sanctioned guard is `column_exists()`, one PRAGMA per call; and § the structural
  guard test (`test_t6030_migration_window_structural_guard.py`) — **the fix must extend
  `POST_V023_COLUMNS` / the audited-head constants if applicable, and the structural test must
  stay green.**
- The task's second requirement: **sweep for other guarded-read/unguarded-write asymmetries**
  (grep every `column_exists` call, check its sibling write path), fix or file what's found.
- Relevant test set: the structural migration-window test + poster tests
  (`test_t6030_*`, poster/thumbnail-related backend tests) — ~10, curated, never the full suite.
- Standard rules: status-file contract, explicit `git add`, no push (supervisor pushes), Branch CI
  verdict mandatory before reporting ready.

---

## Part C — Backlog filing (no code this session)

File these so the noise stops being rediscovered; Sonnet, supervisor-side, ~15 min total:

1. **E2E suite hygiene task:** the e2e directory mixes real regression specs with per-task QA
   artifacts that rot (round-N evidence specs pinned to superseded UI, fixture-dependency specs
   that fail loudly outside their harness, real-account specs that hang 5 minutes when account
   data drifts). Proposal for the task file: (a) tag fixture-dependent specs with an explicit
   `test.skip` guard when their precondition is absent (the bug27p pattern — assert-loudly —
   applied everywhere); (b) prune/archive superseded round-N evidence specs; (c) a fast-fail
   guard: real-account specs assert `storage_status === 'active'` in `beforeAll` instead of
   timing out per-test. Include the failed-spec list from `C:\tmp\failed-spec-files.txt`.
2. **game_ref_counts drift rows:** dev Postgres has NO `game_ref_counts` row for games 2/3/5 of
   the imankh account while their per-profile `game_storage` rows are active (observed 2026-08-11
   during the repair). This is more evidence for the known ref-count-drift landmine (memory:
   "Game video ref_count drift" — root cause of ready-game/video-404; fix branch never deployed).
   Add the observation to that existing task/thread rather than filing a duplicate; if no open
   task exists, file one (backend, M).

## Part D — Deploy runbook (when the user says deploy)

Not code; paste into the deploy checklist:
1. Deploy backend+frontend (`deploy_production.sh` — does NOT migrate).
2. IMMEDIATELY run `POST /api/admin/migrate` (admin session) — this release carries profile_db
   v034-v042; most Intro Card / Overlay-text features 500 on a below-head profile. Confirm
   `errors: []` and spot-check `GET /api/admin/migration-status?user_id=<a real user>`.
3. T6550's fix (Part B) shrinks but does not eliminate the pre-migrate window — deploy at a quiet
   hour regardless.
4. Post-deploy: the user's own hands-on staging pass per
   [staging-verification-2026-08-10.md](staging-verification-2026-08-10.md) remains the DONE gate.

---

## Housekeeping for the implementing session

- Shared tree may still be on branch `fix/T6452-lint-debt-cleanup` (already merged via PR #256) —
  `git checkout` a fresh branch off origin/master for any new work; never commit to the shared
  tree's stale branch. `git fetch origin` first; local `master` cannot be checked out here (a
  worktree at `C:/work/land-master` owns it) — branch from `origin/master` directly.
- WAVE.md (`C:/work/tasks/WAVE.md`) is empty; maintain it per /dotask for Part B.
- Sweep containers: `reel-task-testsweep2` may be running (reuse for Part A, then down). The
  `testsweep`/`t6750` containers are already removed; `C:/work/tasks/{testsweep,testsweep2,t6750}`
  checkouts can be deleted whenever.
- Full sweep logs if needed: `C:\tmp\testsweep-e2e.log` (536-test run),
  `C:\tmp\testsweep-backend*.log`, `C:\tmp\failed-spec-files.txt` (57 failed spec files).
