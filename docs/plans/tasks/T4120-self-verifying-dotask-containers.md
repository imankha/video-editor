# T4120: Self-verifying /dotask containers — full E2E export/render + durability, zero extra AI calls

**Status:** TODO
**Type:** Infra / developer-tooling (the /dotask + dev-verify harness)
**Origin:** T4110 retro. The worker could NOT exercise the real export-durability path in-container
(Modal unauthenticated → render never ran; durability needs a machine cycle; pytest missing;
`dev-verify.sh` timed out and uvicorn `--reload` shutdown hung). Verification fell back to unit
tests + endpoint smoke. We want a worker to drive the WHOLE path — authenticated user → real
render → export complete / durable-sync failure → publish → My Reels — and assert the outcome,
all from inside the container with no supervisor/AI round-trips.

## Goal

A /dotask container worker can run ONE command (e.g. `bash scripts/dev-verify.sh e2e/<spec>`) and
verify, end to end, against the running app as a real user:
1. **Auth** — dev-login as a real account (already works; lock it in).
2. **Real render** — a true overlay (and framing) export that produces a real `.mp4`, WITHOUT
   cloud Modal credentials (local ffmpeg path) — so finalize actually runs.
3. **Durability** — force an R2 sync failure on demand to prove "sync-then-announce" (export emits
   retryable `sync_failed` / 503, never a false complete) AND a stale-restore/"machine cycle"
   simulation to prove a lost write reverts — in a single continuous process.
4. **Publish → My Reels** — Move-to-My-Reels persists and the reel appears after reload.

No additional AI calls: the capability must be deterministic config/seams + a documented recipe.

## Background (verified file refs)

- `MODAL_ENABLED` default is `"false"` in code (`src/backend/app/services/modal_client.py:327`) but
  the container env sets it `true`, and the container has no `~/.modal.toml` / `MODAL_TOKEN_ID`.
  `_get_render_overlay_fn()` then raises `RuntimeError: Modal render_overlay not available`
  (`modal_client.py:359-373`).
- **Overlay HAS a local fallback:** `call_modal_overlay()` → `if not _modal_enabled: _run_in_subprocess(_overlay_sync, ...)`
  (`modal_client.py:986,1020-1036`); `_overlay_sync` (`src/backend/app/services/local_processors.py:476-547`)
  renders via `_process_frames_to_ffmpeg` — **ffmpeg only, no GPU**. So overlay export runs locally
  when `MODAL_ENABLED=false`.
- **No local fallback** for `call_modal_overlay_auto` (auto-export / brilliant-clip path,
  `modal_client.py:1200,1271` raises) or multi-clip (`modal_client.py:825-826` raises).
- **Framing AI local path needs CUDA:** `_framing_sync`/Real-ESRGAN `device='cuda'`
  (`local_processors.py:344,550`) → won't run on a CPU container. Framing has an `X-Test-Mode`
  copy-without-render branch (`framing.py:480`, `overlay.py` test-mode branch) that does run.
- **Durability seams:** `sync_export_db_to_r2` (`src/backend/app/services/export_helpers.py:333-377`,
  now returns bool after T4110), `sync_db_to_r2_explicit` (`app/database.py`), `_background_sync` /
  `durable_sync` (`app/middleware/db_sync.py`). **No fault-injection toggle exists** to force a
  sync failure; `.sync_pending` is only set after a real failure.
- **Auth works in-container:** `/api/auth/dev-login` gated to non-prod (`app/routers/auth.py:884-921`),
  Postgres reached via `host.docker.internal` rewrite (`.devcontainer/container-stack.sh`), seed a
  real user with `scripts/copy_user_between_envs.py --from production --to dev`. `e2e/helpers/realAuth.js`
  + drive-app-as-user skill carry the cookie. (Confirm realAuth.js is committed.)
- **pytest/pytest-asyncio are in NO requirements file** (`src/backend/requirements.txt`,
  `requirements.prod.txt`, `pyproject.toml`); the task image bakes only `requirements.prod.txt`
  (`.devcontainer/task.Dockerfile`). `run_tests.py` exists but its deps aren't installed in-container.
- **Harness:** `scripts/dev-verify.sh` health-wait cap ~60s; uvicorn runs with `--reload`
  (`container-stack.sh`) whose graceful shutdown can hang on an orphaned Playwright WebSocket; slow
  first render/R2 buffering blows the timeout.

## Capability gaps & proposed fixes

### Gap 1 — Local render mode for verification (CRITICAL, unblocks the headline)
**Missing:** a container default that renders WITHOUT Modal creds.
**Fix:** Make verification runs use `MODAL_ENABLED=false` so overlay → local ffmpeg (`_overlay_sync`).
Decide where: set it in `.devcontainer/container-stack.sh` for the verify stack (not the worker's
general env), or have `dev-verify.sh` export `MODAL_ENABLED=false` before starting the backend.
Ensure `ffmpeg` + the `ffmpeg-python` lib are present in the task image (`task.Dockerfile`).
**Acceptance:** a Playwright spec drives overlay export of a real reel and a real `final_*.mp4`
lands in (dev) R2; `_finalize_overlay_export` runs; COMPLETE fires.

### Gap 2 — Paths with no local fallback (overlay-auto, multi-clip, framing-AI)
**Missing:** auto-export/brilliant-clip and multi-clip raise without Modal; framing-AI needs CUDA.
**Fix (choose, document the matrix):**
 - (a) Add a CPU/local fallback for `call_modal_overlay_auto` and multi-clip (mirror the
   `_overlay_sync` pattern) so those export types are verifiable locally; for framing-AI, allow a
   no-upscale/ffmpeg-scale fallback when no CUDA, OR
 - (b) Provision real Modal creds in-container (see Gap 3) for these specific paths.
Document which export types are verifiable locally vs require Modal.

### Gap 3 — Optional real-Modal in container (for the paths Gap 2 can't do locally)
**Missing:** Modal token provisioning + (it works only against deployed Modal functions).
**Fix:** In `.devcontainer/task-bootstrap.sh`, if `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` are present,
write `~/.modal.toml` (chmod 600) so `modal.Function.from_name` authenticates; pass the tokens via
the /dotask launcher env (`scripts/task.sh`). Keep OFF by default (cost + network); enable per-task.
**Security:** tokens via env/secret only — never baked into the image or committed.

### Gap 4 — Durability fault-injection seam (CRITICAL for the actual T4110 class of bug)
**Missing:** a deterministic way to force an R2 sync failure and to simulate a machine cycle.
**Fix:**
 - Add `FORCE_R2_SYNC_FAILURE` (env, dev/test-gated): when set, `sync_db_to_r2_explicit` /
   `sync_export_db_to_r2` return failure WITHOUT touching real R2 → lets a single request prove
   "render OK but sync failed → retryable `sync_failed` WS event / 503", and that the COMPLETE gate
   holds (T4110). Gate behind `APP_ENV != production`.
 - Add a "machine-cycle" sim: a hook to drop the unsynced local SQLite delta and re-pull the R2
   snapshot (the revert side), so a spec can assert the edit reverts when sync was skipped. Could be
   an admin/test-only endpoint or a `dev-verify` step that re-runs session_init against R2.
**Acceptance:** a spec can, in one process, (i) force a sync failure and see `sync_failed`+Retry,
and (ii) simulate a cycle and assert the un-synced edit is gone.

### Gap 5 — Test deps in the container image
**Missing:** pytest, pytest-asyncio (+ pytest-mock) — not in any requirements file.
**Fix:** add a `src/backend/requirements.test.txt` (or a `[test]` extra) and install it in the task
image (`task.Dockerfile`) or in `task-bootstrap.sh`. Then `run_tests.py` / pytest run in-container.
**Acceptance:** `cd src/backend && .venv/Scripts/python.exe run_tests.py` (container equivalent) runs
without a manual `pip install`.

### Gap 6 — Harness reliability (`dev-verify.sh`)
**Missing:** robustness for slow first render + clean shutdown.
**Fix:**
 - Add `--timeout-graceful-shutdown 5` to the uvicorn invocation (`container-stack.sh`); consider
   dropping `--reload` for verify stacks (reloads + orphaned WS are the hang source).
 - Make the health-wait + per-spec timeout configurable (env, e.g. `DEV_VERIFY_TIMEOUT`); raise the
   default for render specs (real ffmpeg render + R2 buffering is slow).
 - Ensure Playwright WS/connections are closed in spec teardown; `dev-verify.sh` should reap orphans.
**Acceptance:** `dev-verify.sh` on a render spec completes and emits `--reporter=line` within the cap;
no stuck uvicorn after the run.

### Gap 7 — Recipe + docs so a worker self-verifies with no AI calls
**Missing:** a single documented path.
**Fix:** update the drive-app-as-user skill + a `dev-verify` README section with the canonical recipe:
seed user (if dev-login 404s) → `MODAL_ENABLED=false` → `dev-verify.sh e2e/<spec>` → for durability
specs set `FORCE_R2_SYNC_FAILURE`. Add a reference E2E spec that drives edit→export→(force sync
fail)→assert retryable→(clear flag)→export→publish→reload→assert in My Reels. Reuse/keep
`e2e/T4110-reedit-reel-persistence.spec.js` as the seed.

## Acceptance criteria (the whole point)
A worker, with no supervisor/AI calls, can run a single command that:
- logs in as a real account (dev-login),
- performs a REAL overlay export (local ffmpeg) that writes a real `final_*.mp4`,
- proves durable-sync failure surfaces as retryable `sync_failed`/503 (via `FORCE_R2_SYNC_FAILURE`)
  and never a false "complete",
- proves a simulated machine cycle reverts an un-synced edit,
- completes a successful export + Move-to-My-Reels and asserts the reel appears after reload,
- and runs backend pytest without a manual install.
Document the export-type verification matrix (which run locally vs need Modal).

## Classification
**Stack Layers:** Infra/Tooling + Backend (render routing, fault-injection seams, test deps) + minor Frontend (spec/teardown)
**Files Affected:** ~8-12  |  **LOC:** ~200-400 (mostly config/scripts + small seams)  |  **Test Scope:** Backend (seam unit tests) + Frontend E2E (the reference spec)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes | Map render routing + sync seams + container build |
| Architect | Yes | Fault-injection design + local-render-mode policy (prod-gated) |
| Tester | Yes | Reference E2E spec + seam unit tests |
| Reviewer | Yes | Test-only seams must be strictly prod-gated (security) |
| Migration | No | No schema change |

## Key risks / rules
- **Strictly gate every test seam behind `APP_ENV != production`.** `FORCE_R2_SYNC_FAILURE`, machine-
  cycle sim, and dev-login must be impossible to trigger on prod.
- Modal tokens via env/secret only; never committed or baked into the image.
- Local-render verification must not alter the real render code path semantics (only routing/availability).
- Keep `dev-verify.sh` idempotent (reuse a running stack).

## Relevant files
- `src/backend/app/services/modal_client.py` (`modal_enabled` 327; `_get_render_overlay_fn` 359; `call_modal_overlay` 986/1020; `call_modal_overlay_auto` 1200/1271; multi-clip 825)
- `src/backend/app/services/local_processors.py` (`_overlay_sync` 476; `_framing_sync` 550; CUDA 344)
- `src/backend/app/services/export_helpers.py` (`sync_export_db_to_r2` 333)
- `src/backend/app/database.py` (`sync_db_to_r2_explicit`), `src/backend/app/middleware/db_sync.py` (`durable_sync`, `_background_sync`)
- `src/backend/app/routers/auth.py` (`dev-login` 884), `e2e/helpers/realAuth.js`, `scripts/copy_user_between_envs.py`
- `.devcontainer/task.Dockerfile`, `.devcontainer/container-stack.sh`, `.devcontainer/task-bootstrap.sh`, `scripts/task.sh`, `scripts/dev-verify.sh`
- `src/backend/requirements.txt` / `requirements.prod.txt` (no pytest), `src/backend/run_tests.py`
- `e2e/T4110-reedit-reel-persistence.spec.js` (seed for the reference spec)
