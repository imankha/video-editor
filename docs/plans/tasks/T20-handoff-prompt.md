# T20 Handoff Prompt

Copy everything below the line into a new Claude Code session.

---

Implement T20: E2E Test Reliability — Mock Export Mode.

Read the full task file at `docs/plans/tasks/T20-e2e-test-reliability.md` first. It contains detailed root cause analysis, code paths, and the implementation plan. Here's the summary:

## Goal

Get ALL E2E tests passing (regression @smoke, @full, and full-workflow) by mocking the framing export so tests don't wait 10+ minutes for Real-ESRGAN GPU processing. Currently 1 test fails and 8 are skipped because of it.

## Context

- `MODAL_ENABLED=false` in `.env` — framing export runs local Real-ESRGAN (not cloud Modal)
- The framing export applies Real-ESRGAN to **every frame** (~2700 frames for 1.5-min test video), taking 10+ minutes
- After export completes, the working video isn't detected (`has_working_video=false`) due to a sync failure — but that's a separate bug (T248), not your problem
- The `export_mode` flag ("fast" vs "quality") only affects FFmpeg encoding, NOT the AI upscaling — there's no way to skip Real-ESRGAN currently

## What to do

### 1. Create a mock export mode in the backend

In `src/backend/app/routers/export/framing.py`, the `render_project` endpoint processes clips through Real-ESRGAN. Add a mock/test mode that:

- Is triggered by an `X-Test-Mode: true` header (or similar mechanism — the E2E tests already set custom headers via `page.setExtraHTTPHeaders`)
- Skips the Real-ESRGAN/AI upscaling entirely
- Instead, generates a simple video using FFmpeg (crop + resize only, no AI), OR copies a pre-canned fixture video
- Still executes the **real DB write path** (lines 785-820): inserts `working_videos` record, updates `projects.working_video_id`, commits, sends WebSocket complete
- This is critical: the DB write path must be real so downstream tests that check `has_working_video` work correctly

The simplest approach: when test mode is detected, use FFmpeg to do a basic crop+resize of the source video (no Real-ESRGAN), upload to R2, then proceed with the normal DB write. This should complete in seconds.

### 2. Wire up the E2E tests to use mock mode

In `src/frontend/e2e/regression-tests.spec.js`:
- The `setupTestUserContext()` function already sets `X-User-ID` header. Add the test mode header there (or in `page.setExtraHTTPHeaders`)
- Make sure `page.route()` for R2 requests still strips the test header (like it strips X-User-ID)

### 3. Fix the mode indicator assertion

In `regression-tests.spec.js` around line 2331-2333, the test looks for "Frame Video" or "Add Overlay" buttons but doesn't handle "Exporting..." state. Add it:

```javascript
const exportingButton = page.locator('button:has-text("Exporting")').first();
const modeIndicator = frameVideoButton.or(addOverlayButton).or(exportingButton);
```

### 4. Fix "Create project from clips" (full-workflow.spec.js:316)

The `request.post()` to `POST /api/projects` fails. The request body is correct (`name` + `aspect_ratio`). The likely cause is that the Playwright `request` fixture bypasses page middleware, so the user's SQLite DB may not be initialized. Add response logging (`console.log(createResponse.status(), await createResponse.text())`) to see what the API returns, then fix accordingly.

### 5. Verify

Run the full test suites and make sure everything passes:

```bash
cd src/frontend && npx playwright test e2e/regression-tests.spec.js
cd src/frontend && npx playwright test e2e/full-workflow.spec.js
```

Both dev servers must be running first:
```bash
cd src/frontend && npm run dev          # port 5173
cd src/backend && uvicorn app.main:app --reload  # port 8000
```

## Key files

| File | What's there |
|------|-------------|
| `src/backend/app/routers/export/framing.py` | Framing export endpoint — add mock mode here |
| `src/backend/app/services/local_processors.py` | `local_framing()` — current Real-ESRGAN path |
| `src/backend/app/services/modal_client.py:374` | Routes to local when Modal disabled |
| `src/frontend/e2e/regression-tests.spec.js` | Main E2E tests — export test at line 1449, mode indicator at line 2331 |
| `src/frontend/e2e/full-workflow.spec.js` | Project creation test at line 316 |
| `src/backend/app/routers/projects.py:279` | `has_working_video` SQL query |

## Rules

- Read `CLAUDE.md` at the project root for coding standards and workflow rules
- Do NOT modify the Real-ESRGAN pipeline or local_processors.py — mock mode should be a clean bypass in the export endpoint
- The mock must still go through the real DB write path (insert working_video, update project, commit)
- Do NOT add print statements in committed backend code (use logger)
- After implementation, run both test suites and fix any failures iteratively until all pass
- Create a branch: `git checkout -b feature/T20-e2e-mock-export`
- Commit when tests pass with co-author line
- Update task status to TESTING in `docs/plans/PLAN.md`
