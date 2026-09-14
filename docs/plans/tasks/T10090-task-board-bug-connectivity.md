# T10090: Task board's Production/Staging Reported Bugs panels are silently disconnected

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 1
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

The task board's "Production Reported Bugs" / "Staging Reported Bugs" panels have been showing
nothing, which the user read as "no bugs" — but a real prod bug (T10070, reported by
sarkarati@gmail.com) went unnoticed as a result. It's not empty, it's disconnected.

## Root Cause

Both `prod_session` and `staging_session` in `scripts/.task-manager-config.json` are expired
`rb_session` cookies (401 `Authentication required` from `GET /api/admin/bugs` on both
environments, confirmed 2026-09-14). Per T8300's finding, prod's `rb_session` has a 30-day
`Max-Age` and needs re-pasting roughly monthly — this is expected maintenance, not a code bug.
`scripts/task-manager.py`'s `fetch_remote_bugs()` was already handling the 401 correctly and
surfacing it as `envData.error`, but the on-screen indicator (`.bug-offline`, a small muted-gray
pill reading "Session expired") was easy to mistake for an empty/zero state at a glance.

## Fix shipped (2026-09-14, no user gate needed — 6-line UI-only change)

`scripts/task-manager.py`, `renderBugMilestones()`: the auth-error state now renders in red
(`.bug-offline.auth-error`), reads "Session expired - click to reconnect", and clicking the
header directly opens the Bug Config panel (previously it just toggled a collapse state that did
nothing useful in the error case). Board restarted to pick this up.

## What's still needed (blocks on the user)

Re-pasting the cookies is not something this session can do — it requires an authenticated browser
session as an admin. For **both** prod and staging:

1. Log into the admin panel on that environment.
2. DevTools > Application > Cookies > copy the value of `rb_session`.
3. Open the task board, click "Bug Config" (or click the red "Session expired" banner), paste it
   into the matching field, click "Save & Reload Bugs".

Once done, re-run T10070's "locate sarkarati's `bug_reports` entry" step and check both panels are
now populated before considering this closed.

## Context

### Relevant Files (REQUIRED)
- `scripts/task-manager.py` — `fetch_remote_bugs()`, `renderBugMilestones()`, `.bug-offline` CSS
- `scripts/.task-manager-config.json` — holds the two session cookies (gitignored, not committed)
- `.claude/skills/bug-triage/SKILL.md` — same cookies, used by `/bug {id}p` / `/bug {id}s`
- `scripts/promote-bugs.py` — same cookies, used for lifecycle promotion/purge

### Related Tasks
- T10070 depends on this to locate the original in-app report

### Technical Notes
- No code fix can make an expired credential valid — this is credential rotation, not a bug beyond
  the visibility fix already shipped.

## Implementation

### Steps
1. [x] Make the disconnected state visually unmissable instead of looking empty.
2. [ ] User pastes fresh `prod_session` cookie.
3. [ ] User pastes fresh `staging_session` cookie.
4. [ ] Confirm both panels populate; unblock T10070's lookup step.

## Acceptance Criteria

- [ ] Task board's bug panels show real data on both environments.
- [ ] A future cookie expiry reads as "reconnect needed", never as "zero bugs".
