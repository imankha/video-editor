# T1690: Video Stream Proxy Returns Broken 206 on R2 Failure

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-21

## Problem

User reports "Video not loading" / "Video format not supported" on staging. Both the working video and clip video fail with `MEDIA_ERR_SRC_NOT_SUPPORTED` (code=4) within 32-66ms.

**Screenshot:** Framing mode, "Video failed to load" / "Video format not supported."

## Log Evidence

```
[ERROR] [VIDEO] Error: Video format not supported.
  {"code":4,"kind":"format-error","rawMessage":"MEDIA_ELEMENT_ERROR: Format error",
   "url":"https://reel-ballers-api-staging.fly.dev/api/projects/3/working_video/stream",
   "isBlob":false,"retryAttempt":0}

[WARN ] [VIDEO_LOAD] error id=1 elapsedMs=32 code=4 kind=format-error

[ERROR] [VIDEO] Error: Video format not supported.
  {"code":4,"kind":"format-error","rawMessage":"MEDIA_ELEMENT_ERROR: Format error",
   "url":"https://reel-ballers-api-staging.fly.dev/api/clips/projects/3/clips/5/stream",
   "isBlob":false,"retryAttempt":0}

[WARN ] [VIDEO_LOAD] error id=1 elapsedMs=66 code=4 kind=format-error
```

### Key signals

| Signal | Meaning |
|--------|---------|
| 32-66ms failure time | Browser rejected the response almost instantly — not a timeout or buffering issue |
| code=4 on BOTH endpoints | Both working video AND clip video failed simultaneously |
| `isBlob: false` | URLs are server proxy URLs, not blob URLs — rules out stale blob |
| Same project (3), same session | Suggests a project-level or R2-level issue, not a codec problem |

## Root Cause Analysis

### Browser code=4 is misleading

The browser's `MEDIA_ERR_SRC_NOT_SUPPORTED` (code=4) fires for ANY response the browser can't parse as a video container — not just unsupported codecs. This includes:

- HTTP 404/500 error responses (HTML/JSON body)
- R2 XML error responses streamed through as `video/mp4`
- Empty/truncated responses from aborted streams
- HTTP 403 from expired presigned URLs

The game video was previously playable in the browser, so the format IS supported. The error is from the proxy returning non-video data, not from an unsupported codec.

### Bug: Stream proxy commits to 206 before checking R2

Both `stream_working_clip_bounded` ([clips.py:1515](src/backend/app/routers/clips.py#L1515)) and `stream_working_video` ([projects.py:951](src/backend/app/routers/projects.py#L951)) create a `StreamingResponse` with `status_code=206, media_type="video/mp4"` headers BEFORE the async generator connects to R2.

```python
# The generator is lazy — R2 connection happens AFTER headers are sent
async def stream_from_r2():
    async with httpx.AsyncClient(...) as client:
        async with client.stream("GET", presigned_url, ...) as response:
            if response.status_code not in (200, 206):
                raise HTTPException(...)  # TOO LATE — 206 headers already sent!
            async for chunk in response.aiter_bytes(...):
                yield chunk

return StreamingResponse(stream_from_r2(), status_code=206, media_type="video/mp4", ...)
```

When R2 rejects the request (403 expired URL, 404 missing file, 500 outage):
1. Browser receives HTTP 206 + `video/mp4` + `Content-Range` headers
2. Generator starts, connects to R2, gets error
3. `raise HTTPException` inside generator — but uvicorn already sent 206 headers
4. Generator dies, stream aborts
5. Browser received valid 206 headers but 0 bytes of video body
6. Browser fires `MEDIA_ERR_SRC_NOT_SUPPORTED` (code=4)

### Clip stream has no R2 probe

The `stream_working_video` endpoint does a 1-byte probe to R2 first ([projects.py:1001](src/backend/app/routers/projects.py#L1001)), which catches R2 errors early (before StreamingResponse is created). However, `stream_working_clip_bounded` has **no probe** — it goes straight to the streaming generator. Any R2 error on clip stream is guaranteed to produce a broken 206.

### No backend logging when R2 fails inside generator

Neither endpoint logged anything when R2 returned an error inside the generator. The HTTPException was raised in the generator context where it can't produce a proper HTTP response, and there was no `logger.error()` call. We had zero server-side visibility into these failures.

**Diagnostic logging added** (this task): Both generators now log R2 status, content-type, and error body snippet when R2 returns non-200/206. Deploy to staging to capture the actual failure reason on next occurrence.

## Likely R2 Failure Reasons

Need staging logs to confirm. Candidates:

1. **Game video deleted/missing from R2** — R2 returns 404, proxy streams nothing
2. **Presigned URL issue** — URLs are generated fresh per request (4h game / 1h working), unlikely to expire mid-request but possible under high latency
3. **R2 outage/rate limit** — Temporary 503/429 from R2
4. **DB record points to non-existent file** — `blake3_hash` or `filename` references a file that was never uploaded or was cleaned up

## Fix Plan

### Phase 1: Deploy diagnostic logging (DONE — needs deploy)

Logging already added to both generators in `clips.py` and `projects.py`. Deploy to staging and wait for reproduction.

### Phase 2: Add R2 probe to clip stream

Add a 1-byte `Range: bytes=0-0` probe to `stream_working_clip_bounded` (same pattern as `stream_working_video`). If R2 returns an error, return a proper HTTP error response BEFORE creating StreamingResponse. This turns a broken 206 into a clean 404/502/etc that the frontend can classify correctly.

### Phase 3: Frontend error classification improvement

The `videoErrorClassifier.js` maps code=4 on non-blob URLs to `FORMAT_ERROR`. This is misleading when the actual cause is an HTTP error from the proxy. Consider:
- Having the frontend do a HEAD request when it gets code=4, to distinguish "proxy returned error" from "codec unsupported"
- Or: have the backend return a specific error response (not 206) so the browser returns code=2 (MEDIA_ERR_NETWORK) instead of code=4

## Files

| File | Changes |
|------|---------|
| `src/backend/app/routers/clips.py` | Diagnostic logging added (done); R2 probe (Phase 2) |
| `src/backend/app/routers/projects.py` | Diagnostic logging added (done) |
| `src/frontend/src/utils/videoErrorClassifier.js` | Improve code=4 classification (Phase 3, optional) |

## Reproduction Steps

1. Open project 3 on staging
2. Enter Framing mode
3. If video loads, the issue is intermittent (R2 was available this time)
4. Check backend logs for `[clip-stream] R2 error` or `[working-video-stream] R2 error` entries

## Related

- T1670 (Overlay Stuck Loading After Export) — separate bug but same video loading code path
- T1533 (Overlay Working Video Slow Load) — different root cause (Chrome priority, not proxy error)

## Classification

**Stack Layers:** Backend, Frontend
**Files Affected:** ~3 files
**LOC Estimate:** ~30 lines
**Test Scope:** Backend Unit (mock R2 responses, verify proper HTTP errors returned)
