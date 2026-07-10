# T4775: My Reels — Dedup `rank/confidence` + Defer Stream Warming

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Parent:** T4770 (Stage B fan-out). Evidence: [T4770-delay-ledger.md](T4770-delay-ledger.md) row 5.
**Priority:** MEDIUM-LOW — later in the funnel, but a cheap win.

## Problem (measured)

Opening My Reels: `myreels:clicked → myreels:settled ≈ 2513ms`.

HAR evidence (T4770 cold walkthrough):
- `GET /api/rank/confidence` fired **3× in the same window** (`wait≈475–1052ms` each) — duplicate/redundant calls.
- Plus the `warmAllUserVideos` storm (`working_video/stream` for 47/50/49, `wait≈815–839ms`) contending on the box (see **T4772**).
- `GET /api/downloads` (the actual reels list) is fast (~100ms live) — it's NOT the bottleneck.

## Fix class: code (dedup / in-flight guard) + load-ordering

1. **Dedup `rank/confidence`** — find the callers (collections/rank hooks; `src/frontend/src/hooks/useCollections.js`, `useDownloads.js`, ranking components) and add an in-flight guard / single-fetch so opening My Reels issues it once, not 3×.
2. **Defer stream warming** off the My Reels open — this overlaps with **T4772** (do that first; then confirm the storm is gone from this window).

## Injected expertise (from T4770)

- The downloads list itself is fast; the wait is duplicate `rank/confidence` + the warm storm. Don't "optimize" `/api/downloads` — it's fine (T3760 guard: fix the real cause).
- In-flight dedup precedent: `gamesDataStore` `loadGame` is inflight-deduped (`.claude/knowledge/annotate.md`) — reuse the pattern for `rank/confidence`.

## Constraints

- **Read/load-path only. No reactive persistence.**

## Verify

Re-run the T4770 walkthrough (after T4772); confirm `rank/confidence` fires once and `myreels:clicked→settled` shrinks.

## Acceptance criteria

- [ ] `GET /api/rank/confidence` issues once per My Reels open (in-flight deduped).
- [ ] `myreels:clicked→settled` drops materially vs the T4770 baseline.
- [ ] No reactive persistence; read-path only.
