# T4990: Re-export with missing game source surfaces raw ffmpeg 404 instead of classified error

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

`tests/test_t4050_missing_source_reexport.py::test_missing_game_source_reexport_fails_loud_not_silent`
fails on BOTH master and the 2026-07-10 prod base (`ef723e0d`) — a
pre-existing product gap that its own regression test documents but nothing
enforces (it is red in every full local run and is NOT on
`docs/testing/known-failures.md`):

```
AssertionError: missing game source must surface a classified 'source
expired/unavailable' error so the UI can tell the user, not a raw render
crash. Got: 'Error opening input file: Server returned 404 Not Found'
```

When a user re-exports a reel whose game source object is gone from R2
(expiry-swept / reclaimed), the export fails with a raw ffmpeg error string.
The UI can't distinguish "your source video expired" (expected, explainable,
possibly recoverable via T4175's preserved extract) from a genuine render
crash — the user just sees a scary opaque failure. This is the same failure
family as T4050/T4140/T4175 (missing-source handling) but on the ERROR
CLASSIFICATION path.

## Solution

Classify the missing-source condition where the export resolves its input
(the `resolve_clip_source` path, T4140), not by string-matching ffmpeg output:

1. Before (or when) the render opens the game source, a confirmed R2 404 on
   the source object should raise/return a typed error (e.g.
   `SOURCE_UNAVAILABLE`) with the game/clip id.
2. The export failure payload (`fail_export_job` / WS error event) carries
   that code; the frontend can then show the existing expired-source message
   pattern (bug 27p panel copy) instead of the raw string.
3. Ambiguous network errors must NOT be classified as expired (T4820 rule:
   expire only on a confirmed 404; transient errors stay generic).

Make the already-written test pass as-is — do not weaken the test.

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/test_t4050_missing_source_reexport.py` — the failing
  regression test (the spec of intended behavior; read first)
- `src/backend/app/routers/export/multi_clip.py` — render path that currently
  bubbles the raw ffmpeg error (~line 1867 raises the generic 500)
- `src/backend/app/services/export_helpers.py` — `fail_export_job` /
  failure-payload shape
- `src/backend/app/routers/export/framing.py` — same classification for the
  framing path (check whether the test covers it; mirror if trivial)
- Frontend (reference only unless the code lands cleanly):
  `src/frontend/src/containers/ExportButtonContainer.jsx` failure display

### Related Tasks
- T4050 (missing-source re-export fails loud) — parent investigation; this is
  its unfinished classification half
- T4175 (sweep preserves unframed clips) — supplies the preserved extract that
  a future "re-export from extract" recovery would use
- T4820 — the confirmed-404-only rule

### Technical Notes
- Root-cause preference: detect at SOURCE RESOLUTION (HEAD/open of the R2
  object), not by parsing ffmpeg stderr. String-matching "404" in render
  output is a banned defensive patch.
- Keep the failure LOUD (no silent fallback to another source).
- If the frontend message change grows the diff, split it: backend
  classification (this task) is the substance; UI copy can ride the existing
  error-display path.

## Implementation

### Steps
1. [ ] Read the failing test to extract the exact expected error contract.
2. [ ] Add source-existence classification at the resolve/open boundary in
       multi_clip.py (and framing.py if the test spans it).
3. [ ] Thread the typed code through `fail_export_job` / the HTTP error body.
4. [ ] Make the regression test pass unmodified; run the full t4050* files.
5. [ ] Manual check (dev): delete a game source object in a dev profile,
       re-export its reel, observe the classified message.

### Progress Log

**2026-07-12**: Confirmed failing at prod base AND master during the derisk
sweep (container, throwaway PG) — pre-existing, newly documented. If this task
is deferred, add the row to `docs/testing/known-failures.md` instead (see
T5000) so full-suite runs stop re-litigating it.

## Acceptance Criteria

- [ ] `test_missing_game_source_reexport_fails_loud_not_silent` passes
      unmodified
- [ ] Confirmed-404-only: transient R2 errors do NOT classify as expired
- [ ] Failure payload carries a stable machine-readable code, not a raw
      ffmpeg string
- [ ] No silent fallback introduced anywhere in the path
