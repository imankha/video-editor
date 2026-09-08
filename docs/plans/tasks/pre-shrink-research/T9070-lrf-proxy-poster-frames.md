# T9070: Poster + preview frames from the `.LRF` proxy at upload time (T8836 row 3)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

For DJI-style folders the camera ships a 720p `.LRF` proxy that is frame-synced 1:1 with
the 8K `.MP4` (T8836 measured identical sample counts: 8196 / 8196 on segment 0006). The
intake already keeps proxies client-side and never uploads them (EPIC decision 2), and
the shrink tool already draws preview frames from them. Meanwhile the server's poster
path (`src/backend/app/services/poster.py`) makes ~5 remote range seeks into the uploaded
game to build a poster. T8836 measured the client alternative at **224 ms per frame**
(70 ms load + 94 ms seek + 60 ms draw + JPEG encode, real Chrome, real proxy) producing a
~210 KB 1280 x 720 JPEG at q=0.85. Decision table row 3 said YES with the server path kept
as the ONLY fallback for proxy-less uploads (phone/GoPro/Trace). The row was left for the
user to confirm; this task is the provisional follow-up and may be vetoed.

## Solution

At the upload gesture, when a segment has a matched `.LRF` proxy, draw one poster frame
(and, if T8850's filmstrip wants them, N preview frames) from the proxy client-side and
send the JPEG alongside the game create/finalize so the server stores it as the poster
and skips its remote seeks. Uploads without a proxy change nothing: `poster.py` remains
the fallback exactly as today. No schema change (the poster already has a storage
location and a backfill path); the only new thing is the client supplying the bytes.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/poster.py` - the current remote-seek poster generation;
  learn its output contract (dimensions, format, R2 key) and make the client-supplied
  poster satisfy the same contract so downstream (share unfurls, tiles,
  `backfill_posters`) is unchanged
- `src/backend/app/routers/games_upload.py` / `games.py` - where a poster could be
  accepted at finalize/create (prefer extending the existing finalize payload over a
  new endpoint; validate size/type; never trust dimensions blindly)
- `src/frontend/src/services/uploadManager.js` - `_hashAndAnalyze` (the per-file
  analyze step at the upload gesture) and `uploadMultiVideoGame`
- `src/frontend/src/hooks/useFootageIntake.js` + `footageIntake.js` (T8800) - the
  `proxies` map that pairs each video with its `.LRF`
- `scripts/shrink-tool/ui/segmentList.js` - `previewFrame` (proxy seek + draw already
  implemented for the tool; port the technique, not the DOM code)
- `docs/plans/tasks/universal-upload/T8836-survey-cheap-client-preupload-work.md` -
  candidate 3 measurement (cite)
- `docs/plans/tasks/universal-upload/EPIC.md` decision 2 (proxies stay client-side)
- `docs/plans/tasks/T8840-design.md` R10 - the `.LRF` field of view might not match
  the `.MP4` on some camera modes; T9000's "crop is right" check is the evidence

### Related Tasks
- Depends on: user confirmation of T8836 row 3; T9000 (R10 verdict: proxy framing
  matches the main file on the real folder)
- Blocks: nothing hard. Feeds T8850 (filmstrip frames use the same mechanism)
- Related: poster backfill (`POST /api/admin/backfill-share-posters`), the share unfurl
  path that consumes posters

### Technical Notes
- **Gesture-based**: the poster is produced inside the upload the user started, never
  from a reactive watch on file state.
- **Fallback stays**: if no proxy, or the proxy fails to decode within a short timeout,
  do nothing client-side and let `poster.py` run as today. Log the fallback once, not
  silently.
- **Trust boundary**: the server validates the JPEG (magic bytes, max bytes, decodes
  to sane dimensions) before storing; a malformed poster falls back to the server path.
- **Which frame**: T8836 used 30% into the file. Prefer a frame the poster-clarity
  selector would pick (memory note: non-occlusion > size > sharpness) only if that
  selector is cheap to reuse; otherwise 30% is fine for v1.
- Lower q / smaller target if bandwidth matters more than the extra ms (T8836 note);
  210 KB is already negligible next to a multi-GB upload.
- Coordinate with T9060: both extend the same analyze step; keep the two additions as
  separate, greppable functions.

## Implementation

### Steps
1. [ ] Read `poster.py`'s output contract and where posters are stored/served; decide
   the finalize-payload extension (no new endpoint unless unavoidable).
2. [ ] Client: from the intake's proxy for the FIRST segment, seek + draw + JPEG
   (q=0.85, 1280 x 720) at the upload gesture; attach to finalize; time it.
3. [ ] Server: accept, validate, store to the same key `poster.py` would have written;
   skip remote seeks when a valid poster arrived.
4. [ ] Tests: client unit test for the proxy-present / proxy-absent / decode-timeout
   branches; backend test for accept + validate + fallback.
5. [ ] Manual: upload the real DJI folder on the local stack; poster appears without
   `poster.py` seeks (log-confirmed); upload a phone clip; poster still comes from the
   server path.

### Progress Log

**2026-09-08**: Filed provisionally from T8836 decision row 3 (user had not yet picked
the row). Veto = close this task and tick T8836's step 4 with "row 3 declined".

## Acceptance Criteria

- [ ] DJI-folder upload produces its poster client-side (~224 ms/frame class timing
      recorded) and the server skips remote seeks (log-confirmed)
- [ ] Proxy-less upload is byte-identical to today's behaviour
- [ ] Server validates the JPEG and falls back on any rejection; no schema change
- [ ] Curated test set green; T8836 step 4 updated to reference this task
