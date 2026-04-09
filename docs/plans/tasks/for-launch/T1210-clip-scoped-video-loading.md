# T1210: Smart Video Preloading & Clip-Scoped Loading

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-08
**Updated:** 2026-04-09

## Problem

Opening a multi-clip project in the Framing editor triggers a 13+ second load for a 90-minute (5390s) game video. Two separate issues:

1. **Warmup is generic** — `cacheWarming.js` warms the first 1KB + last 5MB of every game video. It has no awareness of clips or projects. It doesn't know which bytes the user will actually need.
2. **Browser over-fetches** — `VideoPlayer.jsx` uses `preload="auto"`, so the browser aggressively buffers the entire video from byte 0, even when the clip starts at minute 45.

## Solution

### Warmup Strategy: Priority Queue with 3 Tiers

On login, backend returns all warmable URLs with priority tiers. Frontend workers process them in order:

#### Tier 1: Project clips (highest priority)

Incomplete projects are what the user most likely opens next.

- **If project has a working_video** (already framed): warm only the working_video. The user's next step is Overlay, which plays the framed output — source game clips are irrelevant.
- **If project has no working_video** (needs framing): warm the source clip ranges. Use proportional byte estimate: `byte_offset = (start_time / video_duration) * video_size`. Warm a window around each clip (e.g., 10% buffer on each side).

#### Tier 2: Full game videos (medium priority)

Games are used in Annotate mode where the user scrubs the full video to mark clips. Warm the full game — start bytes + moov atom tail (existing behavior).

#### Tier 3: Gallery videos (lowest priority)

Exported final videos. Existing behavior.

#### On project creation

When the user creates a new project (selects clips), immediately add those clip ranges to the front of the warmup queue. Workers pick them up before any remaining Tier 2/3 work.

### Playback: Clip-Scoped Video Element

When playing a clip in Framing mode:

1. Change `preload="auto"` → `preload="metadata"` so the browser only fetches the moov atom initially
2. Append `#t=start,end` media fragment to the presigned URL — hints the browser to seek directly to the clip range
3. Browser issues HTTP range requests starting from the clip's byte offset instead of byte 0

```jsx
// Before:
<video preload="auto" src={presignedUrl} />

// After (Framing mode):
<video preload="metadata" src={`${presignedUrl}#t=${clipStart},${clipEnd}`} />
```

### Backend: Clip-Aware Warmup Endpoint

Extend `GET /storage/warmup` response to include project clip data:

```json
{
  "project_clips": [
    {
      "project_id": 3,
      "has_working_video": false,
      "clips": [
        {
          "game_url": "presigned URL",
          "start_time": 120.5,
          "end_time": 135.2,
          "video_duration": 5400,
          "video_size": 3200000000
        }
      ]
    },
    {
      "project_id": 7,
      "has_working_video": true,
      "working_video_url": "presigned URL for framed output"
    }
  ],
  "game_urls": [ ... ],
  "gallery_urls": [ ... ]
}
```

### Byte Range Estimation for Clip Warming

For a clip at seconds 120-135 of a 5400s, 3.2GB video:

```
start_byte = (120 / 5400) * 3_200_000_000 = ~71MB
end_byte   = (135 / 5400) * 3_200_000_000 = ~80MB
buffer     = 10% of range = ~1MB each side
warm range = bytes 70MB - 81MB
```

Fire `fetch(url, { headers: { Range: 'bytes=70000000-81000000' } })` to prime that region of the Cloudflare edge cache.

This is approximate (assumes constant bitrate) but primes the right region. The browser's own range requests during playback will hit warm cache.

## Context

### Relevant Files
- `src/frontend/src/components/VideoPlayer.jsx:220` — `preload="auto"` (change to `metadata` in Framing)
- `src/frontend/src/hooks/useVideo.js:169` — `loadVideoFromStreamingUrl()` accepts `clipRange` but doesn't constrain browser fetch
- `src/frontend/src/utils/cacheWarming.js` — Current warmup: priority queue with 5 workers, but only warms start+tail generically
- `src/frontend/src/screens/FramingScreen.jsx` — Where clips are loaded
- `src/backend/app/routers/storage.py:198` — `GET /storage/warmup` endpoint, returns game/gallery/working URLs
- `src/backend/app/storage.py` — `generate_presigned_url()`, `generate_presigned_url_global()`

### Related Tasks
- T1120 (Framing Video Cold Cache) — DONE, covered generic cache warming on Framing entry; this task supersedes with clip-aware warming
- T1130 (Multi-Clip Stream Not Download) — DONE, fixed exports to use range requests; this task fixes playback
- T1220 (Modal Range Requests) — same problem on the GPU side

### Technical Notes
- Media Fragment URIs (`#t=start,end`) are supported by modern browsers and work with presigned URLs — the fragment is not sent to the server, it's a client-side hint
- `preload="metadata"` causes the browser to fetch only the moov atom initially (~few KB for faststart, tail bytes for non-faststart)
- Proportional byte estimation works well for sports footage (relatively constant bitrate) — no need for moov atom parsing
- The existing `cacheWarming.js` worker pool (5 concurrent) can be reused; just change what gets queued

## Implementation

### Steps
1. [ ] Extend `GET /storage/warmup` to return `project_clips` with clip ranges, working_video URLs, and size/duration data
2. [ ] Update `cacheWarming.js` queue population: Tier 1 (project clips/working videos) → Tier 2 (full games) → Tier 3 (gallery)
3. [ ] Add proportional byte-range warming for clip ranges (instead of start+tail)
4. [ ] For framed projects, warm only the working_video URL (skip source clips)
5. [ ] Change `preload="auto"` → `preload="metadata"` in VideoPlayer.jsx for Framing mode
6. [ ] Append `#t=start,end` media fragment when loading clips in Framing
7. [ ] On project creation, push new clip ranges to front of warmup queue
8. [ ] Cancel in-flight buffering when switching between clips in multi-clip mode

## Acceptance Criteria

- [ ] Warmup prioritizes project clips over game videos over gallery
- [ ] Framed projects warm only the working_video, not source clips
- [ ] Unframed projects warm only the clip byte ranges, not the full game
- [ ] Full games still warm for Annotate mode (Tier 2)
- [ ] Multi-clip Framing opens in <3s for warmed clips (down from 13s+)
- [ ] Browser only buffers the clip's time range via `#t=` fragment
- [ ] Project creation triggers immediate clip range warming
- [ ] No regression in Annotate mode video loading
