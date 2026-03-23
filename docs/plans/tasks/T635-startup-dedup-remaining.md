# T635: Startup Request Dedup — Remaining Duplicates

**Status:** TESTING
**Impact:** 4
**Complexity:** 4
**Created:** 2026-03-22
**Updated:** 2026-03-22

## Problem

After T630 parallelized post-auth fetches and deduped games/projects/quests, the localhost HAR profile still shows duplicate API calls on startup. Components mount and fire useEffect fetches before `initSession()` completes, then App.jsx fires them again after auth resolves.

### Remaining Duplicates (from localhost HAR)

| Endpoint | Count | Source |
|----------|-------|--------|
| `/api/profiles` | x2 | profileStore has no dedup guard |
| `/api/quests/progress` | x3 | QuestPanel mount + recordAchievement callback + App.jsx |
| `/api/quests/achievements/opened_framing_editor` | x2 | Fires before auth completes (component renders while auth pending) |
| `/api/settings` | x2 | ProjectManager + another component both call loadSettings |
| `/api/downloads/count` | x3 | Multiple components fetch on mount |
| `/api/games/pending-uploads` | x2 | Multiple sources |

## Solution

### 1. Add dedup guards to remaining stores
Apply the same `_fetchPromise` pattern (from T630) to:
- `profileStore.fetchProfiles()`
- `settingsStore.loadSettings()` (already has `isInitialized` but still duplicates)
- Downloads count fetch

### 2. Centralize all startup fetches in App.jsx
Move remaining startup fetches (settings, downloads/count, pending-uploads) into the `initSession().then()` block in App.jsx so they fire once after auth, in parallel.

### 3. Gate pre-auth component renders
Investigate why `isCheckingSession` doesn't prevent all component mounts. Some fetches (exports/active, achievements) fire before auth/me even starts, suggesting components render in a brief window before the session check begins.

### 4. Deduplicate achievement POST
The `opened_framing_editor` achievement fires twice — likely from a React StrictMode double-render or a re-render cycle. Gate it with a "already recorded this session" flag.

## Context

### Relevant Files
- `src/frontend/src/stores/profileStore.js` - fetchProfiles needs dedup
- `src/frontend/src/stores/settingsStore.js` - loadSettings called from multiple components
- `src/frontend/src/components/DownloadsPanel.jsx` - downloads/count fetch
- `src/frontend/src/hooks/useGameUpload.js` - pending-uploads fetch
- `src/frontend/src/App.jsx` - Central startup orchestration
- `src/frontend/src/stores/authStore.js` - isCheckingSession logic

### Related Tasks
- Depends on: T630 (done)

## Implementation

### Steps
1. [ ] Add `_fetchPromise` dedup to profileStore.fetchProfiles()
2. [ ] Centralize settings, downloads/count, pending-uploads in App.jsx initSession().then()
3. [ ] Add session-level flag to prevent duplicate achievement POSTs
4. [ ] Investigate isCheckingSession timing gap
5. [ ] Verify with HAR profile

## Acceptance Criteria

- [ ] No duplicate API calls on startup (HAR shows each endpoint called exactly once)
- [ ] All data still loads correctly after auth completes
