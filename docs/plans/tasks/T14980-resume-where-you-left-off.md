# T14980: Resume where you left off: server-held resume point, restored on the next visit

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (new Postgres table + endpoint + frontend restore; Migration agent; design gate)
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "when a user left a page, and they come back, they come back at the
same page." Piece 2 of 3 (after T14970 gives pages an address; T14990 uses the same record for
impersonation).

## Problem

A parent who closes the tab mid-play, or opens the app on another device, lands on Home and
has to find the game and play again. The only resume that exists is per tab (sessionStorage
breadcrumbs), so it dies with the tab and never crosses devices. For the drop-off work this
also means nobody can tell where a user actually was when they left.

## Solution

One small record per user, the **resume point**, written on navigation gestures and on leaving,
read once on the next load, and used only when its target still exists.

### What is recorded (exact enough to debug, small enough to be cheap)

```
{
  "path": "/focus/p/8124",            // T14970 canonical path (object identity); add ?profile=
  "profile_id": "452b…",              // which profile's object
  "screen": "focus",                  // BREADCRUMB_SCREENS vocabulary
  "step": "crop",                     // mode sub-step when the screen has one (focus: crop|review|export; overlay: pick|text|export; annotate: mark|review)
  "t": 37.2,                          // playhead seconds, when a player is on screen
  "dialog": "insufficient_credits",   // the impression name of a blocking dialog open at exit, else null
  "tab": "games",                     // home tab when on Home
  "platform": "mobile_web",           // same vocabulary as user_actions.platform
  "build": 412,                       // APP_BUILD the client was running
  "left_at": "2026-11-03T22:14:09Z"
}
```

Nothing else: no filters, sort orders, collapsed panels, scroll offsets or form drafts. The
owner's standing rule (2026-07-04) that view state is never persisted stays in force; the
resume point is the location of the work, not the view of it.

### Where it lives

A new Postgres table, one row per user, written in place:

```
CREATE TABLE IF NOT EXISTS user_resume_points (
    user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    point      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Why Postgres and not `user.sqlite`: every per-user SQLite write triggers an R2 sync upload
(CAS, versioning), so a write per navigation would be the most frequent write in the app and
the most expensive. The Postgres row is one UPSERT of about 300 bytes, the same class as the
`user_segments.last_active_at` update that already happens per request. Not analytics state:
it is product state the user sees ("Back to the play you were on"), and it is one row per user,
not per event, so the aggregates-only rule for analytics is not what governs it. Migration
`postgres/v{NNN}_user_resume_points.py` plus `_SCHEMA_DDL` in `pg.py`. Take the next free version
on `origin/master` when the migration is written: v042 and v043 are taken, and T15010 and the
paid-ads work (T15200 on the g-t14900-3 branch) also want the next number.

### Writes (gesture-based, surgical)

| Gesture | Write |
|---|---|
| Open a game, open a play, switch mode, change home tab (every handler that already pushes history in T14970) | `POST /api/me/resume-point` with the full point (it is one datum; "surgical" here means the one row, never a second copy) |
| Leave the page (`pagehide` / `visibilitychange` to hidden, the same exit gesture `record_session_exit` uses) | `navigator.sendBeacon` to the same endpoint with `t`, `step`, `dialog` filled in; best effort |
| Sign out, delete account | row deleted (cascade on delete; explicit DELETE on sign-out) |

POST, not PUT: `navigator.sendBeacon` can only POST, so one method serves both rows.

This route must skip the per-user write lock and the R2 sync. `db_sync.py` puts every POST, PUT,
PATCH and DELETE under the lock and starts a sync unless the path is in `SKIP_SYNC_PATHS`, so
unlisted it would make every navigation queue behind uploads, the fault T15090 removed from
`PATCH /parts`. It writes Postgres only, as `/api/email/` does (T13910). Add `/api/me/resume-point`
to `SKIP_SYNC_PATHS` and test that a write takes no lock.

Banned: any `useEffect` that watches store state and writes the point. The step and playhead
are read at the moment of the gesture, never tracked reactively into the server.

Impersonation guard: when the session carries `impersonator_user_id`, the endpoint accepts and
discards (204), exactly like `record_milestone`'s guard, so an admin looking around never
moves the user's own resume point. Covered by a test.

### Restore (read-only, validated, visible)

- `GET /api/auth/me` returns `resume_point` (one join, no extra round trip); the client never
  fetches it separately.
- On a cold load of `/` or `/home` (never when the user arrived with a deep link, a share link,
  a claim link, or a payment return), if the point is under `RESUME_MAX_AGE_DAYS` (30, named
  constant) the client navigates to `point.path` with `?profile={point.profile_id}`, plus `&t=`
  when present. T14970's hydration does the rest: it sets that profile in the tab before
  anything loads, without changing the active profile.
- The target is validated by the hydration itself: a 404 lands on Home with "That game is no
  longer here"; the stale point is then deleted by that gesture's handler (one DELETE), so it
  cannot loop.
- A dismissible chip on arrival, "Picking up where you left off", with a "Go to Home" action.
  No "Saved" copy anywhere (owner rule). Reduced-motion safe, phone first.
- A user who explicitly taps Home has made a gesture; the point updates to Home and the next
  visit lands on Home. There is no setting; the behaviour is the product.

### Analytics side effect (none by design)

The resume point replaces nothing: `record_session_exit` keeps writing its breadcrumb to the
per-user log for the funnel reads. T14990 reads the resume point for one user from the admin
panel; no aggregate is built on it.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/pg.py` - `_SCHEMA_DDL` gains `user_resume_points`
- `src/backend/app/migrations/postgres/v{NNN}_user_resume_points.py` (new; next free version)
- `src/backend/app/middleware/db_sync.py` - `SKIP_SYNC_PATHS` gains `/api/me/resume-point`
- `src/backend/app/routers/users.py` or `auth.py` - `POST /api/me/resume-point`, `DELETE /api/me/resume-point`; `auth_me` returns `resume_point`
- `src/backend/app/services/resume_points.py` (new) - upsert, read, delete, validation of the closed vocabularies (screen, step, dialog slug, platform), size cap
- `src/backend/tests/test_resume_points.py` (new) - upsert, impersonation discard, vocabulary rejection, me payload, cascade on delete
- `src/frontend/src/utils/resumePoint.js` (new) - build the point from current stores at gesture time; `sendBeacon` on exit
- `src/frontend/src/stores/editorStore.js`, `components/ProjectManager.jsx`, `screens/AnnotateScreen.jsx`, `modes/FocusModeView.jsx`, `modes/OverlayModeView.jsx` - call the writer from the navigation handlers T14970 touched
- `src/frontend/src/App.jsx` - cold-load restore branch, chip
- `src/frontend/src/components/ResumeChip.jsx` (new) + test

### Related Tasks
- Blocked by: T14970 (URL grammar and hydration).
- T15150 landed 2026-11-05 (PR #711). It rewrote the write-lock and sync path in `db_sync.py` that
  this route must opt out of; build against that version.
- Feeds: T14990 (impersonation lands on the same point; admin sees it).
- Related: T7515 (session-exit breadcrumbs, same exit gesture), T5677 (bounce-home), T1537
  (fire-and-forget deferred until sessions pin to one machine: the beacon is best effort and
  the gesture POST is the durable write, so this task does not depend on T1537).

### Technical Notes
- Postgres write per navigation: bounded by human tapping speed; the UPSERT touches one row by
  primary key. If load tests show contention, coalesce client-side to one POST per 2 seconds; do
  not move it to SQLite.
- Honour the project persistence rules: gesture to handler to one write of the changed datum;
  restore is read-only; runtime fixups never persisted; "a write path must prove its copy is
  current or fail loudly" does not apply (last-writer-wins is the correct semantics for a resume
  point, and the row carries `updated_at` so the admin can see when).
- The `me` payload grows by one key; `/me` in dev with the X-User-ID bypass returns
  `resume_point: null`.
- Vocabularies are closed sets shared with analytics (`BREADCRUMB_SCREENS`, impression slugs);
  unknown values are dropped server side with a warning, never stored.

## Implementation

### Steps
1. [ ] Design doc (short): table, endpoint, point schema, restore rules, the T14990 read path.
2. [ ] Migration (next free version) + `_SCHEMA_DDL`; Migration agent reviews.
3. [ ] Failing backend tests (upsert, impersonation discard, vocabulary, me payload, cascade).
4. [ ] Failing frontend tests (writer called from each navigation handler with the right point;
       exit beacon fills `t`/`step`/`dialog`; restore navigates; deep-link arrival skips restore;
       404 clears the point and shows the notice; chip renders and dismisses).
5. [ ] Implement; curated test set; phone and desktop screenshots of the chip.
6. [ ] Knowledge: `.claude/knowledge/persistence-sync.md` gains a line that the resume point
       is a Postgres row by design (not user.sqlite) and why.

### Progress Log

**2026-11-03**: Filed from the owner's request. The no-persisted-view-state rule (2026-07-04)
was weighed: the resume point stores the object and position of the work, never filters or
panel state, validates its target before use, and is visible and dismissible, which addresses
the "stale state reads as a broken app" failure that rule was written for.

## Acceptance Criteria

- [ ] Close the tab on a play, reopen the app (same or another device): the same play opens at
      the same step and playhead, with the chip.
- [ ] Arriving by share, claim, payment-return or deep link never triggers the restore.
- [ ] A deleted target lands on Home with the notice and clears the point; no loop.
- [ ] Impersonated sessions never change the user's resume point (test).
- [ ] No filter, sort or panel state is stored; the point schema is closed and validated.
- [ ] Postgres migration + DDL in the same commit; backend test file in the CI shard durations list.
