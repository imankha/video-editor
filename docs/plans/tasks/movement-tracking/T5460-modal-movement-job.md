# T5460: Modal Movement Job + Profile Persistence

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-19

## Problem

The tuned recipe (T5450's frozen `fusion_v1`) lives in a testbed. Productizing it means: a Modal function that runs the recipe over an uploaded game, a movement-profile artifact in R2, profile-DB tracking of profile status, a backend endpoint the frontend can read, and job recovery — all following the existing Modal conventions. See [EPIC.md](EPIC.md) for the artifact schema and design decision 5 (reuse existing Modal infra).

**BLOCKED until T5450 records "go".**

## Solution

New `analyze_movement` Modal function in the production app + `call_modal_movement` unified dispatch in `modal_client.py`, writing the msgpack movement profile to R2; profile_db migration adds profile tracking; `GET` endpoint serves the profile to Annotate. Trigger is admin/dev-only in this task (dogfood phase — user-facing opt-in is T5490).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` — new `analyze_movement` function (T4 GPU, generator yielding `{progress, phase, message}`; reuses `yolo_image` — `yolov8x.pt` already baked) + ported recipe code (classical signals + fusion decode; port from testbed, pin `fusion_v1.json` constants)
- `src/backend/app/services/modal_client.py` — `call_modal_movement(...)` unified fn: MODAL_ENABLED routing, `_resolve_modal_user_id` prefix, retry via `classify_modal_error`, `modal_call_id` capture for recovery
- `src/backend/app/services/local_processors.py` — local engine (`_movement_sync`): the classical+fusion recipe is CPU-viable minus YOLO; run detection features only if CUDA, else degrade to classical-only recipe variant (LOUDLY logged, per no-silent-fallback rule — the profile records which recipe generated it)
- `src/backend/app/database.py` — profile_db schema: `movement_profiles` table (game_id, status pending|running|complete|failed, r2_key, recipe_version, generated_at, error)
- `src/backend/app/migrations/profile_db/v0XX_movement_profiles.py` — Migration agent writes this
- `src/backend/app/routers/` — new or existing games router: `POST /api/games/{game_id}/movement` (admin/dev trigger) + `GET /api/games/{game_id}/movement` (serves profile msgpack→JSON; 404 if none — no fallback synthesis)
- Job status plumbing: follow the export_jobs `modal_call_id` recovery pattern (`exports.py`) — decide during design whether movement jobs reuse `export_jobs` or the new table carries its own call id

### Related Tasks
- Depends on: T5450 (go verdict + frozen recipe). Reuse: T5450's `fusion_v1.json`, T5440's signal implementations (ported, not imported from experiments/)
- Blocks: T5470 (layer reads the GET endpoint), T5490 (opt-in triggers this job)

### Technical Notes
- **Artifact**: msgpack per EPIC.md schema, R2 key alongside the game's storage (exact scheme decided at design time against `game_storage` conventions — see `.claude/knowledge/persistence-sync.md` + games source key scheme `games/{blake3}.mp4` note in project memory). Register a storage ref so account deletion/expiry sweeps clean it up.
- **Port, don't import**: production code must not import from `experiments/` (deploy image doesn't include it). Port signal + decode code into `modal_functions/` with a parity test: same input clip → same scores as the testbed (tolerance), so testbed and prod can't drift silently (lesson from the 4x crop-interpolation duplication landmine).
- **Modal conventions** (`.claude/knowledge/modal-gpu.md`): lazy `modal.Function.from_name` lookup; generator progress consumed in-process; deploys are MANUAL — after editing `video_processing.py`, ask the user before `modal deploy`; new function name must be deployed before dispatch or `RuntimeError` at lookup.
- **Long input**: a 90-min game is far larger than any clip we currently process on Modal. Stream via presigned URL + ffmpeg/PyAV sampled decode (2–5 fps at ~480 px) — do NOT download-then-decode-full-res. Timeout ≥ 2700 s; verify the ≤ 20 min wall-clock gate with telemetry (`[MOVEMENT_COST]` log line: GPU-s, wall-clock, $ estimate).
- **Failure is non-destructive**: a failed/errored job marks `failed` with error text; game remains fully usable. Never block upload processing on movement analysis; run as a follow-on job.
- **Persistence rules**: profile write is backend-only (job completion), not a frontend gesture — it's derived data, single write path, GET is read-only. No reactive frontend persistence anywhere.
- **Tests**: `test_mode=True` seam like `call_modal_framing_ai` (mock profile without GPU); backend tests for endpoint auth/404/status transitions; parity test above.

## Implementation

### Steps
1. [ ] Design pass: R2 key scheme, table shape, jobs-table reuse decision (Architect — schema change ⇒ L-tier full workflow)
2. [ ] Port recipe into `modal_functions/`, parity test vs testbed
3. [ ] `analyze_movement` Modal function + `call_modal_movement` dispatch + local engine
4. [ ] profile_db table + Migration agent file; `_SCHEMA_DDL`-equivalent fresh-DB path
5. [ ] Trigger + GET endpoints; storage-ref registration; recovery wiring
6. [ ] Deploy Modal app (ask user); run on 2 real staging games; verify cost gate with telemetry
7. [ ] Knowledge docs: update `modal-gpu.md` (new function row, entry point) + `backend-services.md`

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] Admin trigger produces a movement profile for a real uploaded game on staging, end-to-end
- [ ] GET endpoint serves it; 404 (no synthesis) when absent; profile records recipe_version
- [ ] Parity test: prod recipe matches testbed scores on a reference clip
- [ ] Measured cost ≤ $0.50 and wall-clock ≤ 20 min for a 90-min game (telemetry evidence)
- [ ] Recovery: kill backend mid-job → job resolvable via modal_call_id pattern, no orphaned pending
- [ ] Migration file merged + run on dev/staging; knowledge docs updated
