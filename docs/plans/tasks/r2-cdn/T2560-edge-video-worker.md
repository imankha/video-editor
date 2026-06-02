# T2560: Edge Byte-Range Clamping for Game Clips

**Epic:** [R2 CDN Video Serving](EPIC.md)
**Priority:** P1
**Impact:** 7
**Complexity:** 5
**Status:** TODO
**Depends on:** T2550 + T3250 results (likely skipped)

## Likely Unnecessary

T3250 drops bounded-range clamping for video streaming. The clamping was originally about bandwidth savings, not content protection -- game videos are user-owned content and R2 has zero egress fees. Browser native video players only buffer ~30-60s ahead, so they won't download the full 2GB file.

**Evaluate T3250 production metrics before starting this task.** If playback works smoothly without clamping and bandwidth usage is acceptable, skip this task entirely.

## Problem

Without byte-range clamping, the browser can request any byte range from a 2-3GB game video when playing an 8-second clip. While native video players only buffer ahead ~30-60s, this is still more data than the 3-window clamping would serve (moov + clip region + padding).

## Solution

Port the 3-window byte-range clamping logic to the Cloudflare Worker (deployed in T2550). The Worker intercepts clip streaming requests and restricts byte ranges to moov head, clip region with padding, and moov tail.

**Only implement if T3250 production data shows excessive bandwidth usage from unclamped streaming.**

## Implementation

### Steps

1. [ ] **Worker: Add clip metadata to signed URL**: Backend encodes clip params (start_time, end_time, video_size, video_duration) into the signed URL payload so the Worker can compute byte ranges without a database lookup.
2. [ ] **Worker: 3-window byte-range calculation**: Port constants and logic from `clips.py`:
   - `MOOV_WINDOW_END = 10MB - 1`
   - `MOOV_TAIL_SIZE = 10MB`
   - `PRE_PAD_SECONDS = 2.0`
   - `POST_PAD_SECONDS = 5.0`
   - `MIN_PAD_BYTES = 5MB`
   - `GAP_OVERRUN_EXTRA = 20MB`
   - Window merging when clip region overlaps moov head/tail
3. [ ] **Worker: 3 parallel R2 binding calls**: `Promise.all` of `env.BUCKET.get(key, { range: { offset, length } })` for each window. Concatenate streams via TransformStream. Return with `Content-Length` = sum of window sizes.
4. [ ] **Worker: Clamped range validation**: If client requests range outside all 3 windows, return 416 Range Not Satisfiable.
5. [ ] **Test harness: Byte-level parity**: Write tests that feed the same inputs to both Python clamping and Worker clamping, assert identical byte ranges.
6. [ ] **Feature flag**: `?cdn_clips=1` URL param. When enabled, clip stream requests go to CDN Worker clamping instead of direct R2.
7. [ ] **Staging validation**: Test with real game videos. Compare video playback between direct R2 and CDN Worker paths.
8. [ ] **Prod rollout**: Enable for a single user first, then gradually roll out.

### Files

**Modified:**
- `workers/video-edge/src/index.ts` -- add clip clamping route, 3-window logic, stream concatenation
- `src/backend/app/storage.py` -- encode clip metadata in signed CDN URL
- `src/backend/app/routers/clips.py` -- return CDN clamped URL when flag enabled

**Reference (port from):**
- `src/backend/app/routers/clips.py:1537-1768` -- existing 3-window clamping implementation

## Risks

- **Video corruption from range errors**: Off-by-one in byte ranges produces silent corruption. Mitigated by byte-level parity tests against the proven Python implementation.
- **Worker stalling**: Workers proxying large R2 video bytes have documented reliability issues. This task makes the Worker proxy bytes (unlike the auth-only pass-through in T2550).
- **R2 multi-range limitation**: R2 doesn't support multi-range HTTP requests. Worker makes 3 separate `env.BUCKET.get()` calls per clip load.
- **Worker memory (128MB)**: Must stream responses. Never buffer more than one chunk at a time.

## Acceptance Criteria

- [ ] T3250 production data reviewed -- clamping confirmed necessary (excessive bandwidth without it)
- [ ] Game clip streaming works via CDN Worker with identical playback to direct R2
- [ ] Byte-level parity tests pass for all video types (faststart, moov-at-end, short clips, multi-video)
- [ ] Feature flag allows A/B testing between direct R2 and CDN clamped paths
- [ ] 416 Range Not Satisfiable returned for out-of-window requests
