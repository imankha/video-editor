# T1260: Video Seek Optimization (Epic)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-09
**Updated:** 2026-04-09

## Problem

In Annotate mode, users watch full 60-90 min VEO game videos and randomly seek to find when their kid enters/leaves the game. Each seek stalls for 1-5+ seconds because every range request goes to R2 origin with no local caching, and cache warming fetches imprecise byte ranges.

### What's NOT the problem

VEO cameras output **2.5s keyframe intervals** (GOP=75 at 29.97fps). Decode time is ~150-250ms — well within target. The bottleneck is **network**, not decode. Re-encoding costs $0.05/video which doesn't pencil at 5% monetization. CDN edge caching doesn't help (512 MB Cloudflare limit vs 1-3 GB files).

## Approach: Measure → Change → Prove → Repeat

Each subtask is independently deployable and must **prove it helped** before we commit to the next one. Every subtask has:

1. **Before measurement** — quantify the specific metric this subtask targets, using the instrumentation from T1261
2. **Implementation** — the code change
3. **After measurement** — re-run the same test protocol, compare numbers
4. **Go/no-go decision** — if the numbers don't improve meaningfully, we can revert or skip dependent work

If T1262 (SW cache) alone gets us to acceptable seek latency, we can defer T1264 and T1265.

## Subtasks

| ID | Task | What it proves | Key metric | Depends on |
|----|------|---------------|------------|------------|
| T1261 | [Seek Perf Instrumentation](T1261-seek-perf-instrumentation.md) | We can measure seek latency | Baseline: avg/p95 seek latency in ms | — |
| T1262 | [Service Worker Video Cache](T1262-service-worker-video-cache.md) | Local caching eliminates repeat-seek latency | Repeat seek: 1-5s → <50ms | T1261 |
| T1263 | [SW Quota Management](T1263-sw-quota-management.md) | Cache doesn't fill up the disk | Videos evicted LRU, current game survives | T1262 |
| T1264 | [Moov Atom Parsing](T1264-moov-atom-parsing.md) | Precise warming → higher cache hit rate | Warming accuracy: error in MB, hit rate % | T1261, T1262 |
| T1265 | [Predictive Prefetch](T1265-predictive-prefetch.md) | Forward seeks within 30s are instant | Forward seek: 1-5s → <50ms | T1262, T1264 |

### Execution order

```
T1261 (instrumentation — gives us the ruler)
  ↓
T1262 (SW cache — biggest impact, makes repeat seeks instant)
  ↓
  ├── T1263 (quota management — housekeeping, quick)
  ↓
T1264 (moov parsing — makes warming precise, measure if it matters)
  ↓
T1265 (predictive prefetch — makes forward seeks instant, measure if needed)
```

**Exit points:** After T1262, check if seek latency is acceptable for the user's workflow. If repeat seeks are instant and first-visit seeks are tolerable (~1-2s), T1264 and T1265 may not be worth the added complexity.

## Per-mode impact summary

| Mode | T1262 (SW cache) | T1264 (moov parsing) | T1265 (prefetch) |
|------|-----------------|---------------------|-----------------|
| **Annotate** | Backward seeks instant. Sequential playback builds cache. | Warming hits right bytes for clip regions. | Forward seeks within 30s instant. |
| **Framing** | Clip ranges viewed in Annotate are cached. Clip switching instant. | Clip byte ranges warmed precisely. | Not needed (clips are short). |
| **Overlay** | Working video cached on first load. Re-entry instant. | Not needed (small files). | Not needed (small files). |

## Research basis

Full research conducted across 5 dimensions. Key findings:
- CDN caching ineffective for >512 MB files (Cloudflare non-Enterprise)
- VEO GOP of 2.5s → decode is fine, network is the bottleneck
- Industry standard (Frame.io, Hudl, Descript) uses server-side proxies — too expensive at $0.05/video for 5% monetization
- Service Worker + Cache API is the only $0/video approach that makes repeat seeks instant
- Every platform transcodes on upload, but our VEO source encoding is already acceptable
