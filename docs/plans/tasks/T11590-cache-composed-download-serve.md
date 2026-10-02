# T11590: Cache the composed download/share file so repeat requests skip the compose pipeline

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Problem

User complaint, 2026-10-01: **"Share took too long - massive lag."** No matching row exists in
`bug_reports` (prod table was empty when checked) and staging admin access 401'd, so there is no
timed trace for this specific tap - the finding below comes from reading the code path every mobile
Share and every Download currently runs, not from a captured reproduction.

`GET /api/downloads/{download_id}/file` (`downloads.py:694`) rebuilds the ENTIRE file from scratch
on every single request, with no cache:

1. Download the full reel from R2 to a temp file (R2 path) or read it locally.
2. Resolve the live intro-card attachment (`resolve_intro_for_reel`, `intro_egress.py:183`).
3. `compose_serve_time_dispatched` (`serve_time_video.py:206`): upload the reel + intro layers to
   R2 scratch, dispatch to Modal (or run local ffmpeg), download the composed result back.
4. `_stamp_download` (`downloads.py:669`): a second ffmpeg pass for metadata + cover art.
5. Only then does the first byte stream out.

This is the same path for a plain Download tap AND (once
[T11510](social-cover-image/T11510-split-share-video-vs-share-link.md) ships) the new "Share video"
action - mobile `navigator.share({files})` cannot open the OS share sheet until the full file has
been fetched client-side, so every bit of server-side compose time is wait time in front of the
user with no feedback today (T11510 adds a "Preparing video..." spinner, which is a UI mitigation,
not a fix for the latency itself).

**This is not a new problem; it already happened once, for collections.** T4947 (DONE, deployed
2026-08-16 prod) built exactly this cache for collection stitched downloads after the user
reported the same thing and reversed the original "no cache for v1" design decision. This task is
the same fix for the single-highlight download path, which never got it.

## Solution

Mirror T4947's shipped pattern exactly - a disposable R2 cache with no DB row and no migration,
keyed so any input change invalidates naturally:

```
reel_downloads/{sha256(
  final_video filename              # immutable once a final_video row exists (re-export makes a NEW row/filename, see T4010/T10860)
  + resolved intro card id + card content-hash   # LIVE per-profile attachment (intro_egress.py:183), NOT frozen at export time
  + outro flag
)}.mp4
```

- **HEAD-before-build**: check the cache key exists before doing any of steps 1-3 above. On a hit,
  skip straight to step 4 (the metadata stamp stays PER-REQUEST, never cached - see the existing
  `NOTE ON CACHING` docstring in `download_metadata.py`, which already documents this exact
  boundary because `artist` is the live profile name and must never go stale in a cached file).
- **Write-after-build** on a miss, atomic (don't let two concurrent requests for the same key race
  a partial write into place - T4947 solved this once, copy its approach).
- Do **not** extract a shared cache helper between this and T4947's collection-download cache yet -
  this is only the 2nd occurrence of the pattern. Per Refactoring Rule 1 (abstract on the 3rd
  duplication), duplicate the shape here; a shared helper is a separate task if a 3rd caller shows up.

### Residual latency (document, don't hide)

The FIRST download/share of a given highlight, or the first one after the attached intro card
changes, is still a full cache miss and pays the entire compose cost - this task does not make that
case fast, it makes every REPEAT request fast (which is most of them: the player Share button, the
tile kebab, and the gallery Download button on an unpublished-then-published highlight folks reopen
and resend many times). Flag this plainly in the PR/report rather than implying the complaint is
fully gone - if the original lag report was itself a first-ever share, this task alone may not
resolve it and the Modal cold-start / local-ffmpeg cost on a miss should be separately measured
before claiming victory.

**Open risk for whoever implements T11510 to verify live, not blocking this task:** on a cache MISS,
"Share video" still waits for the full compose before `navigator.share()` can fire. iOS Safari can
drop the transient user-activation a tap grants if that wait runs long enough - the same timing
landmine T11510's design already solved for link-minting with a second-tap pattern (EPIC decision,
T11510 D3). If live testing after this cache ships still shows "Share video" failing silently on a
cold cache, the fix is the same second-tap shape, not more caching.

## Context

### Relevant Files
- `src/backend/app/routers/downloads.py` (`download_file`, L694-892): wrap steps 1-3 in the
  HEAD-before-build / write-after-build check; `_stamp_download` stays unconditional per-request.
- `src/backend/app/services/serve_time_video.py` (`compose_serve_time_dispatched`, L206): the
  function being cached; no changes expected here, just called less often.
- `src/backend/app/services/intro_egress.py` (`resolve_intro_for_reel`, L183 /
  `resolve_intro_card`): source of the live card identity for the cache key - find whatever already
  identifies "which card, with what content" (T4947 solved the identical problem for collections'
  card content-hash; reuse that convention, don't invent a new one).
- `src/backend/app/services/download_metadata.py`: read the `NOTE ON CACHING` docstring at the top
  before touching anything - it already states the stamp-stays-per-request contract this task
  must preserve.
- Reference implementation: `docs/plans/tasks/collection-download/T4947-cache-stitched-downloads.md`
  and its shipped code (collection download endpoint) - copy the HEAD-before-build /
  write-after-build / concurrent-write-safety shape from there.

### Related Tasks
- Precedent: T4947 (DONE) - same fix, collection downloads instead of single highlights.
- Interacts with: [T11510](social-cover-image/T11510-split-share-video-vs-share-link.md) (adds the
  "Share video" mobile action that hits this same endpoint) - no dependency either direction; this
  task helps T11510's "Preparing video..." wait regardless of which lands first.
- Found during: investigation of the 2026-10-01 "Share took too long" user complaint, which also
  surfaced the [Social Cover Image epic](social-cover-image/EPIC.md) (same root file,
  `useWebShare.js`, different symptom).

### Technical Notes
- Depth-3 (storage/performance) per the task-management skill's bug-prioritization rule - not a
  data-integrity risk, but it affects the reliability/perceived-reliability of every download and
  share.
- No DB row, no migration - cache existence must be fully derivable from the R2 key, same as T4947.
- `R2_ENABLED=false` (local dev) path: either skip the cache (local disk is already fast) or cache
  to local disk under the same key scheme - match whatever T4947 did for its local-disabled case.

## Acceptance Criteria

- [ ] Repeat download/share of an unchanged highlight serves from cache - no R2-fetch, no Modal
      dispatch, no ffmpeg compose pass (measure and log the skip).
- [ ] Changing the attached intro card produces a cache miss and a fresh build on the next request.
- [ ] Changing the outro flag (if ever made configurable) produces a cache miss.
- [ ] A re-export (new final_video row/filename) never serves a stale cached file from the old row.
- [ ] Two concurrent requests for the same uncached key don't corrupt each other's output.
- [ ] The metadata/cover stamp (artist, title, etc.) is still applied fresh on every request, even
      on a cache hit - a profile rename shows up on the very next download with no stale-artist
      cache poisoning (this is the existing contract in `download_metadata.py`; verify it still
      holds once this cache ships).
- [ ] Live-measured before/after latency for a cache-hit request, reported in the PR (not just
      "tests pass") - this is a perceived-performance fix, so the proof must show the perceived
      performance changed.
- [ ] Tests pass (relevant set: downloads router tests + serve_time_video tests).
