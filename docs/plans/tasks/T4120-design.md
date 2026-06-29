# T4120 — Self-verifying /dotask containers: Architecture (Stage 2)

**Status:** Design — awaiting approval (do NOT implement past this gate)
**Branch:** `feature/T4120-self-verifying-containers` (from `feature/T4110-edit-reel-persistence-durability`)
**Type:** Infra/tooling + small backend seams + one E2E spec
**Task file:** [T4120-self-verifying-dotask-containers.md](T4120-self-verifying-dotask-containers.md)

> Goal: a /dotask worker runs ONE command — `bash scripts/dev-verify.sh e2e/<spec>` — and verifies
> end-to-end as a real user with NO supervisor/AI calls: auth → REAL local overlay render → export
> COMPLETE / forced durable-sync failure (retryable, never false-complete) → publish → reel in My
> Reels after reload, plus a simulated machine cycle that proves an un-synced edit reverts.

---

## 0. Verified ground truth (file:line)

| Fact | Ref |
|------|-----|
| `APP_ENV = os.getenv("APP_ENV","dev")` — single source for the prod gate | `src/backend/app/storage.py:65` |
| `R2_ENABLED` flag | `storage.py:68` |
| Overlay local renderer (ffmpeg, no GPU): `call_modal_overlay` → `_overlay_sync` when `not _modal_enabled` | `modal_client.py:1020-1036`; `local_processors.py:476` |
| `_modal_enabled` read at **import time** | `modal_client.py:327` |
| Overlay-auto raises (no local path) | `modal_client.py:1271` |
| Multi-clip raises (no local path) | `modal_client.py:825` |
| Framing-AI Real-ESRGAN needs `device='cuda'` | `local_processors.py:344` |
| Framing `X-Test-Mode` copy-without-render branch (runs CPU-only) | `framing.py:480` |
| Overlay `X-Test-Mode` branch | `overlay.py:2157-2216` |
| **Durable boundary** (T4110): COMPLETE gated on `sync_export_db_to_r2` | `overlay.py:1908-1923` |
| `_export_sync_failed_data` — retryable `sync_failed` WS event | `overlay.py:199-212` |
| `sync_export_db_to_r2` (returns bool) → calls the two explicit fns below | `export_helpers.py:333-377` |
| `sync_db_to_r2_explicit` (profile.sqlite → R2) | `database.py:1207-1237` |
| `sync_user_db_to_r2_explicit` (user.sqlite → R2) | `database.py:1240-1269` |
| Middleware durable 503 path → same two explicit fns | `db_sync.py:786,806,845,852`; `DURABLE_SYNC_FAILED_RESPONSE` `db_sync.py:77` |
| R2 pull (cold-machine restore) `sync_database_from_r2(user_id, db_path)` | `storage.py:904` |
| Local profile path `get_user_data_path_explicit(...)/profile.sqlite` | `database.py:1202,1219` |
| Version caches: `set_local_db_version`, `set_local_user_db_version` | `database.py` (profile + 1286) |
| `dev-login` gate pattern: `if APP_ENV not in ("dev","development","local"): 404` | `auth.py:897` |
| `MODAL_ENABLED=true` is baked into the container `.env` (copied by launcher) | `.env:15`; `scripts/task.sh:84` |
| `ffmpeg` (system) baked; `ffmpeg-python==0.2.0` in prod deps (baked) | `task.Dockerfile:27,60`; `requirements.prod.txt:26` |
| pytest/asyncio in **no** requirements file | `requirements.txt`, `requirements.prod.txt` |
| dev-verify health cap ~60s; uvicorn `--reload` | `dev-verify.sh:53-66`; `container-stack.sh:40` |
| Launcher env passthrough (`-e` flags) | `scripts/task.sh:108` |
| Seed spec (soft asserts, investigation-only) | `src/frontend/e2e/T4110-reedit-reel-persistence.spec.js` |
| `loginAsRealUser` via dev-login | `src/frontend/e2e/helpers/realAuth.js:25` |

**Headline already-satisfied facts:** the overlay local renderer exists, and ffmpeg + ffmpeg-python
are already in the image. Gap 1 is therefore **routing only** — flip `MODAL_ENABLED=false` for verify
runs; **no Dockerfile change** is needed for rendering.

---

## 1. Local-render verify mode — WHERE to force `MODAL_ENABLED=false`

**Decision: in `scripts/dev-verify.sh`, exported before it starts the backend — NOT in
`container-stack.sh`.**

```sh
# dev-verify.sh, near the top (after cd to repo root)
export MODAL_ENABLED="${MODAL_ENABLED:-false}"   # verify runs render locally (overridable for Gap-3 Modal)
```

Why dev-verify, not container-stack:
- `container-stack.sh` is also the **general interactive** stack (`scripts/task.sh stack <id>`). A worker
  doing normal dev may want Modal (if Gap-3 tokens are provisioned). Forcing `false` there changes the
  worker's general env and contradicts "do NOT change the worker's general env or prod."
- `dev-verify.sh` is the **verify-only** entry point and owns the verify stack lifecycle. Scoping the
  override here keeps it confined to verification.

**Mechanism (why the export wins):** `modal_client._modal_enabled` is read at import (`modal_client.py:327`)
from the process env. python-dotenv `load_dotenv()` does **not** override an already-set env var — the same
trick `container-stack.sh` uses for `DATABASE_URL` (`container-stack.sh:18,27-36`). Exporting
`MODAL_ENABLED=false` in `dev-verify.sh` before it spawns `container-stack.sh` → uvicorn inherits it →
`.env`'s `MODAL_ENABLED=true` is ignored for the verify backend only. Prod (Fly) never runs dev-verify.

**Idempotency hazard (must address):** `dev-verify.sh:44` reuses an already-running stack. If a worker
previously started the stack via plain `container-stack.sh` (Modal=true), reuse would silently render via
Modal and the headline would fail with no local render. Fix:
- Expose a **non-secret** boolean `modal_enabled` in `GET /api/health` (`routers/health.py`).
- `dev-verify.sh` probes it; if a reused stack's mode ≠ requested mode, it **restarts** the stack (or
  aborts with a clear message). Add `DEV_VERIFY_FRESH=1` to force a teardown+restart.

**Dockerfile:** no change for render (ffmpeg + ffmpeg-python already baked). (Test deps added separately — §5.)

**Acceptance:** a spec drives an overlay export, `_finalize_overlay_export` runs locally, a real
`final_*.mp4` lands in dev R2, COMPLETE fires.

---

## 2. Durability fault-injection — `FORCE_R2_SYNC_FAILURE` + machine-cycle sim (both prod-impossible)

### 2a. Where to inject the sync failure

**Decision: short-circuit the TWO lowest-level explicit sync fns —
`sync_db_to_r2_explicit` (`database.py:1207`) and `sync_user_db_to_r2_explicit` (`database.py:1240`) — at
the very top of each, returning `False` before any R2 call.**

```python
# database.py, first line of BOTH explicit sync fns (before the R2_ENABLED check)
if _force_r2_sync_failure():
    logger.warning(f"[TEST] FORCE_R2_SYNC_FAILURE active — short-circuiting sync for user={user_id}")
    return False
```

Why these two functions (the single choke point both durability paths funnel through):
- **Export COMPLETE gate** → `overlay.py:1908` `sync_export_db_to_r2` → `export_helpers.py:362,367` →
  these two. Forcing `False` makes `sync_export_db_to_r2` return `False` → `overlay.py:1921`
  `_export_sync_failed_data` → retryable `sync_failed` WS event, COMPLETE withheld. **Proves T4110.**
- **Middleware durable 503** → `db_sync._background_sync:786,806,845,852` → these two → `sync_status="failed"`
  → `DURABLE_SYNC_FAILED_RESPONSE` 503 (`db_sync.py:681`). **Same single seam proves the 503 path too.**

`return False` (never `raise`) exercises the **real** failure handling — `mark_sync_pending`,
`sync_status="failed"`, the retryable surfaces — exactly as a genuine R2 outage would, **without touching
R2** (we short-circuit before the upload). Placing the guard **before** the `if not R2_ENABLED: return True`
check makes it deterministic regardless of R2 config.

Rejected alternatives:
- Inject in `sync_export_db_to_r2` only → misses the middleware 503 path; less general.
- Inject in the middleware only → misses the export-COMPLETE gate.
- Raise instead of return → would hit `except` branches, not the designed failed-but-handled path.

### 2b. Static env vs runtime toggle (the spec needs force → clear → succeed in ONE process)

`FORCE_R2_SYNC_FAILURE` read from env is **import/process-static** — a spec can't clear it mid-run. The
reference spec must force-fail, then clear, then succeed in the **same** process. So:

**`_force_r2_sync_failure()` (new helper in `storage.py`, next to `APP_ENV`) checks, in order:**
1. `_test_seams_enabled()` gate (below) — if False, **always** return False (inert).
2. A process-global override set by the runtime toggle endpoint (`None` = unset).
3. Else the `FORCE_R2_SYNC_FAILURE` env var (`"1"/"true"/"yes"`).

**Runtime toggle endpoint** `POST /api/test/sync-fault {enabled: bool}` (new gated router, §2d) flips the
process-global. The spec drives: enable → export → assert `sync_failed` → disable → export → assert COMPLETE.

### 2c. Machine-cycle simulation (proves an un-synced edit reverts) — **without killing the process**

A Fly machine cycle loses exactly one thing: **local-disk SQLite that hasn't reached R2.** The only
machine-local state is `profile.sqlite`/`user.sqlite` + their in-memory version caches. So we reproduce a
cycle in-process by resetting precisely that state and re-pulling R2 — no process restart needed.

**Endpoint** `POST /api/test/simulate-machine-cycle` (gated router, §2d) does, for the current user/profile:
1. Clear version caches: `set_local_db_version(user_id, profile_id, None)`, `set_local_user_db_version(user_id, None)`.
2. Delete local `get_user_data_path_explicit(user_id, profile_id)/profile.sqlite` (and `user.sqlite`).
3. Re-pull the last durable R2 snapshot via `sync_database_from_r2(user_id, db_path)` (`storage.py:904`) —
   exactly what a cold machine does on session_init.

After a forced-failed edit (delta only in local SQLite, never synced), this drops the delta and restores
the R2 state → the edit is gone. The spec asserts the revert. **This is why no process kill is needed:**
the local DB files + caches are the *entire* machine-local surface; resetting them == cycling the machine.

### 2d. Prod-impossibility — three independent layers (answers the security requirement)

All test seams (`/api/test/sync-fault`, `/api/test/simulate-machine-cycle`, and `_force_r2_sync_failure`)
funnel through ONE gate, default-deny allowlist (stricter than the asked `!= production`, mirrors
dev-login `auth.py:897`):

```python
# storage.py
def _test_seams_enabled() -> bool:
    return APP_ENV not in ("production", "prod", "staging")   # only dev/development/local/test pass
```

1. **Compute-time gate.** `_force_r2_sync_failure()` ANDs `_test_seams_enabled()` first → even if
   `FORCE_R2_SYNC_FAILURE=1` leaks into the prod env, the guard returns `False` and the **real** sync runs.
2. **Router not mounted on prod.** `app/routers/test_seams.py` is `include_router`'d in `main.py` **only**
   when `_test_seams_enabled()` → on prod the routes don't exist → 404. (Same shape as test-login.)
3. **Per-handler re-check.** Each handler re-asserts and 404s if disabled — defense in depth even if (2) regresses.

**Unit tests (security — reviewer focus):** with `APP_ENV=production` and `FORCE_R2_SYNC_FAILURE=1`,
assert `sync_db_to_r2_explicit` still attempts a real sync (guard inert), the toggle/cycle routes 404, and
`_test_seams_enabled()` is False for `production`/`prod`/`staging`, True for `dev`/`development`/`local`/`test`.

---

## 3. Paths without a local renderer — verification matrix

**Decision: do NOT add new CPU fallbacks in T4120.** The kickoff risk rule — "local-render verification
must not alter the real render code path semantics" — plus scope (overlay-auto/multi-clip/framing-AI
fallbacks are large and touch production routing). The headline self-verify path uses **overlay**
(real local renderer, the T4110 bug class) + **framing via `X-Test-Mode`**. Modal-required paths are
documented and reachable only via the optional Gap-3 tokens.

| Export type | Entry | Local renderer? | Locally verifiable? | How |
|-------------|-------|-----------------|---------------------|-----|
| **Overlay** (highlight) | `render-overlay` / `call_modal_overlay` | ✅ `_overlay_sync` ffmpeg (`modal_client.py:1020`) | ✅ **Yes** | `MODAL_ENABLED=false` |
| **Framing** (crop/reframe, no upscale) | `framing.py` | ⚠️ `X-Test-Mode` copy branch (`framing.py:480`) | ✅ partial (copy, no real upscale) | `X-Test-Mode: true` header |
| Overlay-auto (brilliant-clip) | `call_modal_overlay_auto` (`modal_client.py:1271`) | ❌ raises | ❌ needs Modal | Gap-3 tokens |
| Multi-clip | `modal_client.py:825` | ❌ raises | ❌ needs Modal | Gap-3 tokens |
| Framing-AI (Real-ESRGAN upscale) | `_framing_sync` `device='cuda'` (`local_processors.py:344`) | ❌ CUDA only | ❌ needs Modal/GPU | document; Gap-3 |

CPU fallbacks for the ❌ rows are a documented **follow-up**, not this task.

---

## 4. Optional Modal-in-container (for the Modal-required paths only)

In `.devcontainer/task-bootstrap.sh`, when both tokens are present, write `~/.modal.toml` (chmod 600):

```sh
if [ -n "${MODAL_TOKEN_ID:-}" ] && [ -n "${MODAL_TOKEN_SECRET:-}" ]; then
  printf '[default]\ntoken_id = "%s"\ntoken_secret = "%s"\nactive = true\n' \
    "$MODAL_TOKEN_ID" "$MODAL_TOKEN_SECRET" > "$HOME/.modal.toml"
  chmod 600 "$HOME/.modal.toml"
fi
```

Tokens reach the container via `scripts/task.sh` docker run, conditionally appending
`-e MODAL_TOKEN_ID -e MODAL_TOKEN_SECRET` **only when set in the launcher env** (extend the `-e` list at
`scripts/task.sh:108`). **Off by default** (cost + network). **Never** baked into the image or committed —
env/secret only. The headline overlay path does NOT need this.

---

## 5. pytest in the image

Add `src/backend/requirements.test.txt`:

```
pytest==8.3.4
pytest-asyncio==0.25.3
pytest-mock==3.14.0
```
(pin to versions `run_tests.py` expects; confirm at implementation).

Install in `task.Dockerfile` right after the prod deps (`task.Dockerfile:59-60`):

```dockerfile
COPY src/backend/requirements.test.txt /tmp/requirements.test.txt
RUN pip install --no-cache-dir -r /tmp/requirements.test.txt && rm /tmp/requirements.test.txt
```

**Bake, not bootstrap** → instant + offline. Keep pytest **out** of `requirements.prod.txt` (Fly prod must
not ship test deps). Result: `run_tests.py` / pytest run in-container with no manual `pip install`.

---

## 6. Harness reliability (`dev-verify.sh` + `container-stack.sh`)

1. **Graceful shutdown + no reload for verify.** `container-stack.sh:40` → add `--timeout-graceful-shutdown 5`
   and gate `--reload` behind `STACK_RELOAD` (default on for interactive; `dev-verify.sh` exports
   `STACK_RELOAD=0`). `--reload` + orphaned Playwright WS is the documented shutdown-hang source.
2. **Configurable timeouts.** `dev-verify.sh:53` health cap → `DEV_VERIFY_TIMEOUT` (default raised, e.g.
   120s, for slow first ffmpeg render + R2 buffering). Per-spec Playwright timeout via `--timeout` / config.
3. **Orphan reaping.** Reference spec uses `test.afterEach`/`afterAll` to `context.close()` (close WS).
   `dev-verify.sh` adds a `trap`/post-run cleanup that pkills stray playwright/chromium node workers so no
   orphaned WS survives to hang a reused stack.

**Acceptance:** dev-verify on a render spec completes within the cap, emits `--reporter=line`, no stuck uvicorn.

---

## 7. Recipe + reference spec

**Recipe** (drive-app-as-user skill + a dev-verify README section) — the canonical no-AI path:
1. Seed the user if `dev-login` 404s: `scripts/copy_user_between_envs.py --from production --to dev`.
2. `bash scripts/dev-verify.sh e2e/<spec>` (auto `MODAL_ENABLED=false`; local ffmpeg render).
3. Durability specs drive `FORCE_R2_SYNC_FAILURE` via the runtime toggle endpoint (`/api/test/sync-fault`)
   from inside the spec — no env juggling, force→clear in one process.

**Reference spec** `src/frontend/e2e/T4120-self-verify-durability.spec.js` — seeded from the T4110 spec but
with **HARD** assertions (T4110 is soft/investigation-only). Single continuous process:

```
loginAsRealUser → open My Reels → re-edit a game-6 reel → reframe
POST /api/test/sync-fault {enabled:true}
export overlay  → assert WS terminal event has code 'sync_failed' & retryable; NO COMPLETE; no Move-to-My-Reels
POST /api/test/sync-fault {enabled:false}
export overlay  → assert COMPLETE + real final_*.mp4 → Move to My Reels (publish 200)
reload → assert the edited reel IS present in My Reels (no phantom card)
# machine-cycle revert leg:
make an edit with sync-fault ON (delta only local) → POST /api/test/simulate-machine-cycle
→ assert the un-synced edit is GONE (reverted to R2 state)
```

---

## Files to change (implementation preview — NOT done yet)

| File | Change |
|------|--------|
| `src/backend/app/storage.py` | `_test_seams_enabled()`, `_force_r2_sync_failure()` + process-override setter |
| `src/backend/app/database.py:1207,1240` | guard both explicit sync fns with `_force_r2_sync_failure()` |
| `src/backend/app/routers/test_seams.py` | **new** gated router: `/api/test/sync-fault`, `/api/test/simulate-machine-cycle` |
| `src/backend/app/main.py` | mount test_seams router only when `_test_seams_enabled()` |
| `src/backend/app/routers/health.py` | expose non-secret `modal_enabled` boolean |
| `src/backend/requirements.test.txt` | **new** pytest deps |
| `.devcontainer/task.Dockerfile` | install requirements.test.txt |
| `.devcontainer/task-bootstrap.sh` | optional `~/.modal.toml` from tokens |
| `.devcontainer/container-stack.sh` | `--timeout-graceful-shutdown 5`, `STACK_RELOAD` gate |
| `scripts/task.sh:108` | conditional `-e MODAL_TOKEN_ID/SECRET` passthrough |
| `scripts/dev-verify.sh` | export `MODAL_ENABLED=false`+`STACK_RELOAD=0`; `DEV_VERIFY_TIMEOUT`; health modal-mode probe; orphan reap |
| `src/frontend/e2e/T4120-self-verify-durability.spec.js` | **new** reference spec (hard asserts) |
| backend unit tests | prod-gating tests for every seam |
| docs (dev-verify README + drive-app-as-user skill) | recipe |

**Migration:** none (no schema change).

---

## Risks & open questions (for approval)

1. **Reused-stack Modal mode (idempotency).** Recommended: add `modal_enabled` to `/api/health` and have
   dev-verify restart a stack whose mode disagrees. Acceptable, or keep dev-verify always-fresh (slower)?
2. **Gating breadth.** I propose default-deny `_test_seams_enabled()` excluding `production`/`prod`/**`staging`**
   (stricter than the task's `!= production`, matching dev-login). Confirm staging should also be inert.
3. **No CPU fallbacks for overlay-auto/multi-clip/framing-AI** in T4120 (documented + Gap-3 tokens instead),
   to honor "don't alter render semantics." Confirm that's the right scope cut.
4. **Runtime toggle vs env for FORCE_R2_SYNC_FAILURE.** The spec needs force→clear→succeed in one process, so
   the seam is a process-global flipped by `/api/test/sync-fault` (env is the static default). Confirm a
   stateful test endpoint is acceptable (it is fully gated).
5. **Machine-cycle deletes local SQLite files.** It targets only the current dev user's per-user DBs and
   re-pulls from R2. Confirm comfort with a gated endpoint that removes local DB files (dev only).
6. **pytest pinning.** Versions above are placeholders; will pin to whatever `run_tests.py` needs.
```
