# T4770: New-User-Flow Perf Audit — Attribute Every Wait, Then Fan Out Fixes

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-07-04
**Updated:** 2026-07-04
**Priority:** TOP (user-designated 2026-07-04) — first impression = onboarding/conversion; slow initial load and video loads are felt by every new user before they've invested anything.

## Problem

The app *feels* slow on the path a brand-new user walks:

- The **initial screen takes a long time to show games** and has **no good preloader** — the user stares at an empty/janky screen not knowing anything is happening.
- **Other screens along the way also stall**, in particular **video loading** (opening a game/reel, first paint of the `<video>`).

We have fixed *individual* perf cliffs before by capturing a HAR and reasoning about one waterfall (T4000 chained `/load`→video; T3760 framing over-fetch). What we've never done is **walk the entire new-user flow end-to-end, record everything, and attribute each perceived wait to a specific cause** so we can fix the whole journey rather than one request at a time.

This task does exactly that: **one agent plays the new user with full network capture and produces a delay ledger** that maps every user-perceived wait to concrete HAR evidence and a root cause — then hands each attributed delay to a fixing agent with the expertise pre-loaded.

## Solution (two stages)

### Stage A — Instrumented walkthrough + attribution (this task, measurement phase)

Drive the app **as a real user** through the full new-user journey with network capture on, then attribute every perceived delay.

**The journey to walk (adjust to the real new-user path; confirm against `App.jsx` routing):**
1. Cold landing → auth → **initial home screen renders the games list** (the headline complaint).
2. Open a game → **Annotate** (video first paint — the T4000 territory).
3. Create/extract a clip → **Framing** (video + crop load — the T3760 territory).
4. **Overlay** (highlights load).
5. **Gallery / My Reels** (reels list, thumbnails, `downloads/count`).
6. Play a reel / recap (`ClipVideo`, `RecapPlayerModal`).

**Capture method (both signals — you need timeline AND network in one clock):**
- Use **Playwright driving the real app** (see the injected `drive-app-as-user` recipe below) so you exercise real data, not the empty `e2e@test.local` user.
- Record a **HAR for the whole session** via Playwright context `recordHar` (`{ path, content: 'embed', mode: 'full' }`) so every request+timing lands in one file.
- In parallel, mark **user-perceived milestones** at the moments a *user* judges — "screen appeared", "games visible", "video started playing", "spinner gone". Emit `console.warn('[PERF] <milestone> ' + Date.now())` (not `console.log` — the dev console filters Info level). These marks are what let you split delays *from the user's perspective*, which is the whole point.
- **Clock alignment (this is the crux — "associate observed wait times with the right part of the HAR"):** stamp each milestone with **`Date.now()` (epoch ms)** because HAR entry `startedDateTime` is wall-clock epoch — that shared clock is what places a perceived-wait marker directly onto the HAR timeline. Do NOT stamp with `performance.now()` (it's relative to `timeOrigin`, a different origin than the HAR); if you use `performance.mark`, convert via `performance.timeOrigin + entry.startTime` before comparing. Sanity-check by also stamping the Playwright-side `page.on('console')` handler with `Date.now()` and confirming the two epochs agree within a few ms.
- Also pull **`PerformanceNavigationTiming` / `PerformanceResourceTiming`** (convert their `timeOrigin`-relative times to epoch the same way) and any `PROFILING_ENABLED` server logs to cross-check.
- **Attribution mechanic:** for each milestone pair (e.g. "home mounted" → "games visible"), the wait = Δepoch between the two marks; then select every HAR entry whose `[startedDateTime, startedDateTime+time]` overlaps that window — those are the requests that *own* the wait. A window with no in-flight request = a JS/main-thread or awaited-step gap, not a network cost. This overlap step is what turns "it felt slow here" into "these specific requests (or this gap) caused it."

**Attribution — produce a delay ledger.** For each perceived wait, a row that ties the *feeling* to the *evidence* to the *cause* to the *fix class*:

| Perceived wait (user's words) | Screen | Wall-clock ms | HAR evidence (request(s) + timing split) | Root cause | Fix class |
|---|---|---|---|---|---|
| "games take forever to appear" | Home | e.g. 1800 | `GET /api/games` wait=Xms + N presigned URL signs + M thumbnail fetches; serial? | e.g. presigning all games up front / no skeleton | preloader + defer presign + parallelize |

**Root-cause discipline (do NOT stop at "the request was slow"):** for each slow span, classify it — split HAR timing into `blocked / dns / connect / ssl / send / **wait (TTFB)** / receive`. That split *is* the diagnosis:
- High **wait/TTFB** → server-side work or shared-vCPU contention (T4000 proved `/api/health` stalled identically once — a spike, not endpoint work; rule that in/out with live re-timing before blaming code).
- High **receive** on a big body → **over-fetch / no compression / no bounded window** (T3760: framing "slow load" was a HAR misread — deep R2 reads were actually fast; don't fabricate a cause).
- **Chained** requests (B can't start until A returns) → **serialization** removable by parallelizing (T4000: `/load`→video chain; fixed by seeding the `<video>` src from a stable gameId-only URL so bytes fetch concurrently).
- **Gap with no request in flight** → main-thread/JS work, a lazy `import()` chunk fetch, or an awaited step that could be deferred → code-split / reorder / render-and-stream.
- **No feedback during a real wait** → not a latency bug at all, a **perceived-performance / UX** bug → skeleton, optimistic render, progressive disclosure.

**Deliverable of Stage A:** `docs/plans/tasks/T4770-delay-ledger.md` — the filled ledger, ranked by user-perceived cost (ms × how-early-in-the-funnel), each row carrying its HAR evidence and a proposed fix class. This is the handoff artifact.

### Stage B — Fan out fixes (spawn a fixing agent per attributed delay)

For each high-cost ledger row, hand off to a fixing agent (via `/dotask` per row, or grouped by screen). **Fixes are not limited to "make the request faster."** Pick per problem:
- **Code optimization** — remove chained round-trips (parallelize), add in-flight dedup, batch N calls into one, stop awaiting work that can run concurrently.
- **Config optimization** — Cache-Control/ETag on cacheable responses, gzip/br/zstd compression on large text/JSON, presigned-URL reuse, HTTP keep-alive/pooled httpx (see T4630 R2StreamProxy), bounded byte-window streaming vs full fetch.
- **Add loaders** — skeleton screens (games-list skeleton so the home screen never shows empty), spinners with real progress, `VideoLoadingOverlay` where video first-paint lags. Perceived speed counts as much as real speed for a new user.
- **Change the UI / load ordering** — render the shell immediately and stream data in (progressive disclosure), defer below-the-fold work (thumbnails, presigning for off-screen games), split heavy route chunks with code-splitting + idle preload (T3990/T4000 preload precedent), move a blocking step off the critical path.

Each fix follows the normal tiered workflow (branch, test, review) and must respect the project's persistence rule: **load/perf work is read-path only — never introduce a reactive `useEffect`→API write to "cache" or "warm" anything** (see CLAUDE.md persistence rules; T4000 called this out explicitly).

## Injected Expertise (read these before starting — this is why the task is self-contained)

### 1. HAR capture + analysis
- Skill: `.claude/skills/har-analysis/SKILL.md`. Analyzer: `scripts/har-analysis.py <har> --output $TEMP/har-analysis.json` → slow requests (wait/receive/blocked split), caching issues, compression gaps, waterfall (serial chains, gaps), size-by-content-type, CORS/redirect overhead. It already shortens hosts to `[API]`/`[R2]`/`[FE]` — use that to see when bytes route through the Fly box vs direct from R2.
- Capture the HAR from Playwright itself (`recordHar`) rather than asking the user to export from DevTools, so the milestone `console.warn` marks and the network share one clock.

### 2. Drive the app as a real user
- Skill: `.claude/skills/drive-app-as-user/SKILL.md`. Auth via `POST /api/auth/dev-login` + `e2e/helpers/realAuth.js` `loginAsRealUser(context, 'imankh@gmail.com')` (real data; `rb_session` is HttpOnly so the header/test-login bypass won't load real games). Run against the already-running dev server: `cd src/frontend && E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/<spec>.spec.js --reporter=line`. Trace with `console.warn('[PERF] ...')` (dev console filters Info-level `console.log`). From a /dotask container: `bash scripts/dev-verify.sh e2e/<spec>.spec.js`.
- To simulate a *genuinely new* user's cold cache, also measure with a fresh browser context / disabled cache (first-visit is the worst case and the one that shapes first impressions).

### 3. This codebase's known perf physics (don't re-derive; don't repeat the mistakes)
- **Architecture:** Frontend on Cloudflare Pages; API on a **single Fly machine (`cpu_kind=shared`, 1 vCPU)** in lax; media + per-user SQLite on **R2**. Two byte paths for video: `GET /api/games/{id}/video` = **302 → presigned R2 URL, bytes direct from R2** (bypasses Fly); `GET /api/games/{id}/stream` = **bounded streaming proxy** (moov + clip windows) but **routes bytes through the contended Fly box**. Trade-off is real — quantify per case (T4000 §Design gate).
- **Shared-vCPU contention is a thing.** A high TTFB can be a transient spike, not endpoint work — T4000 confirmed `/api/health` (which skips the heavy db_sync middleware) stalled the *same* 378ms as `/load` when they arrived 1ms apart. **Re-time live before blaming code**; distinguish "this endpoint is slow" from "the box was momentarily saturated."
- **Don't fabricate a cause from a HAR misread.** T3760: framing "slow load" looked like deep R2 reads; live timing showed 266ms TTFF — the clamp had no benefit and the task was re-scoped. Verify the story against a second measurement.
- **Chained round-trips are the recurring villain.** T4000 (`/load`→video) and the `/load`→metadata→video pattern: the client usually knows the id at click time and a stable id-only URL exists, so the second fetch can start immediately. Look for every "await A, then start B" where B didn't need A.
- **Initial games list specifics:** `GET /api/games` (`list_games`, `_list_games_impl(skip_presigned_urls=False)`, games.py ~L843) **presigns every game's URL**; `GET /api/games/metadata` (~L836) skips presigning. If the home screen only needs to *list* games (names, thumbs, status) and presigns them all up front, that's a candidate serial cost to defer until a game is actually opened. Confirm in the HAR.
- **Preload precedent:** T3990/T4000 eagerly preload editor route chunks on home-screen idle so the first click reuses a cached module (also dodges the stale-chunk full-page reload). Reuse this pattern for whatever the ledger shows is fetched late on the critical path.
- **Existing loader components to reuse/extend:** `components/shared/VideoLoadingOverlay.jsx`, `SegmentedProgressStrip`, the Toast system. Prefer extending these over new one-offs.

## Context

### Relevant Files (Stage A investigation — start here, let the HAR lead the rest)
- `src/frontend/src/App.jsx` — top-level routing; confirm the real new-user path and where the initial screen mounts.
- `src/frontend/src/components/ProjectManager.jsx` — the **initial home screen** (games list, GameCards). Primary suspect for "games take forever + no preloader."
- `src/frontend/src/stores/gamesDataStore.js` — `loadGame`, in-flight dedup, games fetch.
- `src/frontend/src/containers/AnnotateContainer.jsx` + `src/frontend/src/containers/annotateVideoLoad.js` — video first-paint path (T4000 area).
- `src/frontend/src/components/shared/VideoLoadingOverlay.jsx`, `components/ranking/ClipVideo.jsx`, `RecapPlayerModal.jsx` — video loaders across screens.
- `src/backend/app/routers/games.py` — `list_games` / `list_games_metadata` (~L836-955, presign cost), `get_game_video` (302→R2, L1452), `stream_game_bounded` (proxy, L2235), `load_game` (L2111).
- `src/backend/app/routers/downloads.py` — reels list + `downloads/count` (Gallery/My Reels stage).

### Related Tasks
- **T4000** (parallelize game video fetch) — chained-round-trip precedent + the Fly/R2 byte-path trade-off analysis. Reuse its diagnosis method.
- **T3760** (framing over-fetch was a HAR misread) — cautionary precedent: verify causes with a second measurement.
- **T3990** (eager editor-chunk preload on idle) — code-split + preload precedent.
- **T4630** (R2StreamProxy pooled-httpx TTFB fix) — config-level latency win precedent; if streaming-proxy TTFB shows up, this is the lever.
- Stage B produces **child fix tasks** (T4771, T4772, …) — one per high-cost ledger row, or grouped by screen.

### Technical Notes
- **Measure first, fix second — do not start editing app code in Stage A.** The ledger is the gate: no fix ships without a ledger row citing HAR evidence and a root cause.
- Capture **more than one run** (cold vs warm cache; re-time suspicious TTFBs live) so a contention spike isn't mistaken for an endpoint being slow.
- Perceived performance is in scope and often the cheapest win: a skeleton on the home screen can beat shaving 300ms off a request.
- Every fix is **read-path only**: no reactive persistence, no `useEffect`→API write to warm/cache (CLAUDE.md; T4000 §4).

## Implementation

### Steps
1. [ ] Stand up the dev stack; `loginAsRealUser` as `imankh@gmail.com` (real games/reels present).
2. [ ] Write a Playwright spec that walks the full new-user journey (home → annotate → framing → overlay → gallery → play), with `recordHar` on and `[PERF]` milestone marks at each user-perceived moment.
3. [ ] Run it (cold-cache and warm-cache passes); collect the HAR(s) + console marks + any `PROFILING_ENABLED` server timings.
4. [ ] Run `scripts/har-analysis.py` on each HAR; cross-reference the analysis with the milestone marks.
5. [ ] Build `T4770-delay-ledger.md`: one row per perceived wait, with wall-clock, HAR timing split, root cause (classified), and fix class. Rank by user-perceived cost, earliest-funnel first.
6. [ ] Re-time any high-TTFB spans live to separate "slow endpoint" from "shared-vCPU spike."
7. [ ] For each high-cost row, create a child fix task (T477x) with the row's evidence + the relevant injected-expertise section, and hand off via `/dotask`.
8. [ ] (Optional but ideal) after fixes land, re-run the same walkthrough spec and diff the ledger to prove the wins.

### Progress Log
**2026-07-04**: Created (user-designated top priority). Scope = instrument the new-user flow, attribute every perceived wait to HAR evidence + root cause, then fan out fixes (code/config/loader/UI-reorder). Grounded in T4000 (chained round-trips + Fly/R2 byte paths), T3760 (verify causes, HAR can mislead), T3990 (preload), T4630 (pooled-httpx TTFB). Initial-screen suspect: `ProjectManager.jsx` + `list_games` presigning every game.

## Acceptance Criteria

- [ ] A full-journey Playwright walkthrough exists and produces a session HAR + user-perceived milestone marks on one clock.
- [ ] `T4770-delay-ledger.md` attributes **every** user-perceived wait on the new-user path to specific HAR request(s), a classified root cause, and a fix class — ranked by perceived cost.
- [ ] High-TTFB spans are re-timed live so spikes aren't mislabeled as endpoint slowness.
- [ ] Each high-cost delay is handed to a fixing agent as a child task carrying its evidence + relevant expertise.
- [ ] Initial home screen has a real preloader/skeleton (no empty-screen-then-pop).
- [ ] No fix introduces reactive persistence; all changes are read/load-path only.
- [ ] (If fixes land in-scope) a re-run walkthrough shows measurable reduction on the ranked delays.
