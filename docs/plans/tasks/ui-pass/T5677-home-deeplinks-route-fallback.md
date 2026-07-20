# T5677: Home tab deep-links + unknown-route fallback

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 7 of 7

## Problem

Audit finding #12, reproduced in the 2026-07-20 drive:

1. Navigating directly to **`/home/games` lands on `/home/reels`** — the URL scheme exists
   (`ProjectManager.jsx:121-127` syncs tab state to `/home/games` vs `/home/reels`, and
   clicking the Games tab does update the URL to `/home/games`) but a cold navigation to
   `/home/games` bounces to the reels tab. Deep links / refreshes / back-button land users on
   the wrong tab.
2. **Unknown routes fall through to `/framing`**: navigating to `/gallery` (a route that
   doesn't exist) rendered the Framing screen. A typo'd or stale URL should land on `/home`
   (or a 404 view), never inside an editor mode on whatever project state happens to be
   loaded.

## Solution

- Make `/home/games` and `/home/reels` authoritative on mount: initialize the tab from the
  URL, not from a default that then rewrites the URL. (Do NOT persist last-open tab anywhere —
  that would be persisted view state, which is banned; the URL *is* the state.)
- Add a catch-all route → redirect to `/home`.
- While in the router: verify `/annotate`, `/framing`, `/overlay` handle a cold hit with no
  pending project (currently they render on whatever store state exists — confirm they
  redirect home when there's nothing loaded, which is likely how `/gallery` ended up "in
  Framing").

## Context

### Relevant Files (REQUIRED)
- App router — top-level route definitions (grep `createBrowserRouter`/`<Route` in `src/frontend/src`)
- `src/frontend/src/components/ProjectManager.jsx:121-127` — tab↔URL sync
- `e2e` — small spec: cold-load `/home/games` shows Games; unknown route redirects `/home`

### Related Tasks
- Epic sibling of T5672/T5675 (same screen, tiny disjoint diff — safe to run parallel with either as it only touches `:121-127` + router files)

### Technical Notes
- URL-as-state, nothing persisted (standing rules: no persisted view state; no redundant state).
- Editor-mode cold-hit behavior: if a fix is needed there, keep it to a redirect — anything
  deeper (state hydration) is out of scope for this epic; file a separate task.

## Implementation

### Steps
1. [ ] Read tab init logic; fix URL-first initialization
2. [ ] Catch-all route → `/home`
3. [ ] Verify editor-mode cold-hit redirect behavior; document what was found
4. [ ] E2E spec for both behaviors

## Acceptance Criteria

- [ ] Cold navigation to `/home/games` shows the Games tab; `/home/reels` shows Reel Drafts
- [ ] Refresh and back/forward preserve the visible tab
- [ ] Unknown route (e.g. `/gallery`) lands on `/home`
- [ ] No new persisted state; E2E spec passes
