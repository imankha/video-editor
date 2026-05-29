# T2560: Edge Byte-Range Clamping for Game Clips

**Epic:** [R2 CDN Video Serving](EPIC.md)
**Priority:** P1
**Impact:** 7
**Complexity:** 5
**Status:** TODO
**Depends on:** T2550 + T3240 results (may be skipped entirely)

## May Be Unnecessary

If T3240 proves presigned URLs work for game clip streaming (smooth playback, no stalling), byte-range clamping may be unnecessary. The clamping was originally about bandwidth, not content protection — and with R2's zero egress fees, bandwidth is free. Additionally, research shows Workers proxying large R2 files have reliability issues (stalling 1-2 min on load). **Evaluate T3240 results before starting this task.**

## Problem

Game video clip streaming still runs through the Fly.io proxy after T2550. The proxy does 3-window byte-range clamping (`clips.py:1537-1768`) — moov head, clip region with padding, moov tail — to prevent browsers from over-buffering 3GB files when only an 8-second clip is needed. This is the last video type still paying Fly.io egress.

## Solution

Port the 3-window byte-range clamping logic to the existing Cloudflare Worker (deployed in T2550). Keep the Fly.io proxy as a fallback during testing — frontend can feature-flag between CDN and proxy paths.

This is the highest-risk task in the epic. The clamping logic took multiple iterations to get right (T1430, T1440). Porting to JS with R2 bindings (which don't support multi-range requests) requires careful validation.

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
4. [ ] **Worker: Clamped range validation**: If client requests range outside all 3 windows, return 416 Range Not Satisfiable (matching current Fly.io behavior).
5. [ ] **Test harness: Byte-level parity**: Write tests that feed the same inputs (clip timing, video size, client Range header) to both Python clamping and Worker clamping, assert identical byte ranges. Test with:
   - Faststart files (moov at head)
   - Moov-at-end files (moov in tail window)
   - Short clips near file start (window overlap with moov head)
   - Short clips near file end (window overlap with moov tail)
   - Multi-video games
6. [ ] **Frontend: Feature flag**: `?cdn_clips=1` URL param or config flag. When enabled, clip stream requests go to CDN Worker instead of Fly.io proxy. Allows A/B testing.
7. [ ] **Backend: Update clip stream endpoint**: When CDN mode is active, return signed CDN URL with clip metadata instead of proxying.
8. [ ] **Staging validation**: Test with real game videos on staging. Compare video playback frame-by-frame between Fly.io proxy and CDN Worker paths.
9. [ ] **Prod rollout**: Enable for a single user first, then gradually roll out. Monitor for video playback errors.
10. [ ] **Remove Fly.io clip proxy fallback**: Once CDN clamping is proven stable in prod for 2+ weeks, remove the feature flag and Fly.io fallback path.

### Files

**Modified:**
- `workers/video-edge/src/index.ts` — add clip clamping route, 3-window logic, stream concatenation
- `src/backend/app/storage.py` — encode clip metadata in signed CDN URL
- `src/backend/app/routers/clips.py` — return CDN URL when cdn_clips enabled, keep proxy as fallback
- `src/frontend/src/` — feature flag for CDN clip streaming

**Reference (port from):**
- `src/backend/app/routers/clips.py:1537-1768` — existing 3-window clamping implementation

## Risks

- **Video corruption from range errors**: The highest-risk item. Off-by-one in byte ranges produces silent corruption — video plays but frames are wrong or audio desyncs. Mitigated by byte-level parity tests against the proven Python implementation.
- **R2 multi-range limitation**: R2 doesn't support multi-range HTTP requests. Worker makes 3 separate `env.BUCKET.get()` calls (~$1.08/M clip loads in R2 Class B ops). Each call is a separate round-trip, but they run in parallel and are internal to Cloudflare's network.
- **Worker memory (128MB)**: Must stream responses. Never buffer more than one chunk at a time. The 3 streams are concatenated sequentially, not merged in memory.
- **Observability gap vs Fly.io**: Current proxy has structured logging with `req_id` correlation and R2 timing instrumentation. Worker needs equivalent logging before becoming primary path.

## Acceptance Criteria

- [ ] Game clip streaming works via CDN Worker with identical playback to Fly.io proxy
- [ ] Byte-level parity tests pass for all video types (faststart, moov-at-end, short clips, multi-video)
- [ ] Feature flag allows A/B testing between CDN and Fly.io paths
- [ ] 416 Range Not Satisfiable returned for out-of-window requests
- [ ] Worker structured logs include clip metadata, window calculations, R2 call timing
- [ ] Stable in prod for 2+ weeks before removing Fly.io fallback
