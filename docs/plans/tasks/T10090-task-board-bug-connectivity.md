# T10090: Task board's Production Reported Bugs panel is silently disconnected

**Status:** STAGING
**Impact:** 6
**Complexity:** 1
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Resolved 2026-09-14

User re-pasted a fresh `prod_session` cookie via Bug Config. Confirmed working: the full bug-report
triage pass (T10070/T10080/T10090/T10110/T10120) ran successfully against live prod data
immediately after.

## Problem

The task board's "Production Reported Bugs" panel has been showing nothing, which the user read
as "no bugs" — but a real prod bug (T10070, reported by sarkarati@gmail.com) went unnoticed as a
result. It's not empty, it's disconnected.

## Root Cause

`prod_session` in `scripts/.task-manager-config.json` is an expired `rb_session` cookie (401
`Authentication required` from `GET /api/admin/bugs`, confirmed 2026-09-14). Per T8300's finding,
prod's `rb_session` has a 30-day `Max-Age` and needs re-pasting roughly monthly — this is expected
maintenance, not a code bug. `scripts/task-manager.py`'s `fetch_remote_bugs()` was already
handling the 401 correctly and surfacing it as `envData.error`, but the on-screen indicator
(`.bug-offline`, a small muted-gray pill reading "Session expired") was easy to mistake for an
empty/zero state at a glance.

## Fixes shipped (2026-09-14, no user gate needed)

1. **Visibility**: `renderBugMilestones()` now renders the auth-error state in red
   (`.bug-offline.auth-error`), reads "Session expired - click to reconnect", and clicking the
   header directly opens the Bug Config panel (previously it just toggled a collapse state that
   did nothing useful in the error case).
2. **Staging bug-report support removed entirely** (user decision 2026-09-14 — not needed):
   dropped the "Staging Reported Bugs" panel, the staging cookie field from the Bug Config form,
   `staging_session`/`staging_url` from the `/api/bug-config` GET/POST payloads, and the `/api/bugs`
   backend fetch loop now only queries prod. `scripts/.task-manager-config.json` still carries
   `staging_session`/`staging_url` on disk (unused by the board now, but `promote-bugs.py --env
   staging` and `/bug {id}s` still read the same file directly — left alone, out of scope here).

Board restarted to pick up both changes.

## Why cookies instead of a direct DB connection (user asked)

The task board is a local script on the operator's machine; the `bug_reports` table lives in Fly
Postgres, which is not reachable from a local machine without an explicit tunnel
(`fly proxy ...:5432`) plus a separate set of raw Postgres credentials — a materially bigger secret
than a session cookie to store in a script config file, and one that bypasses the API's
authorization/business logic entirely (status filtering, `duplicate_of` clustering, purge rules
all live in the endpoint, not just the table). This was also a deliberate security fix, not
convenience: T8300/T8290 (2026-09-01, admin-auth-hardening epic) specifically retired an older
`X-User-ID` header bypass that these same tools used to use to reach admin endpoints without a
real session, because that header was live and exploitable on prod. Session-cookie auth through
the normal admin API is the one authorization choke point for every admin surface (interactive
panel and scripts alike) — a direct DB path would reopen a second, unaudited way in. The real cost
is the 30-day expiry needing a manual re-paste; that's what the visibility fix above is for.

## What's still needed (blocks on the user)

Re-pasting the cookie is not something this session can do — it requires an authenticated browser
session as a prod admin.

1. Log into the admin panel on production.
2. DevTools > Application > Cookies > copy the value of `rb_session`.
3. Open the task board, click "Bug Config" (or click the red "Session expired" banner), paste it
   in, click "Save & Reload Bugs".

Once done, re-run T10070's "locate sarkarati's `bug_reports` entry" step and check the panel is
populated before considering this closed.

## Context

### Relevant Files (REQUIRED)
- `scripts/task-manager.py` — `fetch_remote_bugs()`, `renderBugMilestones()`, `/api/bugs`,
  `/api/bug-config`, `.bug-offline` CSS
- `scripts/.task-manager-config.json` — holds `prod_session` (gitignored, not committed)

### Related Tasks
- T10070 depends on this to locate the original in-app report

### Technical Notes
- No code fix can make an expired credential valid — this is credential rotation, not a bug beyond
  the visibility fix already shipped.

## Implementation

### Steps
1. [x] Make the disconnected state visually unmissable instead of looking empty.
2. [x] Remove staging bug-report support (board only; `promote-bugs.py`/bug-triage skill untouched).
3. [x] User pastes fresh `prod_session` cookie.
4. [x] Confirm the panel populates; unblocked T10070's lookup step.

## Acceptance Criteria

- [x] Task board's Production Reported Bugs panel shows real data.
- [x] A future cookie expiry reads as "reconnect needed", never as "zero bugs".
