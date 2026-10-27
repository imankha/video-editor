# T13440: Finished tab highlight posters fail to load (CORS error on /api/downloads/{id}/poster.jpg)

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Tier:** M (backend route + CORS, maybe frontend img)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844 on imankh+stg-qa-20261025@gmail.com (report: `C:\Users\imank\Desktop\staging-qa-part2-2026-10-26\REPORT.md`, bug 7). Not yet reproduced by us.

## Problem

Opening Home > Finished logged three blocked image loads:

```
Access to image at 'https://reel-ballers-api-staging.fly.dev/api/downloads/4/poster.jpg?profile_id=7a281fd2'
from origin 'https://reel-ballers-staging.pages.dev' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Same for downloads 3 and 5, each followed by `net::ERR_FAILED`. The tiles fall back instead of showing the poster.

A CORS error on an image usually means the response did not pass through the CORS middleware: an unhandled 5xx, a 403 raised before the middleware adds headers, or a redirect to an R2 URL without CORS. `get_reel_poster` raises 403 on a `profile_id` mismatch (T7940) and 404 when the poster is missing. Find which status staging actually returns.

## Solution

1. Reproduce: request the three URLs with the session cookie and read the real status and headers (Fly logs by req_id).
2. Fix the cause (error path missing CORS headers, crash in `ensure_reel_card_poster`, profile mismatch from a stale `profile_id`, or a crossorigin attribute on the img that the endpoint does not support).
3. If the poster legitimately does not exist, the 404 must still carry CORS headers so the tile shows its branded fallback without a console error.

## Context

### Relevant Files
- `src/backend/app/routers/downloads.py` (`get_reel_poster`, ~line 1596)
- `src/backend/app/services/poster.py` (`ensure_reel_card_poster`)
- `src/backend/app/main.py` (CORS middleware)
- Finished tab tile component that renders the poster img
- `.claude/knowledge/export-pipeline.md`

## Acceptance Criteria

- [ ] Finished tab on staging shows posters for highlights that have one, with no CORS errors
- [ ] A missing poster returns a 404 with CORS headers and the tile shows its fallback
- [ ] Regression test on the failing status path

## Repro steps

1. Sign in on staging as imankh+stg-qa-20261025@gmail.com, any viewport (seen at 390x844).
2. Home > Finished. Keep the console open.

**Expected:** posters load, no console errors.
**Actual (before fix):** `Access to image at '.../api/downloads/{3,4,5}/poster.jpg?profile_id=...' ... blocked by CORS policy` plus `net::ERR_FAILED`.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the CORS errors and the real response status (curl the URL with the session cookie). Write a backend test for that status path asserting CORS headers are present; see it fail.
2. **After the fix:** rerun the repro on the same account: posters show (or the branded fallback with no console error); test passes.
