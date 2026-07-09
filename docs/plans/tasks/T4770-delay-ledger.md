# T4770 — New-User-Flow Delay Ledger (Stage A: measurement + attribution)

**Status:** Stage A complete (measurement only — NO application source changed).
**Instrument:** `src/frontend/e2e/T4770-new-user-flow-perf-walkthrough.spec.js`
**Method:** Playwright drives the app AS THE REAL USER (`imankh@gmail.com` via `dev-login`, profile `9fa7378c`) through the full new-user journey with a session HAR (`recordHar`) and user-perceived `[PERF]` milestone marks stamped in-page with `Date.now()` — both on ONE epoch clock. Cold-cache (fresh context) and warm-cache passes.

Run it in-container:
```
bash scripts/dev-verify.sh e2e/T4770-new-user-flow-perf-walkthrough.spec.js
python3 scripts/har-analysis.py /tmp/t4770/cold.har -o /tmp/t4770/cold-analysis.json
python3 /tmp/t4770/attribute.py /tmp/t4770/cold.har /tmp/t4770/marks-cold.json   # overlap attribution
```
Artifacts (uncommitted, under `/tmp/t4770/`): `cold.har`, `warm.har`, `marks-{cold,warm}.{json,txt}`, `restiming-*.json`, `cold-attribution.txt`.

---

## Clock-alignment proof (the crux)

Each `[PERF]` mark is stamped in-page with `Date.now()` (epoch ms) — the same wall-clock epoch as HAR `startedDateTime` and `performance.timeOrigin`. The Playwright console handler also stamps `Date.now()`; the spec **asserts the two epochs agree** (`maxSkew < 2000ms`; observed skew was single-digit ms — same machine, same clock). `PerformanceResourceTiming` is dumped converted to epoch via `performance.timeOrigin + startTime`. This is what lets a perceived-wait marker sit directly on the HAR timeline; the attribution then selects every HAR entry whose `[startedDateTime, startedDateTime+time]` window overlaps a milestone pair.

## Cold-pass perceived milestone timeline (epoch-relative)

```
+   0ms  home:gotoStart
+ 770ms  home:appShell          (Games tab painted)
+1743ms  home:gamesVisible      <-- HEADLINE: games appear ~1.7s after landing, empty until then
+2582ms  annotate:navStart
+5142ms  media:loadeddata 6/video   (annotate video FIRST FRAME, ~2.56s after nav)
+9894ms  framing video first frame (games/{hash}.mp4, direct R2)
+11439ms framing:settled        (video ready +1.5s earlier -> 1.5s main-thread gap)
+16287ms overlay video first frame (working_video/stream, through Fly proxy)
+21956ms myreels:settled
+22597ms media:playing 6/stream (reel PLAYS ~615ms after click)
```

Warm pass (2nd visit, cache primed): `home:gamesVisible` @ **+1594ms** — barely better than cold (+1743ms). **Warm cache does not fix Home** because Home is server-bound (`/api/bootstrap`), not asset-bound.

---

## The delay ledger — every perceived wait, attributed

Ranked by user-perceived cost (wall-clock × how-early-in-funnel). All rows carry HAR evidence with the `blocked/dns/connect/ssl/send/wait(TTFB)/receive` split. **Live re-timing** (`curl` ×5, co-timed with `/api/health`) was used to separate genuine endpoint slowness from shared-vCPU contention spikes.

| # | Perceived wait (user's words) | Screen | Wall-clock (cold / warm) | HAR evidence (request + timing split) | Root cause (classified) | Fix class → child task |
|---|---|---|---|---|---|---|
| 1 | "The games take forever to show up and the screen is just blank" | Home | **1743ms / 1594ms** | Games are gated on `GET /api/bootstrap` (`setFromBootstrap(data.games)`, App.jsx:210). HAR: bootstrap `wait(TTFB)≈660–1120ms`, tiny body (15KB). **Live re-time: 850–1122ms EVERY call (stable), while co-timed `/api/health` = 47–105ms** → genuine endpoint work, NOT a spike. Bootstrap serially aggregates profiles + quests + `list_projects()` + `list_games_metadata()` + active/unacked exports + pending uploads (bootstrap.py:24–150). No skeleton renders meanwhile. | (a) **No feedback during a real wait** (perceived-perf) — blank screen, no skeleton. (b) **Server work on the critical path** — a ~1s aggregate blocks games. | Home skeleton/preloader + split bootstrap so games render before the heavy tail (or parallelize its internal queries) → **T4771** |
| 2 | (systemic — makes everything else feel slow) | All | inflates co-timed TTFBs by 0.5–1.5s | `warmAllUserVideos()` (App.jsx:233,336) fires on every home mount and streams `GET /api/projects/{id}/working_video/stream` for MANY projects (30/47/49/50…) at once **through the 1-vCPU Fly bounded proxy**. HAR: these 206 streams show `wait(TTFB)=490–990ms`, `ssl=600–990ms`, some 9MB+ `receive`. Concurrently, foreground `/api/games/6/load` & `/6/video` show 1100–1450ms TTFB **in the HAR** but **~100ms live** — i.e. the storm is what inflated them. | **Shared-vCPU + Fly-proxy contention** caused by a background preload competing with the foreground. A HAR-only read would wrongly blame `/load`/`/video`; live re-timing proves the endpoints are fast (T4000 lesson). | Gate/deprioritize warm-all until foreground idle; cap concurrency; don't warm off-screen projects on home → **T4772** |
| 3 | "Opening a reel to edit it (add spotlights) is slow to show video" | Overlay | clicked→videoReady **~3233ms**; clicked→first byte **2187ms** | `GET /api/projects/30/working_video/stream` = **9.4MB received THROUGH the Fly bounded proxy** (`wait(TTFB)=490–900ms`, `receive=523ms`), amid a storm of 4 concurrent `working_video/stream` (30/50/49/47). Working videos take the proxy byte-path (not the 302→R2-direct path games use). | **Byte path through contended Fly box** (config) + **preload storm** (row 2). | Config: R2StreamProxy pooled-httpx (T4630) for `working_video/stream` TTFB, and/or 302→presigned-R2 for working videos; + fix row 2 → **T4773** |
| 4 | "The video takes a moment to 'settle' after it appears" | Framing & Overlay | **~1513ms (framing) / ~1524ms (overlay)** | `framing:videoReady → framing:settled` and `overlay:videoReady → overlay:settled` are **GAPS with NO request in flight**. The video bytes are already fast (framing = `games/{hash}.mp4` R2 206, `wait=110ms`). | **Main-thread/JS work** — crop keyframe / highlight / canvas setup after the `<video>` is ready. Not a network cost. | Code: defer/idle the heavy setup off the paint path, or render a progress state (perceived) → **T4774** |
| 5 | "Opening My Reels stalls before the reels show" | My Reels | clicked→settled **~2513ms** | `GET /api/rank/confidence` fired **3×** (`wait≈475–1052ms`) + `working_video/stream` storm (47/50/49, `wait≈815–839ms`). `GET /api/downloads` itself is fast (~100ms live). | **Duplicate requests** (rank/confidence) + **preload storm** (row 2). | Code: dedup/in-flight-guard `rank/confidence`; defer stream warming off the My Reels open → **T4775** |
| 6 | "Opening a game to annotate — video takes a couple seconds" | Annotate | navStart→first frame **~2560ms** | `GET /api/games/6/load` + `GET /api/games/6/video` (302→R2) run **concurrently** (T4000's early-src fix is working — good). HAR TTFBs were 1100–1450ms **but ~100ms live**; the 302→R2 R2 fetch itself is 170ms. | Mostly **row 2 contention** + the concurrent-load window; the endpoints are fast. `VideoLoadingOverlay` already covers the wait. | Largely resolved by T4772 (kill the storm). No dedicated endpoint fix — verified fast live. Tracked under **T4772**. |
| 7 | "Playing a finished reel / recap" | Play | navStart→playing **~615ms** | `GET /api/downloads/6/stream` 206 bounded proxy (`wait(TTFB)=441ms`, `receive=174ms`, 4.8MB) + `downloads/count` 52ms. Plays quickly. | **No problem** — the bounded stream proxy performs well for reels here. | **No action.** Recorded to close the funnel. |

### Ruled OUT (HAR-misread guards — T3760 lesson)

- **"Presigning every game up front is slow" (the task's initial suspect).** Home does NOT call `list_games` — bootstrap uses `list_games_metadata()` (no presigning). And `GET /api/games` (which DOES presign all 6) re-times **88–162ms live**. At this account's scale, presigning is not a measurable cost. Do **not** build a "defer presign" fix — it addresses nothing here.
- **"Huge uncompressed JS payloads / 1407 compression gaps" (from `har-analysis.py`).** These are the **Vite dev server** serving unminified per-module files (`lucide-react.js` 938KB, `ProjectManager.jsx` 339KB, etc.) with no gzip. In production the frontend is bundled + minified + compressed on Cloudflare Pages. This is a **dev-environment artifact, not a prod bug** — excluded from the ledger.
- **Duplicate `/api/bootstrap` (2× on cold mount).** React **StrictMode is on** (`main.jsx:24`), which double-invokes effects in dev only. Prod calls bootstrap once. The *duplication* is a dev artifact; the *~1s single-call cost* (row 1) is real. Stage B should fix bootstrap's cost, not chase a phantom duplicate.
- **High `ssl=1000ms+` on repeated localhost calls.** Dev-proxy/shared-box connection artifact under the request storm; the same endpoints show negligible connect/ssl when re-timed in isolation. Not an endpoint TLS problem.

### Environment caveat (read before trusting absolute ms)

Measured against the **in-container dev stack** (Vite dev proxy on :5173 → uvicorn on :8000 → shared dev Postgres via `host.docker.internal` + R2). Absolute milliseconds differ from prod (prod = Cloudflare Pages bundle + single Fly `shared`-1vCPU machine + R2). What transfers to prod: the **structural findings** — bootstrap is a serial ~1s aggregate on the games critical path; the warm-all storm competes with the foreground on the same 1 vCPU; working videos take the Fly proxy byte-path; the two ~1.5s post-video main-thread gaps; no home skeleton. The confirmed **endpoint cost** (bootstrap ≈1s, everything else ≈100ms) was established by live re-timing, which is env-robust.

---

## Acceptance-criteria adversarial pass (Stage A scope)

- [x] **Full-journey Playwright walkthrough exists, one HAR + milestone marks on one clock.** `T4770-new-user-flow-perf-walkthrough.spec.js`; all 6 screens reached (Home→Annotate→Framing→Overlay→My Reels→Play) with real video-paint marks; clock-agreement asserted.
- [x] **Every user-perceived wait attributed to HAR request(s) + classified cause + fix class, ranked.** Rows 1–7 above; the overlap attribution (`attribute.py`) maps each milestone window to in-flight requests, and flags no-request windows as JS/main-thread gaps (rows 4).
- [x] **High-TTFB spans re-timed live so spikes aren't mislabeled.** Done — bootstrap confirmed as endpoint work (stable ~1s vs `/health` ~80ms); `/load`, `/video`, `/games`, `/downloads` confirmed fast live → their HAR TTFBs were storm-induced spikes (row 2).
- [x] **Each high-cost delay handed to a fixing agent as a child task with evidence + expertise.** Child tasks **T4771–T4775** created (below), each carrying its ledger row + the relevant injected-expertise section.
- [→] **"Initial home screen has a real preloader/skeleton."** This is a **Stage B fix**, captured as **T4771** — NOT implemented here (measurement-only).
- [→] **No reactive persistence; read-path only.** A Stage B constraint recorded in every child task; nothing was implemented in Stage A.

## Child fix tasks (Stage B fan-out)

| Task | Scope | Ledger rows |
|---|---|---|
| **T4771** | Home first paint: games-list skeleton + split/parallelize `/api/bootstrap` | 1 (+ acceptance-criterion preloader) |
| **T4772** | Tame the `warmAllUserVideos` cache-warming storm (foreground-first, bounded) | 2, 6 |
| **T4773** | Overlay/working-video byte path: pooled-httpx proxy TTFB (T4630) or 302→R2 | 3 |
| **T4774** | Editor video first-paint main-thread gap (framing + overlay ~1.5s) | 4 |
| **T4775** | My Reels: dedup `rank/confidence` + defer stream warming | 5 |
