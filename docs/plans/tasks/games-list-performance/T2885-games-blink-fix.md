# T2885: Games Blink Fix (Stale-While-Revalidate)

**Status:** TESTING
**Impact:** 4
**Complexity:** 1
**Created:** 2026-05-15
**Updated:** 2026-05-15

## Problem

`fetchGames()` sets `isLoading: true` (gamesDataStore.js:66) which blanks the game list even when valid data already exists in the store. With T2880's presigned URL cache the API responds in <500ms, making this imperceptible in practice -- but the code is still wrong: valid data shouldn't be discarded during a background refetch.

Secondary issue: 6+ call sites trigger `fetchGames()` on mount/navigation, causing redundant `GET /api/games` calls within seconds of each other.

## Solution

### 1. Only show loading state on first load

Change `fetchGames()` to only set `isLoading: true` when `games` array is empty. If games already exist, fetch silently and swap on completion.

### 2. Freshness guard to skip redundant fetches

Add a `lastFetchedAt` timestamp to the store. At the top of `fetchGames()`, skip if data is <30s old (unless `force: true`). This eliminates redundant network calls from mount effects (FramingScreen, ProjectsScreen, App.jsx) without needing to touch each call site.

## Context

See [EPIC.md](EPIC.md) for the full performance analysis.

T2880 reduced `/api/games` TTFB from 3.2s to <500ms warm, making the blink imperceptible. This task is now a correctness/polish fix rather than a critical UX bug.

### Relevant Files

- `src/frontend/src/stores/gamesDataStore.js` - `fetchGames()` (line 66 sets isLoading)

### Call sites that trigger fetchGames() (no changes needed -- freshness guard handles all)

| Trigger | Caller | Line |
|---------|--------|------|
| Page load | `App.jsx` | 138 |
| Auth login | `App.jsx` | 264 |
| Screen mount | `FramingScreen.jsx` | 124 |
| Screen mount | `ProjectsScreen.jsx` | 115 |
| Share resolution | `SharedAnnotationView.jsx` | 92, 212 |
| Profile switch | `profileStore.js` | 229 |
| After annotation | `gamesDataStore.js` | 325 (conditional on viewedDuration > 0) |

Profile switch (`profileStore.js:229`) calls `reset()` first which clears `lastFetchedAt`, so the subsequent `fetchGames()` correctly runs (different profile = different games).

## Implementation

### Steps

1. [ ] Add `lastFetchedAt: null` to gamesDataStore initial state
2. [ ] At the top of `fetchGames()`, skip if `!force && lastFetchedAt && (Date.now() - lastFetchedAt) < 30000`
3. [ ] Change `set({ isLoading: true, error: null })` to `set({ isLoading: get().games.length === 0, error: null })`
4. [ ] After successful fetch, set `lastFetchedAt: Date.now()` alongside the games data
5. [ ] Ensure `reset()` clears `lastFetchedAt: null` (so profile switch refetches)
6. [ ] Verify: no blink on navigation, games stay visible during background refetch

## Acceptance Criteria

- [ ] No visual blink when navigating between screens (games stay visible during background refetch)
- [ ] Redundant `GET /api/games` calls eliminated (only 1 call per 30s window unless forced)
- [ ] Profile switch still triggers a fresh fetch (reset clears lastFetchedAt)
- [ ] First page load still shows loading state when games array is empty
- [ ] `invalidateGames()` / `force: true` bypasses freshness guard
- [ ] Frontend tests pass
