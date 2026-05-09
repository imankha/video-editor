# T2680: Remove Video Link Import Feature

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Created:** 2026-05-08
**Updated:** 2026-05-08

## Problem

The Video Link Import feature (T2600-T2635) allows users to paste a Veo or Trace URL and our server pulls the video directly. Legal analysis determined this creates **high liability** that must be eliminated before public launch:

1. **Veo ToS violation** (Section 7.3): Explicitly prohibits downloading/using material "on websites other than the Veo Platforms." Our feature is almost surgically prohibited by this clause.

2. **Trace ToS violation**: Prohibits "unauthorized access to the Service" and building "a competitive service or product."

3. **CFAA risk (Computer Fraud and Abuse Act)**: Both platforms' content is behind authentication walls. The hiQ v. LinkedIn safe harbor only covers publicly accessible data. Programmatic extraction from auth-gated content could constitute "exceeding authorized access."

4. **No DMCA safe harbor**: Safe harbor protects platforms from liability for what users upload. Our app is the instrumentality of copying -- we make the HTTP request to their servers. We're not a passive host.

5. **Contributory copyright infringement**: Under the Grokster inducement theory, a tool whose primary purpose is circumventing platform restrictions faces elevated risk. youtube-dl (fully generic) still got DMCA'd and had its domain seized in Germany.

6. **"Generic" framing doesn't help**: Courts look at actual usage patterns, not labels. If analytics show 85%+ of imports are from Veo/Trace, the generic veneer collapses.

### Target liability profile: CapCut

CapCut's model: user uploads files from their device, app never touches the content source. Zero copyright lawsuits. Their only legal exposure is privacy/biometric (BIPA class action) -- unrelated to content ingestion.

Our app should be a neutral editing tool that users bring their own content to.

## Solution

Remove all Video Link Import code -- UI, backend endpoints, Modal ingest function, and POC tests. Users download from Veo/Trace using those platforms' own tools, then upload to our editor via the existing multipart upload flow.

Trace already lets Pro subscribers download highlights. Veo allows downloads for Admin/Editor roles. The upload path (T80) with upcoming optimizations (T2670) provides a good experience.

## Context

### Relevant Files (from Video Link Import epic T2600-T2635)

**Frontend:**
- `src/frontend/src/components/GameDetailsModal.jsx` - "Paste Link" tab UI
- Any import-related components in the GameDetailsModal flow
- Import progress/status UI elements

**Backend:**
- `src/backend/app/routers/games_import.py` - `POST /api/games/import-url` endpoint + progress tracking + background download
- `src/backend/app/services/video_import/` - Veo/Trace URL parsing, CDN extraction, HLS manifest handling
- `src/backend/app/modal_functions/video_processing.py` - `ingest_video_to_r2()` Modal function (handles both direct Veo and HLS Trace)

**Tests/POC:**
- `tests/test_veo_import.py` or similar integration tests
- `tests/test_trace_import.py` or similar

**PLAN.md references:**
- Video Link Import epic section (lines 143-151)
- T2500 Veo Link Import (SUPERSEDED, line 142)

### Related Tasks
- T2600 Veo Import POC (DONE) - to be removed
- T2610 Trace Import POC (DONE) - to be removed
- T2620 Import Backend Service (DONE) - to be removed
- T2625 Modal Video Ingest (DONE) - to be removed
- T2627 Optimize Modal Ingest (DONE) - to be removed
- T2628 Ingest Timeout & Retry (DONE) - to be removed
- T2630 Add Game Import UI (DONE) - to be removed
- T2635 Import Failure UX (DONE) - to be removed
- T2670 Upload Slow Connection Optimization (TODO) - improves the upload path that replaces this

### Technical Notes
- The Modal `ingest_video_to_r2()` function may be shared with other Modal functions. Check for callers before deleting -- if it's only called by the import flow, remove it. If shared, leave it.
- The `POST /api/games/import-url` endpoint may have database tables (e.g., import jobs, import progress). Check for and remove any import-specific tables/columns.
- After removal, redeploy Modal functions if `video_processing.py` was modified:
  ```bash
  cd src/backend && PYTHONUTF8=1 .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py
  ```
- Update PLAN.md: move the entire Video Link Import epic to a new "Removed" section or mark all tasks as REMOVED with a note pointing to this task.

## Implementation

### Steps
1. [ ] Search codebase for all import-related code: `import-url`, `import_url`, `video_import`, `ingest_video`, `ImportUrl`, `paste.*link`, `veo`, `trace` (in import context)
2. [ ] Remove frontend: "Paste Link" tab from GameDetailsModal, any import progress components
3. [ ] Remove backend: `games_import.py` router, `video_import/` service directory
4. [ ] Remove Modal: `ingest_video_to_r2()` if not shared; remove import-specific code from `video_processing.py`
5. [ ] Remove tests: import-related test files
6. [ ] Remove any import-specific database tables/migrations
7. [ ] Update PLAN.md: mark Video Link Import epic tasks as REMOVED
8. [ ] Verify: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"` (backend imports clean)
9. [ ] Verify: `cd src/frontend && npm run build` (frontend builds clean)
10. [ ] Redeploy Modal if `video_processing.py` changed

## Acceptance Criteria

- [ ] No code path exists to fetch video from external URLs
- [ ] GameDetailsModal only shows file upload (no "Paste Link" tab)
- [ ] Backend has no `/api/games/import-url` endpoint
- [ ] Modal has no `ingest_video_to_r2()` function (or it's confirmed unused by import)
- [ ] Backend starts cleanly
- [ ] Frontend builds cleanly
- [ ] Existing file upload flow is unaffected
