# T5440: Missing working video should degrade gracefully, not spam retries + console errors

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-07-19

## Problem

Found 2026-07-19 (imankh, staging): opening a draft whose working video is missing from R2 produces a
wall of red console errors + a silent retry loop, with no clear user-facing state. Reproduced on
staging project 29 ("Brilliant Dribble"): the DB has a working-video reference but the R2 object is
gone (`GET /api/projects/29/working_video/stream` → `404 {"detail":"R2 returned 404"}`), so:

```
[videoMetadata] FAIL: HEAD returned 404 — URL unreachable ...   (x6)
[useProjectLoader] Error loading working video: Error: HEAD fetch returned 404
[OverlayScreen] Working video load failed (attempt 1/2): HEAD fetch returned 404 {projectId:29, workingVideoId:39}
[OverlayScreen] Working video load failed (attempt 2/2): ...
```

The video is genuinely gone (data rot / a storage prune with a dangling DB ref — a known class, cf.
the T4020 "shadow working-clip" prune). That specific data is out of scope to restore here. The
PRODUCT gap is the front-end behavior: instead of a clean "this reel's video is no longer available"
state, the app retries and floods the console — which (a) looks broken to the user and (b) buried a
real signal during T5xxx testing.

This aligns with the project's "fail visibly, not silently, and not with noise" principle: a missing
internal asset should surface ONE clear, user-legible state, not a retry storm.

## Solution
When a working (or final) video load returns a hard 404 (asset genuinely absent, distinct from a
transient network error or expired presign that a retry can fix):
- Show a clean, user-facing "This reel's video is no longer available — re-export to rebuild it" state
  in the editor (Framing/Overlay), instead of an infinite/again retry.
- Log ONCE at an appropriate level (not a per-frame `[videoMetadata] FAIL` storm).
- Distinguish a hard 404 (don't retry — the object is gone) from a transient/5xx (retry is valid).
  The current `attempt 1/2, 2/2` retry should not run on a definitive 404.

## Relevant files
- `src/frontend/src/hooks/useProjectLoader.js` — "Error loading working video" + the load/retry.
- `src/frontend/src/screens/OverlayScreen.jsx` — "Working video load failed (attempt N/2)" retry loop.
- the `videoMetadata` HEAD-probe util that logs `[videoMetadata] FAIL` per attempt.
- Framing screen equivalent (same working-video load path).
- backend `projects/{id}/working_video/stream` — returns `404 {"detail":"R2 returned 404"}` (the
  signal to key on; already visible/clear at the API, per no-silent-fallback).

## Acceptance Criteria
- [ ] Opening a draft whose working video R2 object is missing shows a single clear "video
      unavailable / re-export" state — no retry storm, no repeated `[videoMetadata] FAIL` console spam.
- [ ] A hard 404 does not trigger the transient-retry path; a genuine transient/5xx still retries.
- [ ] One concise log line for the missing-asset case (visible, debuggable, not per-frame).
- [ ] Videos that exist load exactly as before (no regression to the happy path).

## Classification hint
M-tier, frontend-first (the backend already returns a clean 404). Robustness/UX. No schema. Verify by
pointing at a project with a genuinely-missing working video (staging project 29 is a live repro) and
one with an intact video (project 31).
