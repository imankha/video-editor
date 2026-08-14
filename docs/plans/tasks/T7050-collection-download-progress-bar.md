# T7050: Collection download has no in-app progress feedback

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-15
**Updated:** 2026-08-15

## Problem

Clicking Download on a collection (T4945) gives the user zero in-app feedback while the request
is in flight — just a bare browser download once the streamed response completes. Per T7040's
evidence, the request can legitimately take several seconds (3.9s for `scope=all` in the best
case observed, and that's without a Modal cold start); with nothing on screen the user can't tell
whether the click registered, whether it's still working, or whether it's stuck. User asked for a
progress bar during collection downloads.

## Solution

Show progress in `DownloadsPanel.jsx` while `useDownloads.js::downloadCollection` is in flight.
`download_collection` (`collections.py`, T4945) is a `StreamingResponse` — check whether it sets
`Content-Length` up front (it may not, since final size depends on the stitched output) before
committing to a percent-based bar:

- If `Content-Length` is available: read the response body via
  `response.body.getReader()` + `ReadableStream`, accumulate bytes received vs. total, drive a
  determinate progress bar.
- If not available (unknown total size): fall back to an indeterminate/spinner-style progress
  indicator rather than a fake percentage.

Check for an existing progress-reporting pattern first — the game/reel export flow
(`useExport.js` or equivalent, `/api/exports/*`) may already poll or stream progress for a
similar long-running server op; reuse that pattern/component if it exists instead of building a
new one (Coding Principles: leverage existing systems).

## Context

### Relevant Files
- `src/frontend/src/hooks/useDownloads.js:221` — `downloadCollection`, the fetch() call to
  instrument with progress tracking
- `src/frontend/src/components/collections/DownloadsPanel.jsx` — UI that triggers the download
  and would render the progress indicator
- `src/backend/app/routers/collections.py` — `download_collection` (T4945) — verify whether the
  `StreamingResponse` sets `Content-Length`; if not, this task is UI-only (indeterminate state)
- Export flow (find via grep for existing progress-bar pattern) — check before building new UI

### Related Tasks
- Follows: T4945 (collection download endpoint), T7040 (collection download "Failed to fetch" —
  fix that first; a progress bar over a broken download is polish on top of a bug)

### Technical Notes
- Pure UX polish, no data risk — lower priority than T7040/T7030 which are broken functionality.
- Do not block T7040/T7030; can land independently.

## Acceptance Criteria
- [ ] Collection download shows in-app progress feedback (determinate bar if `Content-Length` is
      available server-side, indeterminate indicator otherwise) instead of no feedback at all
- [ ] Reuses an existing progress pattern if one exists for a comparable long-running op, rather
      than introducing a new one
- [ ] Tests pass
