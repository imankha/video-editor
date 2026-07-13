# T4940: Download a Collection as One Stitched MP4 (with burned outro)

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

User directive during T3950 (2026-07-12): "burn the outro on download — same thing for
compilations, burn them on download." Investigation found there is **no compilation
download today**: collections (Top Plays, game highlights, mixes) exist only as composited
playback — the player chains member reels client-side. There is no endpoint that produces a
single stitched MP4 for a collection, so there is nothing to burn an outro into yet.

Parents will want to save/post a whole "Top Plays" as one video. Without this, the only
per-file artifact is the individual reel.

## Solution

A download action on collection cards that serves the collection as ONE MP4:
member reels stitched in collection order (rank-aware, same order as playback), ending with
exactly one "Made with Reel Ballers" outro (T3950's `branded_outro.py` card builder +
concat machinery is the engine; same `BRANDED_OUTRO_ENABLED` flag, same non-fatal rule).

Key design questions for the design pass:
1. **Where the stitch runs**: server-side ffmpeg on the backend (concat-copy when member
   reels share resolution/fps — they usually do within an aspect bucket; normalize minority
   members otherwise, reusing the T4140 canonical-resolution approach) vs the existing
   multi-clip Modal path (likely overkill — no GPU work needed for concat).
2. **Sync vs job**: a long collection = slow response. Probably an export_jobs-backed
   background job with the standard progress/recovery machinery rather than a blocking
   download request. If job-based, it must respect the T4110/T4200 sync-then-announce boundary.
3. **Caching**: stitched output is derived state — regenerate on demand; if cached (R2
   `collection_downloads/`), cache is disposable and keyed by member-set hash so rank/member
   changes invalidate naturally. NO new canonical state.
4. **Credits/cost**: CPU-only concat; decide whether it consumes credits (probably free).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/branded_outro.py` — card builder + concat (T3950; reuse, don't fork)
- `src/backend/app/routers/downloads.py` — single-reel download burn (T3950 pattern) + collection metadata routing
- `src/backend/app/routers/collections.py` / `services/collection_metadata.py` — member resolution, rank ordering
- `src/backend/app/routers/export/multi_clip.py` — existing stitch/concat reference (transitions NOT needed here)
- Frontend collection cards (My Reels) — download affordance

### Related Tasks
- Builds on: T3950 (playback-composited outro + download-time burn; the card/concat engine)
- Reference: T4140 `_pick_canonical_resolution` normalization pattern

### Technical Notes
- Exactly ONE outro at the end of the stitch — member reels are card-less files (T3950
  never burns at publish), so no double-card risk.
- Public shared collections: decide whether the share viewer also offers the stitched
  download (attribution travels with the file — the growth case).

## Implementation

### Steps
1. [ ] Design pass (questions above) — L-gate if job machinery is chosen
2. [ ] Backend stitch endpoint/job reusing branded_outro concat
3. [ ] Frontend download action on collection cards
4. [ ] Tests: order correctness, single outro, mixed-resolution normalization, non-fatal outro failure

## Acceptance Criteria

- [ ] A collection can be downloaded as one MP4 whose segment order matches playback order
- [ ] The file ends with exactly one branded outro; flag off -> no outro
- [ ] Mixed-resolution member reels produce a valid stitched file (no corrupt concat)
- [ ] Outro/stitch failure never corrupts or loses member reels (read-only over sources)
- [ ] Tests pass
