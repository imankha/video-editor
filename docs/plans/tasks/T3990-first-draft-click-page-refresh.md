# T3990: First Reel-Draft Click Refreshes the App (Stale Lazy Chunk After Deploy)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

The first time a user clicks a reel draft (after the app has been open across a deploy),
the whole app does a full-page refresh instead of opening the draft. Subsequent clicks work
fine. The click isn't lost (a breadcrumb resumes it after the reload) but the visible
hard-refresh feels broken.

This happens often in practice because staging/prod auto-deploy on every push to master while
users keep tabs open.

## Root Cause (confirmed from HAR `app.reelballers2.com`, 2026-06-25)

Editor screens are lazy-loaded with a reload-on-failure wrapper:
- [App.jsx:26-42](../../../src/frontend/src/App.jsx#L26-L42) — `lazyWithReload()` calls
  `window.location.reload()` (once per session, guarded by `sessionStorage['chunk-reload']`)
  when a lazy `import()` rejects.

The HAR proves the exact mechanism:

| Entry | Request | Status | Content-Type | Size |
|-------|---------|--------|--------------|------|
| 75 (before reload) | `FramingScreen-DTCLD_6e.js` (old hash) | 200 | **`text/html`** | 5366 |
| 77 (the reload) | `GET /framing` | 200 | `text/html` | 5366 |
| 115 (after reload) | `FramingScreen-d19RIewC.js` (NEW hash) | 200 | `application/javascript` | 66951 |

Sequence:
1. Tab loaded on build **A** (19:45). A new build **B** deployed before the click (19:48) —
   the chunk hash changed `DTCLD_6e` -> `d19RIewC`.
2. The still-running build-A tab references build A's chunk name `FramingScreen-DTCLD_6e.js`.
3. Click draft -> route to `/framing` -> `import('FramingScreen-DTCLD_6e.js')`. That file no
   longer exists (build B purged it), so the server returns the SPA fallback `index.html`
   (200, `text/html`, 5366 bytes — identical to entry 77).
4. The browser's dynamic `import()` rejects on `text/html` (not a JS module) ->
   `lazyWithReload`'s `.catch()` fires `window.location.reload()`. **This is the refresh.**
5. After reload the page is build B; the breadcrumb resumes the click
   ([ProjectsScreen.jsx:243-259](../../../src/frontend/src/screens/ProjectsScreen.jsx#L243-L259))
   and the new chunk loads -> "works after that."

**Why first-click-only:** once a module imports successfully it stays in the page's module
registry; only the first lazy editor navigation after a deploy hits the purged chunk.

**Contributing gap:** no periodic service-worker update check (only `registerType: 'autoUpdate'`
in [vite.config.js:18](../../../src/frontend/vite.config.js#L18); no `registration.update()`
interval), so an open tab never learns about build B until a navigation forces the failed import.

## Solution

**Eagerly preload the lazy editor screen chunks once the home screen (`ProjectsScreen`) is idle.**

After `ProjectsScreen` mounts, kick off `import('./screens/FramingScreen')` (and Overlay,
Annotate) during idle time (`requestIdleCallback`, fallback `setTimeout`). This caches the
modules from the **current** build while its chunks still exist on the CDN, so the first draft
click reuses the already-resolved module instead of a late import that can hit a purged hash.

In the captured HAR, a preload at 19:45 (right after load) would have fetched
`FramingScreen-DTCLD_6e.js` successfully into the module registry, so the 19:48 click would NOT
have triggered a failed import or a reload.

Keep `lazyWithReload` + the breadcrumb-resume as the safety net for the rare "deploy happened
while the user sat on the home screen past the preload" case — do NOT remove them.

### Why not the alternatives (decided)
- Graceful "Updating..." overlay: doesn't prevent the refresh, only dresses it up. Rejected.
- Periodic SW update + auto-reload: risks reloading a user mid-edit; larger blast radius.
  Rejected for this task.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/App.jsx` — `lazyWithReload`, the lazy screen definitions (reference only;
  do NOT change the reload safety net). Exports the lazy screens.
- `src/frontend/src/screens/ProjectsScreen.jsx` — home screen; add the idle-preload effect here.
- `src/frontend/src/screens/index.js` (or wherever screens are re-exported) — confirm the import
  paths used for preloading match the lazy import paths in App.jsx so the SAME chunk is reused.

### Technical Notes
- The preload MUST use the identical dynamic-import specifier as `lazyWithReload` in App.jsx
  (e.g. `import('./screens/FramingScreen')`) so Vite resolves it to the same chunk and the
  module registry is shared. A different specifier produces a different chunk and defeats the fix.
- Preloading is fire-and-forget for module loading (NOT app persistence — this rule is about
  network/code, not the gesture-based-persistence rule). Swallow/log errors; a failed preload
  must not surface to the user (the lazyWithReload net still covers the click).
- Prefer `requestIdleCallback` with a `setTimeout(…, ~1500ms)` fallback for Safari. Guard for SSR/
  tests (`typeof window`).
- Do not preload on mobile/slow connections if there's an existing connection-aware util
  (`utils/cacheWarming.js` exists) — check, but a simple idle preload is acceptable; don't
  over-engineer.

## Implementation

### Steps
1. [ ] Add an idle-time preload effect in `ProjectsScreen.jsx` that dynamically imports the
       Framing, Overlay, and Annotate screen chunks using the same specifiers as App.jsx.
2. [ ] Use `requestIdleCallback` (fallback `setTimeout`); run once on mount; clean up the timer.
3. [ ] Swallow + `console.warn` on preload failure (no user-facing error).
4. [ ] Verify the preloaded chunk name matches the lazy chunk name (Vite splits by specifier).

## Acceptance Criteria
- [ ] After landing on the home screen, the editor chunks are fetched during idle (visible in
      Network as `FramingScreen-*.js` etc. shortly after load, status 200, `application/javascript`).
- [ ] First click on a reel draft opens the editor with NO full-page refresh (in the normal case
      where the preload completed before any deploy).
- [ ] The `lazyWithReload` reload + breadcrumb-resume path is left intact as the fallback.
- [ ] Frontend unit tests pass; preload failure does not throw.
