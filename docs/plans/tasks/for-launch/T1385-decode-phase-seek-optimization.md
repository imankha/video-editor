# T1385: Decode-Phase Seek Optimization

**Status:** TODO
**Parent:** T1260 Video Seek Optimization
**Depends on:** T1380 (complete) — faststart eliminated network as the seek bottleneck

## Context

After T1380 shipped, steady-state seek latency on a 3GB Trace video (Chromium, R2 streaming with warm edge cache):

| Component | Typical | Range |
|---|---|---|
| Network | ~8ms | 4–16ms |
| Decode  | ~220ms | 170–320ms |
| **Total** | **~230ms** | 175–320ms |

Decode dominates by an order of magnitude. The browser's H.264 demuxer must read from the nearest keyframe preceding the seek target and decode forward until the target frame is ready. Keyframe interval on Trace exports appears to be ~2s; at a GOP boundary that's ~60 frames of decode work.

## Goal

Drive p95 seek latency from ~320ms down to <150ms on 3GB videos without regressing upload cost or storage cost meaningfully.

## Candidate Approaches (to investigate in order)

### A. Decoded-frame cache (client-side)
Keep the last N decoded frames around a given seek target in memory. Back-and-forth scrubbing in the same neighborhood (common for Annotate clip trimming) then becomes a cache hit — near-instant.

- **Cost:** Memory (~5–20MB for a second of 1080p decoded frames).
- **Risk:** WebCodecs required; requires re-architecting the player away from the native `<video>` tag for at least the scrub path.
- **Expected gain:** Huge on repeat seeks, zero on first seek.

### B. Keyframe density on ingest
Re-encode uploaded videos with tighter GOP (e.g., 1s instead of 2s). Halves the worst-case decode work.

- **Cost:** ~5–10% file size increase; requires server-side encode (Modal), which is the exact cost we've been avoiding.
- **Risk:** Ingest becomes slow/expensive; not compatible with the "free ingest" philosophy for Annotate.
- **Verdict:** Only consider for Framing exports, not Annotate sources.

### C. Predictive pre-seek (cheap, experimental)
When the user drags the scrub bar, issue a speculative `video.currentTime = t` a frame or two ahead of where we think they'll land. The browser starts decode early; by the time they release, the frames are already ready.

- **Cost:** Negligible.
- **Risk:** Wasted decode if prediction is wrong; could fight the user's actual seek.
- **Expected gain:** Perceived latency drop during scrubbing, little effect on single-click seeks.

### D. WebCodecs-based scrubber (advanced)
Replace `<video>` with a `VideoDecoder` + `<canvas>` for the scrub path. Decode directly to requested frame, bypass HTMLMediaElement buffering heuristics.

- **Cost:** Significant implementation effort; Safari support caveats.
- **Expected gain:** Full control over decode budget; could hit sub-100ms seeks.

## Instrumentation (Gate)

**T1261 seek-perf instrumentation must be on the branch** for this task. Without the `decode` / `network` split, we can't tell which candidate helped or hurt. Plan: branch from `feature/T1260-video-seek-optimization` (which keeps `seekPerf` live), not from master.

## Proposed Plan

1. Revive `feature/T1260-video-seek-optimization` branch from current tip; merge latest master.
2. Start with **Approach C** — lowest risk, fastest to test, could deliver a perceived win.
3. If C gates on decode floor, prototype **Approach A** for the scrub-heavy code paths (Annotate clip boundary tweaks, Framing keyframe scrub).
4. Only consider B or D if A/C don't close the gap.

## Measurement

Baseline (post-T1380, warm edge): 231ms avg / 320ms p95 / 175–320ms range.
Target: <150ms p95.
Metric source: `[SeekPerf] … latency= … network= … decode= …` log lines + `__seekPerfReport()`.
