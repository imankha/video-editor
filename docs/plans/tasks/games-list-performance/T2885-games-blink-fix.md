# T2885: Games Blink Fix (Stale-While-Revalidate)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-05-15
**Updated:** 2026-05-15

## Problem

Every time the user navigates between screens, the game list flashes: games are visible, then disappear, then reload 1-3s later. Two root causes:

### 1. Store clears UI during fetch

`fetchGames()` sets `isLoading: true` (gamesDataStore.js:66) which blanks the list even when valid data already exists in the store.

### 2. Redundant fetches from 6+ call sites

Production log shows 7 `GET /api/games` calls in a single session:

| Trigger | Caller | Why redundant |
|---------|--------|---------------|
| Page load | `App.jsx:138` | Needed (first fetch) |
| Screen mount | `FramingScreen.jsx:124` | Refetches on every mount via useEffect |
| Screen mount | `ProjectsScreen.jsx:115` | Refetches on every mount via useEffect |
| After annotation | `gamesDataStore.js:325` | `finishAnnotation()` calls `fetchGames()` unconditionally |
| Auth login | `App.jsx:264` | Fires on auth transition |
| Shared view | `SharedAnnotationView.jsx:92,212` | On share resolution |
| Profile switch | `profileStore.js:229` | On profile change |

The combination means: navigate to annotate -> come back -> `fetchGames()` fires -> `isLoading: true` blanks the list -> 2s later games reappear.

## Solution

### 1. Stale-while-revalidate pattern

Only set `isLoading: true` if `games` array is empty (first load). If games already exist, fetch silently in the background and swap on completion.

### 2. Guard redundant fetchGames() calls

`FramingScreen` and `ProjectsScreen` mount effects should check if games are already loaded before fetching.

### 3. Targeted update after finishAnnotation()

Replace `finishAnnotation()` -> `fetchGames()` with a targeted store update of the affected game's view progress data. The annotation API response already contains the updated game data -- use it directly instead of refetching the entire list.

## Context

See [EPIC.md](EPIC.md) for the full performance analysis.

Depends on T2880's backend improvements to make background refetches fast enough that stale data is only shown briefly.

### Relevant Files

- `src/frontend/src/stores/gamesDataStore.js` - `fetchGames()` (line 66 sets isLoading), `finishAnnotation()` (line 325 triggers refetch)
- `src/frontend/src/App.jsx` - Initial fetch (line 138), auth transition fetch (line 264)
- `src/frontend/src/screens/FramingScreen.jsx` - Mount effect fetch (line 124)
- `src/frontend/src/screens/ProjectsScreen.jsx` - Mount effect fetch (line 115)
- `src/frontend/src/containers/SharedAnnotationView.jsx` - Share resolution fetch (lines 92, 212)
- `src/frontend/src/stores/profileStore.js` - Profile switch fetch (line 229)

## Implementation

### Steps

1. [ ] Change `fetchGames()` to only set `isLoading: true` when `games` array is empty
2. [ ] Guard `FramingScreen` and `ProjectsScreen` mount fetches -- skip if games already loaded
3. [ ] Replace `finishAnnotation()` -> `fetchGames()` with targeted store update of the affected game
4. [ ] Verify: no blink on navigation, games stay visible during background refetch

## Acceptance Criteria

- [ ] No visual blink when navigating between screens (games stay visible during background refetch)
- [ ] No redundant `GET /api/games` calls after finish-annotation
- [ ] Profile switch still triggers a fresh fetch (needed -- different profile has different games)
- [ ] First page load still shows loading state when games array is empty
- [ ] Frontend tests pass
