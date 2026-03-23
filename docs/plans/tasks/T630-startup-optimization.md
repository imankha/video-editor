# T630: Startup Request Optimization

**Status:** TESTING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-03-22
**Updated:** 2026-03-22

## Problem

Production HAR profile shows startup takes ~570ms with a serial request chain that adds unnecessary latency. Key issues:

1. **Serial auth chain**: `GET /auth/me` (351ms, returns 401) → `POST /auth/init-guest` (556ms) = **~900ms serial** for new/guest visitors
2. **Duplicate `/api/games` calls**: 3 requests fired (2 cancelled), suggesting multiple components trigger the same fetch
3. **Unnecessary achievement POST on every load**: `POST /quests/achievements/opened_framing_editor` (352ms) fires on page load even when not in framing mode
4. **No parallelization**: `profiles` (572ms), `projects` (571ms), and `exports/active` (352ms) all fire serially after auth completes

### Current Request Waterfall (prod)

```
351ms  GET  /auth/me                          → 401 (serial blocker)
556ms  POST /auth/init-guest                  → 200 (waits for above)
572ms  GET  /profiles                         → 200 (waits for auth)
571ms  GET  /projects                         → 200 (waits for auth)
352ms  GET  /exports/active                   → 200 (waits for auth)
352ms  POST /quests/achievements/opened_...   → 200 (unnecessary)
 33ms  GET  /quests/progress                  → 200
 57ms  GET  /downloads/count                  → 200
 56ms  GET  /games                            → 200
 68ms  GET  /games/pending-uploads            → 200
 70ms  GET  /settings                         → 200
```

## Solution

### 1. Combine auth/me + init-guest into single endpoint
Create `POST /api/auth/session` that checks for existing session and creates guest if needed — one round trip instead of two sequential ones. Saves ~350ms for guest visitors.

### 2. Parallelize post-auth data fetches
After auth resolves, fire these concurrently with `Promise.all`:
- `GET /profiles`
- `GET /projects`
- `GET /exports/active`
- `GET /quests/progress`
- `GET /settings`
- `GET /downloads/count`
- `GET /games`

Currently some of these are triggered by separate `useEffect` hooks that may fire sequentially.

### 3. Deduplicate /api/games calls
Find the multiple components calling `fetchGames()` independently and ensure only one fetch fires per mount cycle (likely `ProjectsScreen` + `ProjectManager` + a store).

### 4. Gate framing achievement to framing mode only
`opened_framing_editor` achievement should only POST when the user actually enters framing mode, not on every page load.

### 5. Consider backend combined init endpoint
A single `POST /api/auth/init` that returns `{ user, profile, settings, quests_progress }` would reduce 4+ requests to 1.

## Context

### Relevant Files
- `src/frontend/src/utils/sessionInit.js` - Auth init chain (me → init-guest → init)
- `src/frontend/src/App.jsx` - Top-level data fetching
- `src/frontend/src/stores/questStore.js` - Quest progress fetch
- `src/frontend/src/stores/exportStore.js` - Active exports fetch
- `src/frontend/src/stores/gamesDataStore.js` - Games fetch (dedup target)
- `src/frontend/src/screens/ProjectsScreen.jsx` - Also fetches games
- `src/frontend/src/components/ProjectManager.jsx` - Also fetches games
- `src/backend/app/routers/auth.py` - Auth endpoints

### Technical Notes
- Fly.io cold start adds ~350ms to first request; combining requests reduces cold-start impact
- CORS preflights (9 OPTIONS requests) add ~24ms each; fewer unique endpoints = fewer preflights
- `Access-Control-Max-Age` header could cache preflights to reduce repeat visits

## Implementation

### Steps
1. [ ] Audit all startup fetches — map which component triggers each request
2. [ ] Deduplicate `/api/games` calls (quickest win)
3. [ ] Gate `opened_framing_editor` to only fire when entering framing mode
4. [ ] Parallelize post-auth fetches with `Promise.all` in a single startup function
5. [ ] (Optional) Create combined auth endpoint to merge me + init-guest
6. [ ] (Optional) Add `Access-Control-Max-Age: 86400` to reduce preflight requests
7. [ ] Verify with HAR profile that startup is faster

## Acceptance Criteria

- [ ] No duplicate API calls on startup
- [ ] Post-auth data fetches run in parallel
- [ ] Achievement POST only fires when relevant
- [ ] Startup time reduced (target: under 800ms total for guest flow)
