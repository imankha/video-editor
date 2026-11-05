# T14970: Deep-linkable editor URLs: game and play ids in the path, cold load hydrates the editor

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (routing change across the three editor modes; design gate on the URL grammar)
**Created:** 2026-11-03
**Updated:** 2026-11-05

User request 2026-11-03: "when a user left a page, and they come back, they come back at the
same page, and when I impersonate them I see the last page (as exact as possible) to the one
they left, so I could more easily debug drop offs." This is piece 1 of 3: nothing can be
resumed until a page has an address.

## Problem

Today the URL names only the mode: `/home` (with tab sub-routes `/home/games`, `/home/reels`,
`/home/published`), `/annotate`, `/focus`, `/overlay`, `/admin`
(`MODE_PATHS` in `src/frontend/src/stores/editorStore.js`). Which game is open in Annotate and
which play is open in Focus or Overlay lives only in memory (`activeAnnotateGameId`,
`projectDataStore.selectedClipId`, `focusStore.currentClipId`) plus sessionStorage breadcrumbs
(`src/frontend/src/utils/pendingNavigation.js`: `pendingGameId`, `annotateResumeGameId`,
`pendingProjectId`). A cold hit on `/focus` or `/overlay` with no project in memory bounces
home by design (App.jsx, the T5677 effect: "deep-linking INTO an editor with a project is out
of scope"). So a page cannot be bookmarked, shared with support, reopened on another device,
or restored by T14980, and an admin cannot be sent to it by T14990.

## Solution

Give every editor page a canonical URL and make cold load hydrate from it.

### URL grammar (approved by the owner 2026-11-05)

The path stays `/focus` although the UI name Focus is retired (T9860): it is the live route in
`MODE_PATHS`, and renaming the route is separate work.

| Page | URL | Hydrates |
|---|---|---|
| Home tab | `/home/games`, `/home/reels`, `/home/published` (unchanged) | tab |
| Annotate a game | `/annotate/g/{gameId}` | game, via the existing `setPendingGame` path |
| Annotate at a time | `/annotate/g/{gameId}?t={seconds}` | playhead seek (already a breadcrumb: `pendingClipSeekTime`) |
| Focus a play | `/focus/p/{projectId}` | project, via `consumePendingProject` semantics |
| Overlay a play | `/overlay/p/{projectId}` | project |
| Admin | `/admin` and its existing sub-paths | unchanged |

The profile is not in the URL: it travels in the `X-Profile-ID` header and the active profile
is a persisted preference already. A URL whose object belongs to another of the user's profiles
is resolved by looking the id up across the user's profiles once (the reference-game link cards
of T5820 already do a cross-profile switch on click) and switching profile before hydrating; if
the id is in no profile, land on `/home/games` with the plain notice "That game is no longer
here", never a silent bounce.

Ids are opaque to the URL layer. Short numeric ids (SQLite rowids) are fine; they are only
meaningful with the session cookie, so they leak nothing.

### Mechanics

- `modeFromPath` keeps returning the mode for the new sub-paths (prefix match), and
  `LEGACY_PATH_REDIRECTS` keeps `/framing` working.
- `updatePath(mode)` grows to `updatePath(mode, { gameId, projectId })` and writes the canonical
  path on every navigation gesture that already pushes history (open game, open play, mode
  switch). The bare `/annotate`, `/focus`, `/overlay` remain valid as "mode with nothing open"
  and keep today's bounce-home behaviour.
- Cold load: App reads the path once at init; for `/annotate/g/{id}` it sets the pending-game
  breadcrumb exactly as a tap on the game card would, then renders; for `/focus/p/{id}` and
  `/overlay/p/{id}` it sets the pending project with the mode. The T5677 bounce-home effect stays
  for the bare paths and for ids that fail to load (404 from the backend), and it says why.
- popstate: the handler resolves mode and object from the path so back and forward between two
  plays work.
- The sessionStorage breadcrumbs stay for the reload-within-tab cases that have no URL (lazy
  chunk reload, cross-device login), but the URL becomes the primary carrier: when both exist
  the URL wins, and the breadcrumb is cleared.

### Rules this must respect

- Navigation is a gesture; writing the URL in the gesture handler is fine. No `useEffect` that
  rewrites the URL from store state (the existing pattern already pushes from handlers).
- View state (filters, sort, collapsed panels) never enters the URL or any store that persists;
  only the object being edited and the home tab do.
- Public routes (`/shared/*`, `/privacy`, `/terms`, `/legal`, `/debug/*`) are untouched.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/editorStore.js` - `MODE_PATHS`, `modeFromPath`, `updatePath`, popstate handler, cold-load canonicalization
- `src/frontend/src/utils/pendingNavigation.js` - breadcrumb helpers become secondary to the URL
- `src/frontend/src/App.jsx` - cold-load hydration from the path; the T5677 bounce effect
- `src/frontend/src/components/ProjectManager.jsx` - game and play open handlers write the object id into the path (`TAB_PATHS` unchanged)
- `src/frontend/src/screens/AnnotateScreen.jsx` - consumes game id from the URL first
- `src/frontend/src/modes/FocusModeView.jsx`, `OverlayModeView.jsx` - consume project id from the URL first
- Tests: `editorStore.test.js` (path grammar, legacy redirect, popstate), `editorStore.coldLoad.test.js` (hydration cases: valid id, missing id, other-profile id), e2e `src/frontend/e2e/` spec for reload on an open play landing on the same play

### Related Tasks
- Blocked by: nothing. Checked 2026-11-05 against in-flight work: T15150 is backend only and
  group g-t14900-3 (T14900, T14910, T14920) is admin only; neither shares a file with this task.
- Blocks: T14980 (resume point), T14990 (impersonation lands on the user's page).
- Related: T5677 (bounce-home effect), T12880 (annotate resume within a tab), T5820 (cross-profile game link).

### Technical Notes
- Frontend only. No backend change: the existing game and project GET endpoints return 404 for
  unknown ids, which is the signal the cold-load path needs.
- Keep `HOME_TAB_PATHS` and `ProjectManager`'s `TAB_PATHS` in lockstep (existing landmine).
- The URL is the single source of truth for "what is open" on cold load; the stores are the
  source during the session. No third copy.

## Implementation

### Steps
1. [ ] Design doc (short): the grammar above is approved; list every navigation handler that
       pushes history, define the other-profile resolution.
2. [ ] Failing tests: `modeFromPath` on the new paths; cold load with a valid game id opens
       Annotate on that game; cold load with an unknown id lands home with the notice; reload on
       `/focus/p/{id}` stays on the play.
3. [ ] Implement path grammar, handler updates, cold-load hydration, popstate.
4. [ ] e2e: open a play, reload, assert the same play is open on phone and desktop viewports.
5. [ ] Knowledge doc: add the URL grammar to `.claude/knowledge/annotate.md` (navigation section).

### Progress Log

**2026-11-03**: Filed as the prerequisite for the resume-point request.

**2026-11-05**: Owner approved the URL grammar. Cleared to start ahead of the Spend readiness
milestone: no shared files with in-flight work.

## Acceptance Criteria

- [ ] Every editor page has a canonical URL that reproduces it on a cold load in the same account.
- [ ] Unknown or deleted ids land on Home with a visible notice, never a blank editor or a loop.
- [ ] Back and forward between two plays work.
- [ ] No filter, sort or panel state enters the URL.
- [ ] Legacy `/framing` and the bare mode paths behave as today.
