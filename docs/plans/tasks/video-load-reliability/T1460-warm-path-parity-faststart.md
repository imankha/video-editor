# T1460: Close Remaining Trace Load Gap — Warm-Path Miss + Faststart Route Choice

**Status:** TESTING
**Epic:** [Video Load Reliability](EPIC.md)
**Created:** 2026-04-14
**Updated:** 2026-04-14

## Shipped

- Issue 1 fix: `pushClipRanges` tags warm entries with `clipId`; `warm_status` now reports `clipWarmed=true` on warm reload (commits `3a16ecb`, `a6d0fe3`, `795b259`, merged `aae016a`).
- Route decision moved into `useVideo` via `src/frontend/src/utils/videoLoadRoute.js` with verdicts `DIRECT_WARM` / `DIRECT_FORCED` / proxy fallback.
- `?direct=1` A/B override implemented.

## Remaining

- Collect 5–10 cold + warm samples with and without `?direct=1`, compare `[VIDEO_LOAD] playable elapsedMs` medians, and hard-code the winning route for faststart files (or document that warm-path hit rate makes the question moot).

## Problem

After T1450 flipped every legacy Trace game to faststart on R2, Trace
framing load dropped from 3.2s → **2.95s**, but Veo warm-path is ~2.0s
(and can be 0.6s when fully warm). Two issues remain:

### Issue 1 — Warmer tags clip ranges with `clipId=null`

From the post-T1450 log:

```
[CacheWarming] Warmed clip clipId=null url=https://...r2... range=1249...-1254... elapsedMs=1336
[VIDEO_LOAD] warm_status id=1 clipWarmed=false rangeCovered=false urlWarmed=false clipRanges=0
```

The warmer does the work (fetches the correct clip byte range) but does
not record which `clipId` the range belongs to. When
`loadVideoFromStreamingUrl` calls `getWarmedState(url)` it finds no
match, reports `clipWarmed=false`, and falls through to the cold-path
proxy — even though the bytes were just warmed.

**Fix:** trace why `clipId` is null in the `pushClipRanges` →
`warmClipRange` path. Likely a missing field on the tier-1 project-clips
queue entry. Once fixed, `warm_status` should report true and we bypass
the proxy for a direct-to-R2 fast load.

### Issue 2 — Is the proxy ever the wrong choice for faststart files?

The T1430 proxy was designed for cold-path cases where the browser
would otherwise over-fetch 1.88GB of media for an 8s clip. For
moov-at-end files this was unambiguous — the browser makes two round
trips (head + tail) and still over-reads. For **faststart** files, the
proxy's value is bounding the clip-body byte range so the browser
doesn't speculatively fetch beyond it.

Open question: for a faststart file where the URL has been tail/head
warmed in the browser's R2 PoP, does a direct presigned URL load faster
than the proxy?

- **For proxy:** bounded Content-Length → no speculative overfetch.
- **Against proxy:** extra Fly→R2 hop, and Fly's R2 PoP is cold even
  when the browser's PoP is warm.

We have telemetry (`[VIDEO_LOAD] playable elapsedMs=...`,
`[FaststartCheck] verdict=...`, `warm_status`) to measure this. The
right answer isn't "always skip proxy for faststart" or "always use
proxy" — it's measure both for a few cold and warm loads and pick
whichever wins on average.

## Proposed investigation

1. **Fix Issue 1 first** (cheap). Warm-path should immediately bring
   Trace load down to ~0.6s like Veo when the warmer finishes before
   the user clicks.
2. **Re-measure.** With Issue 1 fixed, how often is the warm-path
   actually hit? If the warmer usually beats the user click, the proxy
   question is moot.
3. **A/B measure proxy vs direct** for cold faststart loads. Add a
   query-string flag (`?direct=1`) to bypass the proxy and log
   elapsedMs side-by-side. Collect 5-10 samples each way, pick winner.

## Acceptance

- [ ] After fix, `[VIDEO_LOAD] warm_status clipWarmed=true` appears on
      reloads where the warmer finishes first.
- [ ] Warm-path Trace load matches warm-path Veo (≤ 1s).
- [ ] Documented measurement shows whether proxy or direct-to-R2 wins
      for cold faststart loads, with the code routing to the winner.

## Files likely affected

- `src/frontend/src/utils/cacheWarming.js` — clip-range warmer tagging
- `src/frontend/src/hooks/useVideo.js` — `warm_status` lookup + route choice
- `src/frontend/src/screens/FramingScreen.jsx` — `getClipVideoConfig` route decision

## Out of scope

- Altering the proxy windowing logic (three-window proxy from T1430/T1440
  is correct; this task only decides when to use it).
- Server-side R2 edge prewarming (separate infra concern).

## Context

- Post-T1450 verification 2026-04-14: Trace faststart, load 2.95s.
- Veo parity (fully warm): 0.6s per T1430 final measurement.
- Warmer telemetry lives in `[CacheWarming] Warmed clip ...` lines
  introduced in T1430 Step 1.
