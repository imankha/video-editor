# T14970: Deep-linkable editor URLs: game and play ids in the path, cold load hydrates the editor

**Status:** STAGING
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

### URL grammar (approved by the owner 2026-11-05; profile added by the owner 2026-11-06)

The path stays `/focus` although the UI name Focus is retired (T9860): it is the live route in
`MODE_PATHS`, and renaming the route is separate work.

| Page | URL | Hydrates |
|---|---|---|
| Home tab | `/home/games`, `/home/reels`, `/home/published` (unchanged) | tab |
| Annotate a game | `/annotate/g/{gameId}?profile={profileId}` | profile, then game via `setPendingGame` |
| Annotate at a time | `/annotate/g/{gameId}?profile={profileId}&t={seconds}` | plus playhead seek (`pendingClipSeekTime`) |
| Focus a play | `/focus/p/{projectId}?profile={profileId}` | profile, then project |
| Overlay a play | `/overlay/p/{projectId}?profile={profileId}` | profile, then project |
| Admin | `/admin` and its existing sub-paths | unchanged |

Every navigation that writes an editor URL includes the current profile. Ids are per-profile
SQLite rowids, so the same id can exist in two profiles; the URL's profile says which one.

**The URL's profile is held by the tab, not the account.** It is set on `X-Profile-ID` before any
object loads, and it never calls `PUT /api/profiles/current`: restoring a page is read-only, and
T14990 must leave the user's active profile unchanged. Media elements cannot send that header,
so their URLs always carry `?profile_id=`, which the request middleware accepts for reads of a
profile the user owns and refuses with a 404 otherwise.

A profile the user does not own, or one that no longer exists, lands on `/home/games` with the
plain notice ("That game is no longer here"), never on the current profile. If ownership cannot
be checked, it lands there with the retryable error instead, because "no longer here" would be
a guess.

A URL with no profile (an old bookmark) keeps the earlier behaviour: it opens in the current
profile, and on a 404 looks the id up across the user's profiles once, switches, and gains the
profile in place. The T7670 email link (`/?game=&profile=`) keeps its own path.

### Mechanics

- `modeFromPath` keeps returning the mode for the new sub-paths (prefix match), and
  `LEGACY_PATH_REDIRECTS` keeps `/framing` working.
- `updatePath(mode)` grows to `updatePath(mode, { gameId, projectId, seekTime })` and writes the canonical
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
- The existing game and project GET endpoints return 404 for unknown ids, which is the signal
  the cold-load path needs. One backend change, added with the profile (2026-11-06): the request
  middleware reads `?profile_id=` on GET and HEAD for media and poster routes when there is no
  `X-Profile-ID`, because media elements cannot send the header. An unowned value on a media
  route is a 404; posters keep T7940's 403.
- Keep `HOME_TAB_PATHS` and `ProjectManager`'s `TAB_PATHS` in lockstep (existing landmine).
- The URL is the single source of truth for "what is open" on cold load; the stores are the
  source during the session. No third copy.
- A profile held by the tab lasts until the tab reloads a URL without one: `/api/auth/init` then
  returns the account's active profile.

## Implementation

### Steps
1. [x] Design doc (short): the grammar above is approved; list every navigation handler that
       pushes history, define the other-profile resolution.
2. [x] Failing tests: `modeFromPath` on the new paths; cold load with a valid game id opens
       Annotate on that game; cold load with an unknown id lands home with the notice; reload on
       `/focus/p/{id}` stays on the play.
3. [x] Implement path grammar, handler updates, cold-load hydration, popstate.
4. [x] e2e: open a play, reload, assert the same play is open on phone and desktop viewports.
5. [x] Knowledge doc: add the URL grammar to `.claude/knowledge/annotate.md` (navigation section).

### Progress Log

**2026-11-03**: Filed as the prerequisite for the resume-point request.

**2026-11-05**: Owner approved the URL grammar. Cleared to start ahead of the Spend readiness
milestone: no shared files with in-flight work.

**2026-11-05**: Implemented; design in `T14970-design.md`. `?t=` is read on cold load and not
written by navigation. Beyond the listed files: `ProjectsScreen.jsx` is the real project consumer
(FocusModeView and OverlayModeView needed no change), and `sessionInit.js` lets a caller name
`X-Profile-ID` for the cross-profile lookup.

**2026-11-05**: Live testing findings fixed before landing: Back across the Plays link, a false
games error after an unknown id, `?t=` ignored on multi-video games, no notice for malformed ids.
Also fixed a race the Back test exposed: an open finishing after the user left it.

**2026-11-06**: Owner added the profile to editor URLs (see the grammar). Same change: recovery
reports UNAVAILABLE rather than a false "no longer here" and uses the tab's own profile; bootstrap
settles on every path; the T7670 link survives URL canonicalization; a cold `/home/reels` stays on
Plays (the projects store said "not loading" before its first load).

**2026-11-06**: Independent verification fixes. Watch plays no longer overwrites the address (its history entry keeps the page's URL). The T7670 link moved to `utils/emailGameLink.js`: a profile that cannot be selected lands on Games with the notice and never opens the id in the current profile, and a game missing from the list gets the notice too. A malformed or empty `?profile=` lands on Games, not Plays. Same-origin video URLs that lacked the tab's profile now name it, and the clip `/file` route honours `profile_id`.

**2026-11-06**: Owner approved the landing change on bare paths: on an account with plays, `/annotate`, `/home`, `/`, `/framing`, `/focus` and `/overlay` land on `/home/reels`, and `/nonsense` lands on `/home`.

## Acceptance Criteria

- [x] Every editor page has a canonical URL that reproduces it on a cold load in the same account.
- [x] Unknown or deleted ids land on Home with a visible notice, never a blank editor or a loop.
- [x] Back and forward between two plays work.
- [x] No filter, sort or panel state enters the URL.
- [x] Legacy `/framing` and the bare mode paths behave as today.
- [x] An id that exists in two profiles opens in the profile the URL names.
- [x] An unowned or deleted profile in the URL lands on Games with the notice, never the current profile.
- [x] Opening a URL never changes the account's active profile.
- [x] `?t=` survives a cross-profile open and a reload.
- [x] The T7670 email link opens the right game in the right profile.
