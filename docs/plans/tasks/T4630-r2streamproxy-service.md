# T4630: R2StreamProxy Service — One Streaming Proxy (with the Pooled-Client Perf Fix for All)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-03
**Source:** Audit item E7 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY][perf] The byte-window R2 streaming proxy (probe → Range parse → window math → httpx stream) is implemented 4× with 3 different client strategies:

- `clips.py:1767-1998` (~232 LOC in the handler), `projects.py:965-1110`, `games.py:2302-2508` (~200 LOC), `downloads.py:660+`
- **The TTFB fix reached 1 of 4:** downloads.py:646-657 pools its httpx client with a comment that per-request clients "were a big chunk of the stream TTFB" — clips.py:1874/:1959, projects.py:1015/:1080, games.py:2462 still create per-request clients. Users streaming game video / clips / working videos pay latency that reels don't.
- The TIER_2 retry-stream generator is duplicated verbatim: clips.py:1685-1711 ≡ downloads.py:589-615.

History: streaming 206 semantics have burned us before (T1690 — proxies committing to 206+headers before R2 responds, masking failures as "format not supported"). Consolidation must carry that fix everywhere too.

## Solution

`services/r2_stream_proxy.py`: `stream_r2_object(request, r2_key, *, user_id, ...) -> StreamingResponse` owning: pooled httpx client (module-level, downloads.py's pattern), Range parsing + window math, T1690's don't-commit-before-R2-responds behavior, and the retry generator. The four routes become thin: resolve their entity → key → call the service.

- Diff the four implementations FIRST (table in Progress Log): window sizes, header handling, error paths — intended differences (if any) become parameters.
- T1690's diagnostic logging must survive.

## Steps

1. [ ] Four-way diff table.
2. [ ] Service + tests: Range parsing cases (open-ended, suffix, multi-window), R2 error BEFORE headers committed (T1690 case), retry generator.
3. [ ] Migrate one route per commit (downloads first — it's closest to target); E2E video playback per surface after each (drive-app-as-user: scrub a game video, a clip, a reel).
4. [ ] Measure TTFB before/after on the three unpooled routes (HAR or profiling runbook) — the perf win is part of the deliverable; record numbers.

## Acceptance Criteria

- [ ] One proxy implementation; four thin routes
- [ ] All four pooled (TTFB improvement measured and recorded)
- [ ] T1690 error-masking behavior covered by a test against the service
- [ ] Scrubbing verified on all four surfaces (Range semantics are easy to subtly break)
