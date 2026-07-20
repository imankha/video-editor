# T5620: Retry streaming video format-errors with backoff

**Status:** DONE (merged to master + deployed staging 2026-07-20)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-20
**Tier:** M (frontend-only, no schema)

## Problem

Found 2026-07-20 (imankh, staging): a VALID streaming reel (Brilliant Control, proj 31 — a
faststart MP4 serving 206) intermittently failed to load with `[VIDEO] Error: Video format
not supported` / `code=4 kind=format-error`. The file is fine; `MEDIA_ERR_SRC_NOT_SUPPORTED`
(code 4) on first load is a transient decode-pipeline race. `useVideo`'s `FORMAT_ERROR` branch
went straight to a user-facing "Video format not supported" with **no retry**, so a transient
made an intact reel look permanently broken.

## Fix

`src/frontend/src/hooks/useVideo.js` `handleError`: for a streaming (non-blob) `FORMAT_ERROR`,
retry up to 3x with exponential backoff (400ms / 1.2s / 3.6s), restoring `currentTime` each
time, before surfacing the error. Blob format-errors stay terminal (a real format problem).
Separate budget from the network/stall retry counter; reset on each load; pending timer
cancelled on new load + unmount. Module-scoped tuning constants (`FORMAT_MAX_RETRIES`,
`FORMAT_RETRY_BASE_MS`) so they don't churn hook deps.

## Acceptance Criteria

- [x] A streaming `code=4` retries with backoff before showing an error; a valid-but-transient
      failure recovers silently.
- [x] Blob format-errors remain terminal.
- [x] No leak: retry timer cancelled on new load + unmount.
- [x] Frontend suite green (1138); eslint 0 errors / 360 gate.

## Note

The transient is not reproducible on demand, so verification was mechanism + no-regression
(full suite) rather than forcing the exact race in a browser. Low-risk: only adds retries in
front of a previously-terminal error.
