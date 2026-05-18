# Annotation Playback Performance: Pre-Warm + Bounded Download

## Branch

`feature/T2910-referral-graph` (continue on this branch -- changes are additive)

## Problem

Shared annotation playback takes 16+ seconds before video plays. HAR analysis shows the entire page load is one request: an 8.7MB full game video download from R2's S3 API at ~540 KB/s. Two independent problems compound:

1. **Cold R2 edge**: The cache warming system (`cacheWarming.js`) runs on app init for returning users, but the share flow creates a **new user** who signs up and immediately plays -- no warming has run yet. The presigned URL hits `r2.cloudflarestorage.com` origin with no Cloudflare edge cache.

2. **Full video download**: Annotation playback only needs a few seconds of clip data, but the browser downloads the **entire game video**. The existing bounded proxy (T1430) solves this for project clips but is not wired up for the annotate screen's game video playback.

---

## Fix 1: Pre-Warm Video on Share Landing Page

### Goal

Use the 3-10 seconds the user spends on the sign-in prompt to warm the video's Cloudflare edge cache. When they eventually play, the edge is hot.

### Current share landing page flow

1. Frontend loads `SharedAnnotationView` component ([SharedAnnotationView.jsx](src/frontend/src/components/SharedAnnotationView.jsx))
2. Calls `GET /api/shared/teammate/{shareToken}` ([shares.py:241](src/backend/app/routers/shares.py#L241))
3. Response includes `game_blake3`, `game_name`, `first_clip_start`, `clip_names`, `sharer_email`
4. **Does NOT include a video URL** -- the video URL is only fetched later by `handleLoadGame` via `GET /api/games/{gameId}`
5. User sees sign-in prompt (unauthenticated) or loading spinner (authenticated)
6. After auth + resolve, navigates to AnnotateScreen which loads the game video cold

### What to change

**Backend** -- Add a `video_warm_url` field to the `GET /api/shared/teammate/{shareToken}` response:

In [shares.py:241-289](src/backend/app/routers/shares.py#L241):

```python
# After line 255 (after getting game_blake3):
video_warm_url = None
if game_blake3:
    from app.storage import generate_presigned_url_global
    video_warm_url = generate_presigned_url_global(f"games/{game_blake3}.mp4", expires_in=14400)
```

Add `"video_warm_url": video_warm_url` to both return dicts (materialized at line 260 and non-materialized at line 278).

**Frontend** -- Fire a warm fetch when the share page loads:

In [SharedAnnotationView.jsx](src/frontend/src/components/SharedAnnotationView.jsx), after `setData(json)` at line 42:

```javascript
// Pre-warm video edge cache while user reads/signs in
if (json.video_warm_url) {
  fetch(json.video_warm_url, {
    method: 'GET',
    headers: { Range: 'bytes=0-1023' },
    mode: 'cors',
    credentials: 'omit',
  }).catch(() => {});
}
```

This fires a 1KB range request that primes the Cloudflare edge. The browser also caches the connection/TLS state. When `handleLoadGame` later requests the same R2 object (possibly with a different presigned URL but same object path), the edge serves from cache.

**Note on URL matching**: The presigned URL from the warm fetch and the one from `GET /api/games/{gameId}` will have different signatures (generated at different times). But Cloudflare caches by the R2 object path, not the query string signature. The edge cache hit works because both URLs resolve to the same R2 object (`games/{blake3}.mp4`). The warm fetch primes the Cloudflare edge, not the browser HTTP cache.

### Expected improvement

The sign-in flow takes 3-10 seconds (Google One Tap / OTP). During that time, the edge caches the video object. When playback starts, the first byte comes from Cloudflare's edge (~50-100ms TTFB) instead of R2 origin. For 8.7MB, this could cut download from 16s to 2-4s depending on user bandwidth.

---

## Fix 2: Bounded Proxy for Annotation Playback

### Goal

When the annotate screen loads a game video for annotation playback, only download the byte ranges needed for the annotated clips + moov atom, instead of the full game video.

### Current annotate video loading flow

1. `handleLoadGame` in [AnnotateContainer.jsx:389-458](src/frontend/src/containers/AnnotateContainer.jsx#L389) calls `getGame(gameId)` which hits `GET /api/games/{gameId}`
2. Gets back full presigned R2 URL in `gameData.videos[0].video_url`
3. Optionally appends `#t={seekTime}` media fragment (line 452) -- browser hint only, doesn't limit download
4. Sets `annotateVideoUrl` which loads into `<video>` element
5. Browser issues open-ended Range requests against R2 and downloads the **entire file**

### Existing bounded proxy (T1430) -- use this as the pattern

The project clip streaming proxy is at [clips.py:1600-1831](src/backend/app/routers/clips.py#L1600):

```
GET /api/clips/projects/{project_id}/clips/{clip_id}/stream
```

It implements a three-window strategy:
- **Moov head**: bytes 0 to 10MB (covers faststart moov)
- **Moov tail**: last 10MB (covers moov-at-end)
- **Clip window**: bytes around the clip's time range, converted via `(time / duration) * size`, with padding (2s pre, 5s post, 5MB floor)

Any request outside all three windows returns 416. The browser sees a clamped `Content-Length` and stops buffering.

The route decision lives in [videoLoadRoute.js:36-57](src/frontend/src/utils/videoLoadRoute.js#L36). Currently game clips always use proxy; annotate mode does not.

### What to build

**New backend endpoint** -- a bounded streaming proxy for annotation playback. Unlike the clip proxy which serves one clip, this serves multiple annotation clip ranges from a game video.

Suggested path:
```
GET /api/games/{game_id}/stream?t={seekTime}
```

The endpoint:
1. Looks up the game's blake3_hash, video_duration, video_size from the games/game_videos tables
2. Looks up ALL raw_clips for this game owned by the requesting user (need user_id from auth context) to get the set of clip time ranges
3. Builds allowed windows: moov head (0-10MB), moov tail (last 10MB), and a clip window for each raw_clip (with padding)
4. Optionally merges overlapping/adjacent clip windows to reduce complexity
5. On each browser Range request, checks if the requested range falls in an allowed window. If yes, proxies from R2 with clamped Content-Length. If no, returns 416.
6. Generates presigned URL via `get_game_video_url(blake3_hash, video_filename)`

**Key differences from the clip proxy:**
- Multiple clip windows instead of one (merge overlapping ranges)
- Looks up clips by game_id + user_id, not by clip_id
- The `t` query param tells the endpoint which clip the browser is targeting first (useful for prioritizing which window to serve if there are many clips)

**Frontend changes** -- wire annotate mode to use the proxy:

In [AnnotateContainer.jsx:389-458](src/frontend/src/containers/AnnotateContainer.jsx#L389), after getting the game data:

```javascript
// Instead of using the raw presigned URL:
// const seekHintUrl = `${videoUrl}#t=${pendingClipSeekTime}`;

// Use the bounded proxy:
const proxyUrl = `${API_BASE}/api/games/${gameId}/stream${pendingClipSeekTime != null ? `?t=${pendingClipSeekTime}` : ''}`;
setAnnotateVideoUrl(proxyUrl);
```

The raw presigned URL (`videoUrl`) is still needed for the warm URL lookup and for `videoLoadRoute.js` compatibility. You may want to extend `chooseLoadRoute()` or bypass it for annotate mode.

### Data available for clip window calculation

The `GET /api/games/{gameId}` response ([games.py:1021-1088](src/backend/app/routers/games.py#L1021)) already includes:
- `video_duration`, `video_size`, `video_width`, `video_height`
- `videos[].duration`, `videos[].video_url` (for multi-video)
- `annotations[]` with clip data

The raw_clips table has `start_time` and `end_time` per clip. Query:
```sql
SELECT start_time, end_time FROM raw_clips
WHERE game_id = ? AND user_id = ?
ORDER BY start_time
```

For shared games, use the sharer's profile to find clips (the materialized clips in the recipient's profile should have matching times from `clip_data`).

### Expected improvement

For a game with 3 clips totaling 15 seconds in a 300-second, 8.7MB video:
- Current: downloads all 8.7MB
- Bounded: downloads ~450KB of clip data + 10MB moov head (capped at actual moov size, typically <1MB for faststart files) + padding
- Estimated: **~1-2MB instead of 8.7MB** -- 4-8x less data

Combined with Fix 1 (pre-warmed edge), annotation playback startup should drop from 16s to 1-2s.

---

## Files to Modify

| File | Fix | Change |
|------|-----|--------|
| `src/backend/app/routers/shares.py:241-289` | 1 | Add `video_warm_url` (presigned R2 URL) to shared teammate response |
| `src/frontend/src/components/SharedAnnotationView.jsx:42` | 1 | Fire `Range: bytes=0-1023` warm fetch on share page load |
| `src/backend/app/routers/games.py` | 2 | **NEW endpoint** `GET /api/games/{game_id}/stream` -- bounded proxy for annotate playback |
| `src/frontend/src/containers/AnnotateContainer.jsx:389-458` | 2 | Use proxy URL instead of raw presigned URL for annotate video loading |
| `src/frontend/src/utils/videoLoadRoute.js` | 2 | Possibly extend `chooseLoadRoute()` for annotate proxy route |

## Key Reference Files

| File | What's There |
|------|-------------|
| [clips.py:1600-1831](src/backend/app/routers/clips.py#L1600) | Existing bounded proxy (T1430) -- **copy this pattern** for the annotate proxy |
| [videoLoadRoute.js](src/frontend/src/utils/videoLoadRoute.js) | Route decision logic (proxy vs direct) |
| [cacheWarming.js](src/frontend/src/utils/cacheWarming.js) | Cache warming system -- `warmUrl()` at line 342, `warmClipRange()` at line 399 |
| [useVideo.js:216-298](src/frontend/src/hooks/useVideo.js#L216) | Video load path -- chooseLoadRoute integration, foreground priority |
| [shares.py:241-289](src/backend/app/routers/shares.py#L241) | Share teammate endpoint (add video_warm_url here) |
| [games.py:54-68](src/backend/app/routers/games.py#L54) | `get_game_video_url()` -- presigned URL from blake3_hash |
| [games.py:1021-1088](src/backend/app/routers/games.py#L1021) | `GET /api/games/{gameId}` response structure |

## Implementation Order

1. **Fix 1 first** (pre-warm) -- small change, immediate impact, no risk
2. **Fix 2 second** (bounded proxy) -- bigger change, reuses T1430 pattern, higher impact

## Testing

- **HAR comparison**: Record a HAR of shared annotation playback before and after. Video download time should drop from 16s to 2-4s (Fix 1) or 1-2s (Fix 1+2).
- **Fix 1 unit test**: Verify `GET /api/shared/teammate/{token}` response includes `video_warm_url` field with a valid presigned R2 URL when `game_blake3` is present.
- **Fix 2 unit test**: Verify `GET /api/games/{id}/stream` returns 206 for in-window ranges and 416 for out-of-window ranges. Copy test patterns from `test_t1690_stream_proxy_probe.py`.
- **Manual test**: Open a shared annotation link in an incognito window. Measure time from page load to video playing. Should be under 5s on a reasonable connection.
