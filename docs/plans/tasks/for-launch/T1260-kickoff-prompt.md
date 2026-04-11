# T1260 Kickoff Prompt

Copy everything below the line into a new Claude Code conversation.

---

## Task

Implement the T1260 Video Seek Optimization epic. This is a sequence of 5 subtasks that must be executed **in order**, with Playwright-driven measurement gates between them. All work goes on a single branch.

## Branch

```
git checkout -b feature/T1260-video-seek-optimization
```

All subtasks commit to this branch. Do not merge — I will review and merge manually.

## Measurement Infrastructure

A Playwright test exists at `src/frontend/e2e/seek-perf.spec.js`. It:

1. Loads a real game video in Annotate mode (presigned R2 URL, not file upload)
2. Performs a standard set of 6 seeks (backward, forward, random, return-to-viewed)
3. Reads `window.__seekPerf` for timing data per seek
4. Takes a screenshot after each seek (proof the video frame rendered)
5. Writes structured results to `src/frontend/test-results/seek-perf-results.json`
6. Prints a summary table to stdout

**Run it like this:**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
```

Then read the results:
```bash
# Summary table (last ~20 lines of output)
reduce_log({ file: "/tmp/seek-perf.log", tail: 200, grep: "SeekPerfTest" })

# Full structured results
cat src/frontend/test-results/seek-perf-results.json
```

**Before/after protocol for every subtask:**
1. Run the Playwright test BEFORE implementing the subtask. Save results as `test-results/seek-perf-before-T12XX.json`
2. Implement the subtask
3. Run the Playwright test AFTER. Save results as `test-results/seek-perf-after-T12XX.json`
4. Compare the before/after numbers. Report the diff to me. The key metrics:
   - `return-to-viewed` and `return-to-midpoint` latencies (should improve with T1262)
   - `cacheHitRate` (should climb from 0% to >30% with T1262)
   - `forward-near` latency (should improve with T1265)
   - All seeks should show no regression (after latency <= before latency + 10ms)

The Playwright test requires T1261 instrumentation (`window.__seekPerf`). For T1261 itself, run the test to verify it produces output — the "before" is the absence of data, the "after" is structured results.

**Important:** The test uses a stable test user (`e2e_seekperf_stable`). This user needs at least one game video. If no game exists for this user, you'll need to set one up first — check if the user exists in the dev database and has games, or create a setup step.

## Execution model

You are the orchestrator. For each subtask:

1. **Read** the subtask file to understand scope, file changes, and acceptance criteria
2. **Read** every existing file listed in "File Changes" before modifying it
3. **Measure before** — run `npx playwright test e2e/seek-perf.spec.js`, save results, read them
4. **Implement** — make the code changes described in the subtask
5. **Unit test** — run `cd src/frontend && npm test 2>&1 > /tmp/test-output.log; echo "exit: $?"` and fix until green
6. **Measure after** — run Playwright test again, save results, compare with before
7. **Commit** with message: `T12XX: <description>`
8. **Update** the subtask's status to TESTING in its task file and in `docs/plans/PLAN.md`
9. **Report** the before/after diff to me and wait for approval before the next subtask

**Screenshots:** After each Playwright run, check the screenshots in `src/frontend/test-results/seek-perf-*.png`. If a seek screenshot shows a black frame or error state instead of video content, something is wrong — investigate before proceeding.

## Subtask sequence

Execute in this exact order. Each depends on the previous.

### 1. T1261: Seek Perf Instrumentation
**File:** `docs/plans/tasks/for-launch/T1261-seek-perf-instrumentation.md`
**Goal:** Add seek latency measurement to `useVideo.js`. Create `seekPerf.js` utility. Expose `window.__seekPerf`.
**Key files to read first:**
- `src/frontend/src/hooks/useVideo.js` — the seek/seeked/waiting/canplay handlers to instrument
**Playwright role:** After implementing, run the seek-perf test. It should now produce real timing data instead of skipping. The output IS the baseline. Save it as `seek-perf-before-T1262.json` (it serves as T1262's "before").

### 2. T1262: Service Worker Video Cache
**File:** `docs/plans/tasks/for-launch/T1262-service-worker-video-cache.md`
**Goal:** SW intercepts video range requests, caches in Cache API, serves repeat seeks from cache.
**Key files to read first:**
- `src/frontend/src/hooks/useVideo.js` — where to call `registerVideo()`
- `src/frontend/src/containers/AnnotateContainer.jsx` — blake3Hash in metadata (~line 330-370)
- `src/frontend/src/screens/FramingScreen.jsx` — clip video config
- `src/frontend/src/screens/OverlayScreen.jsx` — working video load (~line 354-374)
- `src/frontend/src/App.jsx` — where to register SW
- `src/frontend/package.json` — add workbox-range-requests
**Playwright comparison:**
- `return-to-viewed` latency: expect 1-5s → <50ms (biggest improvement)
- `return-to-midpoint` latency: expect 1-5s → <50ms
- `random-midpoint` latency: should be unchanged (still a cache miss on first visit)
- `cacheHitRate`: expect 0% → ~33% (2 of 6 seeks are returns to viewed positions)
- Console logs from SW: look for `[SW] HIT` and `[SW] MISS` lines in `consoleLogs` field

**GO/NO-GO GATE:** Report the before/after numbers. If return-to-viewed seeks are <100ms, the SW is working. If the overall experience is acceptable for Annotate, I may choose to skip T1264 and T1265.

### 3. T1263: SW Quota Management
**File:** `docs/plans/tasks/for-launch/T1263-sw-quota-management.md`
**Goal:** LRU eviction so cache doesn't fill disk.
**Playwright role:** Not directly measurable via seek-perf test. Instead, write a separate short Playwright snippet or use `page.evaluate()` to call `getCacheStats()` and verify it returns video entries. Verify after loading a game that cache stats show >0 bytes.

### 4. T1264: Moov Atom Parsing
**File:** `docs/plans/tasks/for-launch/T1264-moov-atom-parsing.md`
**Goal:** Parse moov atoms for exact byte ranges in cache warming.
**Key files to read first:**
- `src/frontend/src/utils/cacheWarming.js` — `warmClipRange()` with proportional estimation
- `src/backend/app/routers/storage.py` — `GET /storage/warmup` to add blake3_hash
**Playwright comparison:**
- Run seek-perf test. The accuracy improvement may not directly change seek latencies (warming happens at app startup, not during the test). Instead, check console logs for `[VideoIndex]` accuracy comparison lines.
- If proportional errors are <5 MB at all positions, report this — it means this subtask has marginal value.

### 5. T1265: Predictive Prefetch
**File:** `docs/plans/tasks/for-launch/T1265-predictive-prefetch.md`
**Goal:** SW prefetches next 30s ahead of playhead.
**Playwright comparison:**
- `forward-near` latency (seek to 30s after 10s of playback): expect 1-5s → <50ms
- The Playwright test plays 10s then seeks to 30s — this is exactly the prefetch window.
- Console logs: look for `[SW] Prefetch:` lines showing the prefetch was triggered and completed before the seek.

## Handling the test user

The Playwright test uses a stable user ID (`e2e_seekperf_stable`). Before the first run, verify this user has a game video:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
from app.storage import get_r2_client
import os
from dotenv import load_dotenv
load_dotenv()
# Check if test user has any data
s3 = get_r2_client()
prefix = f'{os.getenv(\"APP_ENV\", \"dev\")}/users/e2e_seekperf_stable/'
resp = s3.list_objects_v2(Bucket='reel-ballers-users', Prefix=prefix, MaxKeys=5)
print(f'Objects for test user: {len(resp.get(\"Contents\", []))}')
for obj in resp.get('Contents', []):
    print(f'  {obj[\"Key\"]}')
"
```

If no data exists, the test will need to upload a game first. You can either:
- Add a setup step to the Playwright test that uploads a video if none exists
- Or use the existing full-workflow helpers to create a game for this user
- Or point the test at a user who already has games (check the dev database)

The test is designed to be flexible — it clicks the first available game. It just needs one to exist.

## Rules

- **Read before writing.** Always read every file you plan to modify before making changes.
- **One subtask at a time.** Do not start T1262 until T1261 is committed and Playwright baseline recorded.
- **Playwright is the source of truth.** Use the structured JSON results, not vibes, to prove improvement.
- **Save before/after results.** Copy results files with subtask-specific names so we have the full history.
- **Report measurements.** After each subtask, show me the key metrics diff and wait for my go-ahead.
- **Commit per subtask.** Each subtask gets its own commit with `T12XX:` prefix.
- **Don't over-build.** If a subtask's Playwright results show marginal improvement, flag it. I may choose to revert.
- **Frontend tests.** Run `cd src/frontend && npm test 2>&1 > /tmp/test-output.log; echo "exit: $?"` after each subtask to verify no regressions.
- **Log handling.** Redirect all test output to files. Use `reduce_log` to read them per CLAUDE.md rules. Never paste raw test output into context.
- **Screenshots.** After each Playwright run, read the seek screenshots to verify the video frame actually rendered. A black frame means the seek failed silently.

## Context

- **Stack:** React 18 + Vite + Zustand, FastAPI backend, Cloudflare R2 storage
- **Video source:** VEO cameras — H.264 1080p 29.97fps, 2.5s GOP, ~4.5 Mbps, ~3 GB per 90-min game
- **Current loading:** Presigned R2 URLs on `<video src={url}>` with `preload="auto"` in Annotate, `preload="metadata"` + `#t=` fragments in Framing (T1210)
- **The problem is network latency, not decode time.** VEO's 2.5s GOP means decode is 150-250ms. The 1-5s stalls are from R2 range request round-trips.
- **Playwright E2E setup:** Auth via `X-User-ID` headers + route mocking. Config at `src/frontend/playwright.config.js`. Tests require manual server start (frontend + backend).
- **All subtask details** (file changes, function-level specs, acceptance criteria) are in the individual task files. Read them.
