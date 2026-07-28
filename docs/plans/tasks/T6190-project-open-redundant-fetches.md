# T6190: Opening a reel refetches the drafts data before the editor loads

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-07-28
**Updated:** 2026-07-28

## Problem

User report (2026-07-28, imankh): *"when I click on a reel in my drafts the first thing it
seems to do is reload the current view before trying to load the framing or overlay."*

Confirmed from a prod HAR (`Downloads/app.reelballers2.com`, 14 entries). Clicking a draft
tile for project 52 (framing mode) produces:

| t (ms) | dur | request | verdict |
|--------|-----|---------|---------|
| 2054 | 535 | `GET /api/projects/52` | needed |
| 2591 | 658 | `PATCH /api/projects/52/state?update_last_opened=true&current_mode=framing` | needed (fire-and-forget) |
| 2592 | 660 | `GET /api/clips/projects/52/clips` | needed (#1) |
| 3275 | 1461 | `GET /api/clips/projects/52/clips/55/playback-url` | needed — **this is what gates video** |
| 3277 | 1460 | `GET /api/health` | **redundant on this path** |
| 3277 | 1460 | `GET /api/clips/projects/52/clips` | **duplicate of #1** |
| 3279 | 1458 | `GET /api/games` | **redundant — this is the "reloading the drafts view" the user sees** |
| 4758 | 976 | R2 range request (first video bytes) | — |

First video byte lands **2.7s after the click**.

The user's perception is accurate but the cause isn't ProjectsScreen re-fetching. All three
redundant calls come from mounting the editor subtree:

1. **`GET /api/games`** — `FramingScreen.jsx:139-142` unconditionally calls `fetchGames()` on
   mount. It needs the games list only to resolve one display name for the selected clip
   (`FramingScreen.jsx:123` `useReadyGames()`, consumed at `:1013-1016`, passed to the
   container at `:1082`). That data was already hydrated by `/api/bootstrap`
   (`App.jsx:213` `setFromBootstrap`). It is the same payload the drafts list renders from,
   which is why it reads as "reloading the view I just left".
   `fetchGames()` is called without `{force:true}`, but the dedupe at
   `gamesDataStore.js:74` (`if (_fetchPromise && !force)`) only covers an *in-flight*
   request — bootstrap's settled long ago, so a fresh GET goes out.

2. **Duplicate clips fetch** — `useProjectLoader.js:137` fetches clips (call #1), then
   `FramingScreen.jsx:477-479` fetches them again on mount (call #2).
   The comment at `FramingScreen.jsx:476` — *"fetchClips dedupes in-flight requests, so
   concurrent calls from useProjectLoader are free"* — **is wrong for this flow.** The two
   calls are sequential, not concurrent:
   - the only guard is the in-flight latch `_clipsInflight` (`projectDataStore.js:128`,
     checked at `:133-134`), cleared the moment the promise settles (`:149`, `:155`);
   - `loadProject` *awaits* `fetchClips` at `useProjectLoader.js:137`, then runs the metadata
     loop (`:144-180`) and working-video probe (`:212-244`) before returning. Only then does
     `ProjectsScreen.jsx:295` set the mode, which mounts the lazy `FramingScreen`. By then the
     latch is `null`. The ~685ms gap in the HAR is exactly that intervening work + lazy-chunk
     resolve + mount.
   - there is no TTL fallback either: `clipsLoadedAt` is written at `projectDataStore.js:121`
     and `:147` but is **never read anywhere in the codebase** — dead state.

3. **`GET /api/health`** — `ConnectionStatus.jsx:86-88` mount effect. `<ConnectionStatus />`
   renders only in the editor branch (`App.jsx:777`); the home/Drafts branch returns early at
   `App.jsx:728-769`. So entering the editor mounts it for the first time in the session and
   pays a health check exactly when the user is waiting for video.

**Scope note:** OverlayScreen does *not* have the games/clips mount refetches — per the T5670
comment at `OverlayScreen.jsx:99-102` it reads game info from the already-loaded projects list.
So #1 and #2 are Framing-only; #3 affects both Framing and Overlay entry.

**Why this costs more than three wasted requests:** the four requests starting at t=3275-3279
each take ~1460ms and all complete within 2ms of each other (~4737). That is queueing, not four
independent latencies — the one request that gates playback (`playback-url`) finishes only when
the three redundant ones do. Root-causing that serialization is **T6200**; this task removes the
redundant load regardless of what T6200 finds.

## Solution

Remove the three redundant requests from the project-open critical path. No new abstractions.

1. **`FramingScreen.jsx:139-142`** — drop the unconditional `fetchGames()`. The store is already
   hydrated from bootstrap; read the cached value. If a staleness guarantee is genuinely wanted,
   gate on a TTL rather than fetching every mount.
2. **`FramingScreen.jsx:477-479`** — drop the mount-only `fetchClips`. `loadProject` already
   fetched them ~685ms earlier in the same navigation. The effect's stated intent is "pick up
   changes made in annotate mode" — satisfy that by either gating on `clipsLoadedAt` staleness
   (which finally makes that dead field earn its keep) or invalidating clips when leaving
   annotate. Do **not** leave the misleading dedupe comment behind.
3. **`App.jsx:777`** — hoist `<ConnectionStatus />` out of the editor-only branch so its one-shot
   health check isn't paid at navigation time.

Prefer the smallest change that holds: if the annotate-edit case can be covered by invalidating
on the *gesture* that leaves annotate, that's better than a TTL — it matches the project's
gesture-based rule and removes the guesswork.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FramingScreen.jsx` — mount effects at `:139-142` (games) and `:477-479` (clips); `useReadyGames()` at `:123`, consumed `:1013-1016`, `:1082`
- `src/frontend/src/stores/projectDataStore.js` — `fetchClips` `:130-162`, `_clipsInflight` `:128`, dead `clipsLoadedAt` `:40`/`:121`/`:147`
- `src/frontend/src/stores/gamesDataStore.js` — `fetchGames` `:65-116`, dedupe `:74`, `invalidateGames` `:48-51`
- `src/frontend/src/hooks/useProjectLoader.js` — `loadProject`, clips fetch `:137`, state PATCH `:124-127`, metadata loop `:144-180`, working-video probe `:212-244`
- `src/frontend/src/components/ConnectionStatus.jsx` — `checkConnection` `:37-83`, mount effect `:86-88`
- `src/frontend/src/App.jsx` — bootstrap hydration `:213`, home branch early-return `:728-769`, `<ConnectionStatus />` `:777`
- `src/frontend/src/screens/ProjectsScreen.jsx` — `handleSelectProjectWithMode` `:259-304`
- `src/frontend/src/components/DraftTile.jsx` — `handleCardClick` `:253-279`

### Related Tasks
- Blocks nothing; pairs with **T6200** (backend serialization) — same HAR, independent fixes.
- Same family as T2500/T2510 (page-load fetch dedup, Page Load Optimization epic) but a
  different trigger: this is project-*open* navigation, not app boot.

### Technical Notes
- Do not "fix" this by adding a longer-lived in-flight latch or a blanket request cache — that
  hides the real issue (two owners fetching the same data) behind a cache. One owner per fetch.
- `clipsLoadedAt` is currently dead state. Either use it or delete it; don't leave it written
  and unread.
- Verify with a fresh HAR, not by reasoning about the code — the ordering here is timing
  dependent (`fetchGames` yields on `await import('./authStore')` at `gamesDataStore.js:68`,
  which is why it lands last on the wire despite its effect being declared first).

## Implementation

### Steps
1. [ ] Remove the `fetchGames()` mount effect from FramingScreen; confirm the game display name still renders from the bootstrap-hydrated store
2. [ ] Remove the mount-only `fetchClips` from FramingScreen; cover the annotate-edit case via invalidation-on-leaving-annotate (preferred) or a `clipsLoadedAt` TTL
3. [ ] Delete or make-live the dead `clipsLoadedAt` field
4. [ ] Hoist `<ConnectionStatus />` above the editor/home branch split in App.jsx
5. [ ] Fix the incorrect dedupe comment at `FramingScreen.jsx:476` (or remove it with the effect)
6. [ ] Re-capture a HAR of the same click and compare against the table above

### Progress Log

**2026-07-28**: Filed from user report + prod HAR analysis. Call sites traced and verified
against source; not yet fixed.

## Acceptance Criteria

- [ ] Clicking a draft into Framing fires **no** `GET /api/games`
- [ ] Clicking a draft into Framing fires `GET /api/clips/projects/{id}/clips` exactly **once**
- [ ] No `GET /api/health` on the project-open critical path
- [ ] Editing clip boundaries in Annotate, then entering Framing, still shows the updated boundaries (the case the removed effect existed for)
- [ ] Game display name still renders correctly in Framing
- [ ] Connection-status indicator still works in the editor
- [ ] Fresh HAR shows first R2 video byte measurably earlier than the 2.7s baseline
- [ ] Frontend unit tests pass
