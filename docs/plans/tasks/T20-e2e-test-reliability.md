# T20: E2E Test Reliability — Mock Export Mode

## Status: TODO

## Problem Statement

The E2E @full test suite is blocked by a single failing test ("Framing: export creates working video") which causes **8 cascading skips**. The root cause is that the framing export runs **local Real-ESRGAN AI upscaling on every frame** (~2700 frames for a 1.5-min test video), taking ~10+ minutes, and then fails to persist the working video (sync failure).

Running real GPU processing in E2E tests is fundamentally wrong for iteration speed. We need a mock export mode that returns pre-canned videos instantly, so we can validate the full test suite without waiting 10+ minutes per run.

## Decision: Mock Export Strategy

**Do not run real video processing in E2E tests.** Instead:
1. Create a mock/test mode for the framing export endpoint that returns a pre-canned working video
2. Get all E2E tests passing with mocks first
3. Real export pipeline bugs (sync failure, etc.) tracked separately in T248

## Current Test Results (Feb 19, 2026)

| Suite | Pass | Fail | Skip | Notes |
|-------|------|------|------|-------|
| Regression @smoke | 6/6 | 0 | 0 | All passing |
| Regression @full | 1/10 | 1 | 8 | "export creates working video" fails → cascading skips |
| Full workflow | 15/16 | 0 | 1 | "Create project from clips" — needs investigation |

## Root Cause Analysis

### Why the export test fails

1. **Framing export uses Real-ESRGAN on EVERY frame** regardless of `export_mode`. The "fast" vs "quality" setting only affects FFmpeg encoding (single-pass vs 2-pass), NOT the AI upscaling step. For 1.5 min @ 30fps = ~2700 frames × Real-ESRGAN = ~10+ minutes on local GPU.

2. **After export completes, `has_working_video` is false.** The WebSocket reports `{progress: 100, status: complete}`, but `GET /api/projects` shows no project with `has_working_video=true`. Screenshot shows **"Sync failed — click to retry"** and **"Loading working video..."**. This is a real backend bug tracked in T248.

### Key code paths

**Frontend export trigger** (`ExportButtonContainer.jsx`):
```javascript
export const EXPORT_CONFIG = {
  targetFps: 30,
  exportMode: 'fast',  // Only affects FFmpeg, NOT AI upscaling
};
// Sends POST /api/export/render with {project_id, export_id, export_mode, target_fps}
```

**Backend routing** (`modal_client.py:374`):
```python
if not _modal_enabled:  # MODAL_ENABLED=false in .env
    from app.services.local_processors import local_framing
    return await local_framing(...)  # Uses Real-ESRGAN locally
```

**Local processor** (`local_processors.py:209`):
```python
upscaler = AIVideoUpscaler(device='cuda', export_mode=export_mode, ...)
result = await asyncio.to_thread(upscaler.process_video_with_upscale, ...)
# Processes ALL 2700 frames through Real-ESRGAN, then uploads to R2
```

**Post-export DB write** (`framing.py:785-820`):
```python
# Insert working_videos record
# UPDATE projects SET working_video_id = ?
# conn.commit()
# → THEN send WebSocket complete
```

**has_working_video query** (`projects.py:279`):
```sql
CASE WHEN wv.id IS NOT NULL THEN 1 ELSE 0 END as has_working_video
-- Joins working_videos via projects.working_video_id
```

### Why 8 tests are skipped

The @full test suite uses `test.describe.serial()` — tests run in order and later tests depend on earlier ones having a working video. When "export creates working video" fails, everything after it is skipped:
- Overlay: video loads after framing export
- Overlay: highlight region initializes
- Framing: video auto-loads when opening existing project
- Framing: keyframe data persists after reload
- Framing: export progress advances properly
- Framing: per-clip edits persist after switching clips and reloading
- Full Pipeline: Annotate → Framing → Overlay → Final Export
- Framing: open automatically created project

## Implementation Plan

### Step 1: Create a pre-canned test working video

Generate a short (5-10 second) 810x1440 MP4 file that can serve as a mock framing export output. Store it in `src/frontend/e2e/fixtures/` or similar test data directory.

### Step 2: Mock the framing export in E2E tests

Options (choose the cleanest):

**Option A: Backend test mode endpoint**
- Add a `?mock=true` query param or `X-Test-Mode` header to `POST /api/export/render`
- When detected, skip Real-ESRGAN and instead: copy the pre-canned video to R2, insert working_video record, set working_video_id on project, return success immediately
- Pro: Tests the full DB write path. Con: Requires backend change.

**Option B: Playwright route interception**
- Use `page.route()` to intercept the export API call
- Return a mock response and directly insert the working video via API calls
- Pro: No backend changes. Con: Skips the DB write path entirely (which is where the real bug is).

**Option C: Backend E2E test helper endpoint**
- Add a dedicated `POST /api/test/create-working-video` endpoint (only available when `ENV=test` or similar)
- E2E test calls this instead of triggering the real export
- Pro: Clean separation. Con: New endpoint.

**Recommendation: Option A** — it tests the real DB write path (working_video_id, export_jobs) while skipping only the GPU processing. If the mock export works but real export doesn't, that isolates the bug to the Real-ESRGAN/R2 pipeline.

### Step 3: Fix the mode indicator assertion

In `regression-tests.spec.js:2331-2333`, add `"Exporting..."` as a valid mode indicator:
```javascript
const exportingButton = page.locator('button:has-text("Exporting")').first();
const modeIndicator = frameVideoButton.or(addOverlayButton).or(exportingButton);
```

Also update the subsequent assertion (line 2343) to include the exporting state.

### Step 4: Fix "Create project from clips" (full-workflow.spec.js:316)

The `request.post()` fixture bypasses the page context. The test sends correct fields (`name`, `aspect_ratio`). Most likely cause: the user's SQLite DB isn't initialized when using the `request` fixture directly (no page middleware to create it).

Investigation: Add response status/body logging to the test, then fix based on what the API actually returns.

### Step 5: Verify all tests pass

Run full suite 3x to confirm no flakiness:
```bash
cd src/frontend && npx playwright test e2e/regression-tests.spec.js
cd src/frontend && npx playwright test e2e/full-workflow.spec.js
```

## Test Video Details

- **Path**: `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4`
- **Duration**: ~1.5 minutes
- **FPS**: 30 (2700 total frames)
- **Used by**: All @full tests via `ensureProjectsExist()` / `ensureFramingMode()`

## Files to Modify

- `src/backend/app/routers/export/framing.py` — Add mock export mode
- `src/frontend/e2e/regression-tests.spec.js` — Use mock export, fix mode indicator
- `src/frontend/e2e/full-workflow.spec.js` — Fix project creation test
- New: pre-canned test video fixture file

## Classification

**Stack Layers:** Frontend (E2E tests) + Backend (mock export path)
**Files Affected:** ~4 files
**LOC Estimate:** ~50-80 lines
**Test Scope:** Frontend E2E

## Success Metrics

- All 6 @smoke tests pass
- All 10 @full tests pass (no skips)
- All 16 full-workflow tests pass
- Each test run completes in < 3 minutes (no 10-min GPU waits)
- 3 consecutive clean runs with no flakiness
