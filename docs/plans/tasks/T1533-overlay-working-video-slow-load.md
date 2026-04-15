# T1533 - Overlay Working Video Slow First-Load

**Status:** TODO
**Priority:** 2.0 (Impact 6, Cmplx 3)

## Symptom

After a multi-clip framing export finishes and the user opens Overlay, `extractVideoMetadataFromUrl` hits its 15s timeout — `readyState=0 networkState=2` — then eventually succeeds on a later load. User-visible delay before overlay becomes interactive; first attempt may show "Failed to load working video".

## Evidence

HAR capture (2026-04-15 project_id=6, working_videos/working_6_b94811b4.mp4):

- R2 responds 206 Partial Content, Content-Type video/mp4, 20,718,476 bytes, ETag multipart (`-3` suffix, `x-amz-mp-parts-count: 3`).
- Browser issues a long chain of small (~360 KB) range-seek requests before metadata becomes available.
- Backend presigns the URL in ~10ms (`GET /api/projects/6` REQ_TIMING clean).
- Modal concat already runs `ffmpeg -c copy -movflags +faststart` ([video_processing.py:2615-2623](../../src/backend/app/modal_functions/video_processing.py#L2615-L2623)).

## Hypothesis

`+faststart` with `-c copy` does a two-pass rewrite to relocate the moov atom to the head. On a multi-part boto3 upload (10 MB+ triggers multipart by default), the resulting object may land with moov still mid-file, or the first range probe lands outside the moov region and the browser walks the file in 360 KB chunks chasing it. Net effect: metadata parse requires the full 20 MB over the Cloudflare edge before `loadedmetadata` fires.

Alternative: CF edge on first hit is cold for this key; subsequent loads are fast because the object is cached.

## Investigation steps

1. Download the exact output file from R2 and run `ffprobe -v trace -i file.mp4 2>&1 | head -200` + `mp4dump` (or `AtomicParsley -T`) to confirm the moov atom offset. If moov is at EOF, faststart isn't taking effect.
2. Compare: `ffmpeg -i concat_list -c copy +faststart` vs. post-process `qt-faststart` vs. re-encode path (line 2627) — which actually produces head-moov reliably?
3. Measure R2 cold vs warm GET latency for the same key to rule out edge caching as the dominant factor.
4. Check boto3 multipart threshold — if we can force single-part upload for files < 100 MB the part-count noise disappears.
5. Instrument `extractVideoMetadataFromUrl` to log time to `loadedmetadata` and bytes transferred so we have first-class numbers, not HAR spelunking.

## Candidate fixes (pick after investigation)

- **A. Enforce head-moov post-upload.** After concat, run `qt-faststart` explicitly (or use `ffmpeg -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof`) and verify with `mp4dump` before uploading.
- **B. Re-encode on concat.** Always take the re-encode branch (line 2627) which produces a clean single-pass faststart; costs GPU time but eliminates range-walk.
- **C. Upload as single-part.** Raise boto3's `multipart_threshold` for output uploads so small working videos are single-part (cleaner byte-range behaviour on some CDNs).
- **D. Prefetch head range on presign.** Frontend fires a `Range: bytes=0-1048576` GET before attaching the URL to the `<video>` element, forcing CF edge warm-up.

## Out of scope

- Progress indicator during metadata load (separate UX task if needed).
- Raising the 15s timeout — masks the problem, doesn't fix it.

## Related

- T1530 (comprehensive profiling): once frontend User Timing is in, we'll have time-to-loadedmetadata per load.
- T1520 (export disconnect UX): surfaces overlay-load failures today as generic "failed" toasts.
