# T3430: Parallelize Game Load Requests

**Epic:** For Launch - Infrastructure
**Priority:** P1
**Complexity:** 3
**Impact:** 7
**Status:** TODO

## Problem

Opening a game triggers 4 sequential API requests. Each waits for the previous to complete before firing:

```
games/1 (733ms) -> playback-url (378ms) -> teammate-shares (383ms) -> R2 video (223ms) = 1.7s
```

Plus `/api/clips/teammate-tags` fires in parallel with `games/1` but contends on the thread pool.

All three follow-up endpoints (playback-url, teammate-tags, teammate-shares) only need `game_id`, which is known before any fetch fires. They could all fire in parallel.

## Evidence

Production HAR (game load):
- /api/games/1: start 37ms, end 1160ms (733ms wait + 387ms blocked on preflight)
- /api/clips/teammate-tags: start 36ms, end 1157ms (739ms wait + 381ms blocked)
- /api/games/1/playback-url: start 1161ms, end 1566ms (378ms wait) -- sequential
- /api/clips/teammate-shares/1: start 1572ms, end 1990ms (383ms wait) -- sequential
- Total: 2323ms

## Implementation

### Option A: Frontend parallelization (simpler)

Fire all 4 requests in parallel when the game is selected:

```js
const [gameData, tags, playbackUrl, shares] = await Promise.all([
  apiFetch(`/api/games/${gameId}`),
  apiFetch(`/api/clips/teammate-tags`),
  apiFetch(`/api/games/${gameId}/playback-url`),
  apiFetch(`/api/clips/teammate-shares/${gameId}`),
]);
```

Saves 761ms (playback-url + teammate-shares no longer sequential). But 4 concurrent requests contend on the 1-CPU thread pool.

### Option B: Game bootstrap endpoint (eliminates contention)

New `GET /api/games/{game_id}/load` returns everything in one call:

```json
{
  "game": { ... },
  "playback_urls": { "video_url": "...", "recap_url": "..." },
  "teammate_tags": [ ... ],
  "teammate_shares": [ ... ]
}
```

Eliminates thread pool contention (1 request vs 4) + 3 CORS preflights + 3x per-request overhead.

### Recommendation: Option B

Same pattern as the page-load bootstrap. One request, no contention, no preflight overhead. Expected time: ~375ms baseline + ~400ms queries = ~775ms (vs 2323ms current).

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/games.py` | Add GET /api/games/{game_id}/load endpoint |
| `src/frontend/src/screens/AnnotateScreen.jsx` (or hooks) | Consume single game-load endpoint |
| `src/frontend/src/hooks/useGameUpload.js` | Update if teammate-tags fetch is here |

## Acceptance Criteria

- [ ] Opening a game fires 1 API request instead of 4
- [ ] Game load time < 1s on warm machine (vs 2.3s current)
- [ ] No CORS preflights for game navigation (single URL, cached after first visit)
- [ ] Individual endpoints still work for refresh/polling
