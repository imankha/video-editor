# T4774: Editor Video First-Paint Main-Thread Gap (Framing + Overlay ~1.5s)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Parent:** T4770 (Stage B fan-out). Evidence: [T4770-delay-ledger.md](T4770-delay-ledger.md) row 4.
**Priority:** MEDIUM — the "video appeared but the screen takes a beat to settle" feeling in both editor screens.

## Problem (measured)

After the `<video>` is ready, both editor screens spend ~1.5s "settling" with **no network in flight**:
- `framing:videoReady → framing:settled ≈ 1513ms`
- `overlay:videoReady → overlay:settled ≈ 1524ms`

HAR evidence (T4770 cold walkthrough + `attribute.py`): both windows are flagged **GAP (no request in flight)** — the video bytes are already fast (framing = `games/{hash}.mp4` R2 206, `wait(TTFB)=110ms`). So this is **main-thread/JS work**, not a latency cost: crop keyframe / highlight region / canvas setup after `loadeddata`.

## Fix class: code (defer/reorder) + perceived-perf

- Profile the main-thread work between `loadeddata` and interactive (React commit + crop/highlight hydration + canvas init). Candidate sources: `src/frontend/src/screens/FramingScreen.jsx`, `OverlayScreen.jsx`, keyframe hydration (`keyframe-data-model` skill), canvas/overlay renderers.
- Move non-critical setup off the first-paint path (idle/`requestIdleCallback`, or after first frame), or code-split heavy editor modules so they don't block interactivity (T3990/T4000 preload precedent — a warmed chunk means less main-thread parse on open).
- If the work is irreducible, show a determinate progress state so the beat is legible rather than a frozen frame (reuse `VideoLoadingOverlay`/`SegmentedProgressStrip`).

## Injected expertise (from T4770)

- This is a **JS/main-thread gap**, classified by the overlap step finding **no request in flight** during the window — do NOT look for a slow request here (there isn't one). Confirm with a Playwright/DevTools main-thread profile.
- **Preload precedent (T3990/T4000):** idle-preload editor route chunks on home so the first open reuses a cached module and pays less parse cost.
- Keyframe model: `src/frontend/.claude/skills/keyframe-data-model` (frame-based, origins, state machine) — hydration here is a likely cost center.

## Constraints

- **Read/load-path only. No reactive persistence** — runtime fixups (`ensurePermanentKeyframes`, origin normalization) are memory-only and must NOT trigger any write while you reorder setup (CLAUDE.md persistence rule; T350 corruption precedent).

## Verify

Re-run the T4770 walkthrough; diff `framing:videoReady→settled` and `overlay:videoReady→settled`. Capture a main-thread profile to attribute the remaining gap.

## Acceptance criteria

- [ ] The post-video main-thread gap in Framing and Overlay drops materially (or is covered by a determinate progress state).
- [ ] No functional regression in crop/highlight hydration; no reactive persistence introduced.
