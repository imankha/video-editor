# T4230: Project Write-Path Corruption — Rescale NULLs Crop Data + Rename Reverts Aspect Ratio

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) items A4 + A5)

Two independent data-corruption bugs in the project write paths. Bundled because they share files and both violate "send/write only what the gesture changed".

## Bug 1: Keyframe-rescale catch-all writes NULL over user crop data

**Exposure: runs whenever a clip's boundaries version changes (re-trim in annotate → refresh in framing) — retention-critical framing data.**

`src/backend/app/routers/projects.py:1275-1276` (and twin at `:1310-1311`):

```python
except (json.JSONDecodeError, TypeError, Exception):
    new_crop_data = None  # Corrupt data, reset
```

`Exception` in the tuple makes the specific types decorative — ANY error in the rescale math (a `KeyError` from an unexpected keyframe shape, anything) is treated as "corrupt data" and the UPDATE at `:1314-1321` **writes NULL over the user's crop keyframes** (twin path for segments). A transient code bug destroys user data permanently.

**Fix:** On decode/rescale failure: log at ERROR with clip id + exception, **skip the update for that clip entirely** (keep existing `crop_data`/`segments_data`, do not bump its `raw_clip_version`), and continue the loop. Failing visibly and leaving data intact beats "resetting". Narrow the except to the errors decode can actually raise; let real code bugs propagate to the endpoint error handler.

Also note (do NOT fix here, just leave a `# T-audit C7` comment): `:1256` hardcodes `framerate = 30` — tracked separately as audit item C7.

## Bug 2: Rename PUT carries a stale aspect_ratio and skips crop re-fit

**Exposure: rename is a common gesture; the damage renders every clip's crop wrong shape at export.**

Sequence: user changes ratio 9:16→16:9 in Framing (the T3910 path `POST /clips/projects/{id}/aspect-ratio` re-fits every clip's crop keyframes and writes `projects.aspect_ratio = '16:9'`) → goes Home → renames the reel before the projects list refetches. `renameProject` (`src/frontend/src/stores/projectsStore.js:224-227`) sends `{name, aspect_ratio: project.aspect_ratio}` from the **stale cached list** → `PUT /projects/{id}` (`src/backend/app/routers/projects.py:830-832`) blindly writes `aspect_ratio = '9:16'` back — while every crop keyframe is still 16:9-shaped. Export now renders wrong-shaped crops.

`projects.aspect_ratio` must have ONE writer: the aspect-ratio endpoint that also re-fits crops.

**Fix:**
1. Backend: in `update_project`, only update `name`. Ignore (or reject with 422 if present) `aspect_ratio` — check `ProjectCreate` model usage first; if other callers legitimately set aspect_ratio through this PUT, grep for them (`grep -rn "projects/\${" src/frontend/src` + backend tests) — the audit found none, but verify.
2. Frontend: `renameProject` sends `{name}` only.
3. Keep the `auto_project_id` clearing (`:836-838`) — that's intentional rename behavior (freezes the user-chosen name; see memory "Explicit names after archive").

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/projects.py` — rescale loop (~:1230-1324), `update_project` (:820-842), `ProjectCreate` model (top of file)
- `src/frontend/src/stores/projectsStore.js` — `renameProject`
- Backend tests for projects; frontend store tests

### Technical Notes
- Bug 1 test setup: the rescale path runs inside the boundaries-version refresh — find its endpoint/trigger by reading up from `:1230` to the function def, and write the test against that entry point with (a) valid crop data + a forced rescale error (e.g., keyframe missing `frame` key), asserting crop_data is UNCHANGED after; (b) genuinely undecodable bytes, same assertion.
- Related memory: "No fallbacks, correct data" — this task is that rule, enforced.

## Implementation

### Steps
1. [ ] Bug 1 test first (both cases above) → fix → green.
2. [ ] Bug 2 test first: PUT with stale aspect_ratio after a ratio change; assert `projects.aspect_ratio` unchanged by rename → fix backend + frontend → green.
3. [ ] `python -c "from app.main import app"`; backend + frontend unit tests.

## Acceptance Criteria

- [ ] No code path writes NULL over existing crop/segments data on error; failures are logged and skipped
- [ ] `PUT /projects/{id}` cannot change aspect_ratio; rename payload is `{name}` only
- [ ] `projects.aspect_ratio` has exactly one writer (the re-fit endpoint)
- [ ] Reproducing tests for both bugs pass and would fail on old code
