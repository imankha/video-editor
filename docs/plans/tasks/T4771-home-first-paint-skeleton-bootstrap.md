# T4771: Home First Paint — Games Skeleton + Split/Parallelize Bootstrap

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Parent:** T4770 (Stage B fan-out). Evidence: [T4770-delay-ledger.md](T4770-delay-ledger.md) row 1.
**Priority:** TOP — earliest wait in the funnel; every new user hits it before investing anything. Also satisfies the T4770 acceptance criterion "initial home screen has a real preloader/skeleton."

## Problem (measured)

On cold landing, games appear **~1743ms** after navigation (warm: ~1594ms — barely better, so this is **server-bound, not asset-bound**), and the screen is **blank** until then.

Attribution (T4770 walkthrough + live re-timing):
- The games list is gated on `GET /api/bootstrap` → `useGamesDataStore.getState().setFromBootstrap(data.games)` (`src/frontend/src/App.jsx:210`).
- **Live re-time: `/api/bootstrap` = 850–1122ms TTFB on EVERY call (stable), while co-timed `/api/health` = 47–105ms** → genuine endpoint work, not a shared-vCPU spike.
- `bootstrap()` (`src/backend/app/routers/bootstrap.py:24`) serially aggregates: profiles → quests (loops `QUEST_DEFINITIONS`) → `list_projects()` → `list_games_metadata()` → active exports → unacknowledged exports → pending uploads. ~1s total, tiny body (15KB).
- No skeleton renders while waiting → the "blank screen then pop" the user complains about.

## Two independent problems, two fixes

1. **Perceived-perf (do this first, cheapest win):** render a **games-list skeleton** immediately on Home so the screen is never blank. Perceived speed beats shaving ms. Reuse `SegmentedProgressStrip`/existing loading components; match the GameCard grid shape.
2. **Real latency:** get games in front of the user before the heavy tail of bootstrap. Options (pick per design gate):
   - **Split bootstrap** so the games+profiles slice returns first (render), and exports/uploads/quests stream in after; OR
   - **Parallelize** bootstrap's internal queries (they're independent reads across profile SQLite + user SQLite) instead of serial `await`s; OR
   - Let the games store hydrate from a fast dedicated path first, with bootstrap enriching the rest.

## Injected expertise (from T4770)

- **Confirmed physics:** bootstrap is the one genuinely slow endpoint (~1s); `/api/games`, `/api/games/{id}/load`, `/api/games/{id}/video` (302), `/api/downloads` are all ~100ms live. Do NOT "defer presigning" — `list_games` isn't on the home path (bootstrap uses `list_games_metadata`, no presign) and presigning re-times ~100ms anyway. That original suspect is **ruled out**.
- **StrictMode caveat:** `main.jsx:24` double-invokes effects in dev, so you'll see bootstrap called 2× locally. Prod calls it once — do NOT add a "dedupe bootstrap" fix chasing the dev artifact. Measure the SINGLE-call cost.
- **Preload precedent:** T3990/T4000 preload editor chunks on home idle.

## Constraints

- **Read/load-path only. No reactive persistence** — no `useEffect`→API write to "warm" or "cache" (CLAUDE.md; T4000 §4). The skeleton is pure render; the bootstrap change is read-path.
- If you split/parallelize bootstrap, keep it a single logical read; don't introduce a second writer.

## Verify

Re-run the T4770 walkthrough (`bash scripts/dev-verify.sh e2e/T4770-new-user-flow-perf-walkthrough.spec.js`) and diff `home:gotoStart → home:gamesVisible` (and confirm a skeleton is on screen at `home:appShell`). Backend: re-time `/api/bootstrap` after parallelizing; co-time `/api/health`.

## Acceptance criteria

- [ ] Home shows a games skeleton at first paint (never blank-then-pop).
- [ ] Measured `home:gamesVisible` drops materially vs the T4770 baseline (or games render progressively behind the skeleton).
- [ ] `/api/bootstrap` internal work parallelized or split (evidence: before/after live TTFB, co-timed with `/health`).
- [ ] No reactive persistence introduced; changes are read-path only.
