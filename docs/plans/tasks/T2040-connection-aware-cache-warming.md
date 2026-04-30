# T2040: Connection-Aware Cache Warming

**Status:** DONE
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Two issues with how cache warming manages connections:

### 1. Proxy loads don't need to stop warming (but we stop anyway)

R2 is HTTP/1.1 with a 6-socket-per-origin limit in the browser. When the user clicks a game or reel, the current `FOREGROUND_ACTIVE` mode stops ALL warming -- but for reel/clip loads that go through the **localhost proxy**, warming doesn't compete at all (different origin). We're wasting 2-5 seconds of warming time where sibling clips could be pre-fetched for free.

```
REEL (proxy load):                      GAME (direct R2 load):
Browser --> localhost proxy --> R2       Browser --> R2
Browser --> R2 (warming)                Browser --> R2 (warming)
         ^                                       ^
  Different origins!                     SAME origin!
  No socket competition.                 6-socket competition.
```

### 2. Warming priority ignores active navigation and video size

The warmer has `GAMES` and `GALLERY` priorities but:

- **No Draft Reels priority** -- when user is browsing their reel projects, warming doesn't know to prioritize clip ranges
- **`clearForegroundActive()` always resets to `GAMES`** -- even if user was on Gallery or Draft Reels
- **No shortest-job-first** -- gallery warms are 1KB each (instant), but they wait behind 5MB game tail warms
- **Default priority is `GAMES` hardcoded** -- not based on what the user is actually looking at

Transfer sizes per queue:

| Queue | What's fetched | Transfer size | Time |
|---|---|---|---|
| Gallery (My Reels) | `Range: bytes=0-1023` | **1KB** | ~100ms |
| Games | Head 1KB + tail 5MB | **~5MB** | ~2-5s |
| Clip ranges (Draft Reels) | Head 1MB + clip body | **10-100MB** | ~5-20s |

Gallery warms are essentially free -- you could warm 50 gallery videos in the time it takes to warm one clip range. There's never a reason to delay them.

### Evidence (HAR + console logs, 2026-04-30)

- Two `warmClipRange` fetches stuck in browser `blocked` state for 30s, then `net::ERR_ABORTED` -- held connection slots the video element needed (fixed same day: `abortInFlightWarms` now aborts both controller sets)
- After fix: warming stops entirely during proxy loads, wasting the proxy load window
- Multi-clip projects: after first clip loads and `clearForegroundActive()` fires, sibling clips start warming -- but could have started 2-5s earlier
- `clearForegroundActive()` always resets to `GAMES` regardless of what view the user is on

## Solution

### Part A: Route-aware foreground modes

Replace the single `FOREGROUND_ACTIVE` mode with two modes:

1. **`FOREGROUND_DIRECT`** (game loads from R2): Stop ALL warming, free all 6 R2 sockets for `<video>`. Same as current behavior.
2. **`FOREGROUND_PROXY`** (reel clip loads via proxy): Stop games/gallery warming but **keep tier-1 clip range warming running**. Push sibling clips to front of tier-1 queue.

#### Connection Budget

| Phase | Games (direct R2) | Reels (proxy) |
|---|---|---|
| User clicks | Stop ALL warming. Free 6 R2 sockets for `<video>`. | Stop games/gallery. **Keep tier-1 clip warming** (free -- different origin). |
| First frame | Video uses 2-3 R2 sockets. Remaining idle. | Proxy uses 0 browser->R2 sockets. **6 available for sibling clips.** |
| Playable (`loadeddata`) | Resume general warming (4+ sockets free). | Continue sibling warming. Resume general warming only after project clips done. |
| User switches clip | N/A | Sibling was pre-warmed -> proxy gets R2 cache hit -> instant. |

#### Timeline Comparison

**Current (stop everything):**
```
Click -------- first frame ---- playable ---- resume warming --- clip 2 warmed
  |  2-5s wasted  |                              |  ~20s warming   |
  |  (0 R2 sockets used)                         |                 |
                                                  Total: 25-30s to clip 2 ready
```

**Proposed (proxy-aware):**
```
Click -------- first frame ---- playable ---- clip 2 warmed
  |  warming clips 2-N  |   (still warming)  |
  |  (6 R2 sockets free for warming)         |
                                              Total: ~20s to clip 2 ready
```

### Part B: Navigation-aware priority with shortest-job-first

Track the active view and use it to set warming priority. Within and across tiers, prefer smaller jobs.

#### Priority by active view

```
User on Games screen:     games -> gallery -> clips
User on Draft Reels:      clips -> gallery -> games
User on My Reels:         gallery -> clips -> games
Default (home, mixed):    gallery -> clips -> games   (shortest-first)
```

Gallery always goes early because it's nearly free (1KB each). There's no reason to ever delay gallery warming -- it finishes before a single game tail starts transferring.

#### Changes needed

1. **Add `DRAFT_REELS` priority mode** -- when user is on the home screen viewing their reel projects
2. **Track the active view** -- ProjectsScreen (Draft Reels home) should call `setWarmupPriority(DRAFT_REELS)`
3. **`clearForegroundActive()` restores to previous priority** -- remember what priority was active before the foreground load, restore to it instead of hardcoding `GAMES`
4. **Gallery as "always first" tier** -- since gallery warms are 1KB, process them ahead of lower tiers regardless of priority (they never delay anything meaningful). Or: on app init, warm all gallery URLs immediately before starting the worker (they'll finish in <1s total).

## Context

### Relevant Files
- `src/frontend/src/utils/cacheWarming.js` -- Priority modes, abort logic, worker loop, `getNextItem()`, `clearForegroundActive()`
- `src/frontend/src/hooks/useVideo.js` -- Calls `setWarmupPriority(FOREGROUND_ACTIVE)` on load, `clearForegroundActive()` on playable. `chooseLoadRoute()` knows proxy vs direct.
- `src/frontend/src/utils/videoLoadRoute.js` -- `chooseLoadRoute()` returns `{ route: 'proxy' | 'direct' }`
- `src/frontend/src/utils/cacheWarming.test.js` -- Tests for abort behavior, priority modes
- `src/frontend/src/components/DownloadsPanel.jsx` -- Also calls `setWarmupPriority(FOREGROUND_ACTIVE)`
- `src/frontend/src/stores/galleryStore.js` -- Sets `GALLERY` priority on gallery open
- `src/frontend/src/App.jsx` -- Sets `GAMES` priority on game load; needs to track active home view

### Related Tasks
- T1410 (Video Load Regression) -- Introduced FOREGROUND_ACTIVE abort wiring
- T1430 (Range Overbuffer) -- Introduced proxy streaming, the reason clips use proxy
- T1890 (Multi-Clip Cache Warming) -- Fixed FOREGROUND_ACTIVE killing warming too early for multi-clip
- T1460 (Warm-path parity) -- Moved route decision into useVideo

### Technical Notes

**Key invariant:** `useVideo` already knows the load route via `chooseLoadRoute()` at the point where it calls `setWarmupPriority`. It can pass `route` to the warmer so it picks the right mode.

**Sibling clip warming:** When a project is opened, `pushClipRanges()` queues all clips as tier-1. During `FOREGROUND_PROXY`, the worker continues processing these. No new mechanism needed -- just don't stop the worker.

**Gallery as implicit top tier:** Gallery warm operations are 1KB each. Even with 100 gallery videos, the total transfer is 100KB -- less than a single clip range warm. Processing them first costs nothing and ensures My Reels loads are always instant.

**`clearForegroundActive()` restore:** Save `currentPriority` before entering any foreground mode, restore it on clear. This way a user who opens Gallery -> plays a video -> returns to Gallery resumes gallery-priority warming, not games.

## Implementation

### Steps

#### Part A: Route-aware foreground modes
1. [ ] Add `FOREGROUND_PROXY` and `FOREGROUND_DIRECT` to `WARMUP_PRIORITY` constants (keep `FOREGROUND_ACTIVE` as alias for `FOREGROUND_DIRECT` for backward compat)
2. [ ] Update `setWarmupPriority()`: `FOREGROUND_DIRECT` aborts all (current behavior); `FOREGROUND_PROXY` aborts `inFlightControllers` only, keeps clip range warming running
3. [ ] Add `warmerPausedLowerTiers` flag (separate from `warmerDisabled`): `FOREGROUND_PROXY` sets this to pause games/gallery but allow tier-1
4. [ ] Update `getNextItem()`: check both flags; `warmerDisabled` blocks all, `warmerPausedLowerTiers` blocks only non-tier-1
5. [ ] Update `useVideo.js`: pass `route` from `chooseLoadRoute()` to select `FOREGROUND_PROXY` vs `FOREGROUND_DIRECT`
6. [ ] Update `DownloadsPanel.jsx`: gallery downloads load from R2 directly, should use `FOREGROUND_DIRECT`

#### Part B: Navigation-aware priority
7. [ ] Add `DRAFT_REELS` to `WARMUP_PRIORITY`
8. [ ] ProjectsScreen / home view: call `setWarmupPriority(DRAFT_REELS)` when Draft Reels section is the active view
9. [ ] Save `previousPriority` before entering foreground mode; `clearForegroundActive()` restores it instead of hardcoding `GAMES`
10. [ ] Move gallery processing ahead of lower tiers in `getNextItem()` -- gallery is always processed before games/clips regardless of priority mode (1KB per warm, negligible cost)
11. [ ] Update `getNextItem()` tier 2/3 ordering to respect `DRAFT_REELS` priority (clips before games)

#### Tests & verification
12. [ ] Update tests: `FOREGROUND_PROXY` allows tier-1, `FOREGROUND_DIRECT` blocks all, priority restore on clear
13. [ ] Verify: load a multi-clip reel, confirm sibling clips warm during first-clip proxy load (`[CacheWarming] Warmed clip` logs appear before `clearForegroundActive`)
14. [ ] Verify: navigate Games -> open gallery -> play video -> return to gallery -> warming resumes with gallery priority

## Acceptance Criteria

### Part A
- [ ] Loading a game video stops ALL warming (6 R2 sockets free)
- [ ] Loading a reel clip via proxy does NOT stop tier-1 clip range warming
- [ ] Sibling clips in the same project are warmed during the first clip's proxy load window
- [ ] Switching to clip 2 in a multi-clip project is faster (R2 cache hit from pre-warming)
- [ ] Loading a game video is not regressed (no warming competing for sockets)

### Part B
- [ ] Gallery videos (1KB each) are warmed before game tail warms (5MB each) regardless of priority
- [ ] Navigating to Draft Reels prioritizes clip range warming
- [ ] `clearForegroundActive()` restores to the priority that was active before the foreground load
- [ ] Default priority on app init warms gallery first, then clips, then games (shortest-first)
- [ ] Existing tests pass, new tests cover both foreground modes and priority restore
