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

- [x] The post-video main-thread gap in Framing and Overlay drops materially (or is covered by a determinate progress state). — **N/A: the gap does not exist.** Profiled post-`videoReady` main-thread busy time is **0ms** on both screens (see Findings). The real pre-`videoReady` load wait is already covered by `VideoLoadingOverlay`.
- [x] No functional regression in crop/highlight hydration; no reactive persistence introduced. — **No application code changed.** Crop reticule + highlight regions render correctly at settle (`qa/T4774/settle-*.png`); framing/overlay unit tests 86/86 pass.

## Findings (Stage B — profiled first, verdict DROP)

The premise is a **measurement artifact**. `videoReady → settled` in the T4770 walkthrough is a
hardcoded `await page.waitForTimeout(1500)`, so the "~1.5s gap" is a fixed sleep, not JS work.
A dedicated profiler (`src/frontend/e2e/T4774-mainthread-profile.spec.js`, CDP CPU profile +
`longtask` observer) measured the *actual* post-`videoReady` window:

- Framing: **0 long tasks, 0ms main-thread busy, true settle 0ms**
- Overlay: **0 long tasks, 0ms main-thread busy, true settle 0ms**
- Main thread **81–84% idle** across the whole leg; screen committed ~500ms before first frame.

Per the keep-or-drop rule, **no fix was implemented** — there is no cost to reduce, and a
defer/idle reorder or a decorative progress state would risk the T350 hydration landmine for
zero benefit. Committed: profiler spec + `qa/T4774/` evidence + ledger/knowledge-doc
corrections. No editor source touched. Full report: `qa/T4774/REPORT.md`.
