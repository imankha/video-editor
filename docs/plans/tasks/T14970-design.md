# T14970 design: deep-linkable editor URLs

Grammar is owner-approved, with the profile added 2026-11-06 (see the task file). This records
how it is wired.

## Current state

The URL names only the mode. The open game and play live in memory and sessionStorage, so a
cold `/focus` bounces home (T5677) and a cold `/annotate` only recovers inside the same tab
(T12880).

## Target state

```
cold load  -> parseEditorPath -> adopt into breadcrumb (URL wins)
           -> sessionInit verifies ?profile= and sets the tab header BEFORE announcing the session
           -> existing consumers open it
gesture    -> setEditorMode(mode[, ids]) -> updatePath writes .../{id}?profile={tab profile}
popstate   -> parseEditorPath -> adoptTabProfile if the entry names another profile
           -> breadcrumb + urlNavigationSeq bump -> same consumers re-run
404        -> recoverDeepLink -> URL names its profile: /home/games + notice
                              -> old bookmark: search, switch and reopen, or /home/games + notice
```

The URL stays a carrier into the existing breadcrumb consumers (AnnotateScreen's consume
effect, ProjectsScreen's resume effect). FocusModeView and OverlayModeView need no change:
they only render once ProjectsScreen has opened the project.

## Navigation handlers that push history

All go through `updatePath` in editorStore: `navigateTo`, `setEditorMode`, `confirmModeSwitch`,
`goToProjectManager`. `redirectToMode` replaces. Rather than editing ~30 call sites, `updatePath`
resolves the object at the gesture: explicit ids, then the pending game breadcrumb (every open
sets it just before `setEditorMode`) or `selectedProjectId`, then the id already in the path.
No effect ever rewrites the URL.

Two call sites pass or write ids explicitly:
- `handleLoadGame` success: `setEditorMode(ANNOTATE, { gameId })`, the breadcrumb is consumed by then.
- New upload `onGameCreated`: replaces `/annotate` with `/annotate/g/{id}` once the id exists.

## The URL's profile

Tab-scoped, because restore is read-only and T14990 must leave the user's active profile alone.
`PUT /api/profiles/current` on load was rejected for both reasons.

- **Cold load:** `/api/auth/init` treats `profile_id` as a hint and answers with the active profile,
  so an unowned value would silently fall back. `sessionInit` compares the two and, when they
  differ, checks `GET /api/profiles` before sending the value as a header. Owned: the tab uses it.
  Not owned: `rejectUrlProfile` drops the queued breadcrumbs and lands on Games. Check failed:
  same landing with the retryable error. All of this runs before `setSessionState`, so nothing
  renders first.
- **First sign-in:** that path skips `initSession`, so the check above has not run. `onAuthSuccess`
  runs the same check (`applyUrlProfile`) before it opens the session. It cannot reload instead:
  `pendingAction` is a closure and would be lost.
- **Back and forward:** an entry naming another profile switches to home, runs `adoptTabProfile`
  (header, clear and refetch stores, no PUT), then opens. The same id in another profile counts as
  a changed object.
- **Displayed current:** `profileStore` marks the tab's profile, so the switcher agrees with the data.
- **Media:** `<video>` and `<img>` cannot send headers and would read the active profile's row.
  `withTabProfile` always adds `?profile_id=`, even when the tab matches the account right now,
  because another tab can switch the account and this one would not hear about it. The middleware
  reads it on GET and HEAD with no header, on media and poster routes only, for an owned profile.
  An unowned value on a media route is a 404, never the active profile's bytes; on a poster it
  falls through to T7940's route-level 403. It is never honoured for a write.
- **`?t=`:** kept while the same game stays open, and passed explicitly when a profile switch reopens
  it, because the switch goes through `/home`.

## Other-profile resolution (old bookmarks)

Ids are per-profile rowids. On a 404 from a URL-driven open with no `?profile=` (a stale in-session
tap keeps today's toast, and a URL with `?profile=` is not searched), `utils/deepLinkRecovery.js`:

1. Waits for bootstrap to settle, or its late `setFromBootstrap` would overwrite the switched
   profile's stores. `settleBootstrapAfter` fires on every path, so this cannot hang.
2. Re-probes the tab's own profile (`getProfileId()`, not the server's `isCurrent`). Anything but a
   404 is `UNAVAILABLE`: never call a network failure "no longer here"; the caller keeps its
   retry error. An empty or failed profile list is `UNAVAILABLE` too.
3. Probes each other profile with `GET` and a per-request `X-Profile-ID`. The fetch interceptor
   overwrote caller headers, so it now lets a caller's value win. No caller set one before, and
   the backend PROFILE_GUARD still rejects a foreign id.
4. Found: `switchProfile`, then the caller reopens. Not found: `/home/games` plus the notice.

## Traps handled

- T5677 effect ran with a stale `selectedProjectId` closure on the commit where the resume
  starts. It now also skips while a project breadcrumb is pending.
- ProjectManager's default-tab settle calls `setActiveTab`, which replaces the URL. It is mounted
  under a cold `/focus/p/{id}`, so `landingTabFromPath` answers `games` for a project path. That
  is also the right tab if the open fails.
- ProjectsScreen's once-only resume flag becomes a compare against `urlNavigationSeq`.
- URL canonicalization at module load drops the query, so `?game=&profile=` (T7670) never reached
  App. It now keeps those two on a bare path; other params stay dropped, as a test pins.

## Decisions

- `?t=` is read on cold load and not added by ordinary navigation. Adding it would make a reload
  seek to a stale time instead of the saved playhead (T12880 behaviour). A `t` the URL already
  carries is kept, including across a profile switch.
- A same-id breadcrumb keeps its seek and clip across a chunk reload: that is not a conflict.
- Going home pushes instead of replacing: the entry being left is an address now.
- `projectsStore.loading` starts true, so Home's landing settle waits for real data. That fixes a
  cold `/home/reels` and also moves bare `/home` from Games to Plays for an account with plays,
  which is what the settle always intended. `/home/published` stays on Games by an explicit rule,
  because it had only been reaching Games through the same race.
- Unusable ids (`/focus/p/abc`) get the unknown-id landing and notice.
- `error` on the games and projects stores means the LIST failed; single-object reads leave it alone.
- A newer open beats an older one: `loadProject` drops superseded loads, and ProjectsScreen stops
  before switching mode. Found by live testing: Back during a load pushed a stale mode, erased
  forward history, and could have put one play's clips in another play's editor.
- Same-mode popstate between two plays skips the unsaved-export dialog: edits are persisted per
  gesture, so nothing is lost and the dirty flag belongs to the play being left.

## Risks

- An old bookmark with no profile opens the current profile's object when the same id exists
  there: the 404 search cannot see the collision. New URLs always carry the profile.
- A tab on a non-active profile stays there until a reload of a URL without one. Other tabs and
  background work (export sockets) keep following the account's active profile.
- Dirty-guard popstate to a different mode and a different play confirms into the current
  selection, not the URL's object. Rare; same class as today's bare-path behaviour.
