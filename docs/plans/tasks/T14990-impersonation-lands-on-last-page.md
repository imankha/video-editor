# T14990: Impersonation opens the user's last page, and the admin sees where they left off

**Status:** WIP
**Impact:** 8
**Complexity:** 3
**Tier:** M (admin read + one flag on the impersonate flow; no schema change)
**Created:** 2026-11-03
**Updated:** 2026-11-08

User request 2026-11-03: "when I impersonate them I see the last page (as exact as possible)
to the one they left, so I could more easily debug drop offs." Piece 3 of 3.

## Problem

Impersonation lands on `/` (`authStore.startImpersonation` sets `window.location.href = '/'`)
and the admin then has to guess where the user was. The user detail panel shows the session-exit
trail (T7515: last screen and dwell) but not the object: which game, which play, which step,
what dialog was on screen. Debugging a drop-off means reconstructing the page by hand.

## Solution

### 1. Admin sees the resume point before impersonating

In `UserDetailPanel.jsx`, a "Where they left off" row above the session-exit trail, read from
T14980's `user_resume_points` through the existing admin user-detail endpoint (one join):

> Focus, crop step, play 8124 in "Lucas U12" (profile Lucas), playhead 0:37, dialog
> "Insufficient credits" open, mobile web, build 412, 2 days ago.

Each part is rendered from the point's closed vocabularies; game and play titles are resolved
by the admin read that already opens the user's profile DB read-only for the panel (no new
cross-user path). When no point exists: "no resume point (never navigated since build N)",
never blank.

### 2. "Open where they left off" impersonation

A second action next to "Impersonate" in `UserTable.jsx` and the detail panel: **Impersonate
at their last page**. Flow:

- Same `POST /api/admin/impersonate/{id}` (audit log unchanged), then
  `window.location.href = point.path + '?profile=' + point.profile_id + (t ? '&t=' + t : '')`
  instead of `/`. T14970's hydration opens the object; T14980's restore branch is skipped because
  the arrival is a deep link.
- **The page opens in the point's profile, before any object loads.** Game and play ids are
  per profile, and an id that also exists in the profile the session starts on would otherwise
  open that profile's object with no error, so the admin debugs the wrong page. The URL's
  `?profile=` (T14970 grammar, added by the owner 2026-11-06) does this: it is set in the
  impersonating tab only, with no `PUT /api/profiles/current`. Always build the URL with the
  profile: without it T14970 treats the URL as an old bookmark, and on a 404 its search calls
  `switchProfile`, which would change the user's active profile. The user's own active profile
  preference must not change, because impersonation never moves user state; assert that in the
  e2e. If the point's profile no longer exists, land on Home with the notice and say so in the
  banner, never in another profile.
- The admin's own T14980 restore is not involved (the cookie now belongs to the user).
- The impersonation banner (`ImpersonationBanner.jsx`) shows the point summary and a
  "Reopen their page" link, so after wandering the admin can jump back to the exact spot.
- While impersonating, the user's resume point is never written (T14980's guard), so leaving
  does not move it. Covered by an e2e assertion: impersonate, navigate elsewhere, stop; the
  user's point is unchanged.

### 3. "As exact as possible" within the rules

The point carries step, playhead and the open dialog name (T14980). This task adds the
read-side rendering of those and, when the point's `dialog` is set, re-opens that dialog on
arrival for the impersonating admin only (a one-shot `?dialog=` query param consumed by the
screen; never for the real user, whose own restore does not reopen dialogs because the dialog
may be the thing that drove them away). Form drafts, filters and scroll are out of scope by
the view-state rule.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - user detail payload gains `resume_point` with resolved titles (read only, `mode=ro` profile open as the panel already does)
- `src/backend/tests/test_admin.py` - resume point in the detail payload, test-account and deleted-user cases
- `src/frontend/src/components/admin/UserDetailPanel.jsx` - "Where they left off" row
- `src/frontend/src/components/admin/UserTable.jsx` - second impersonate action
- `src/frontend/src/stores/authStore.js` - `startImpersonation(targetUserId, { landAt })`
- `src/frontend/src/components/ImpersonationBanner.jsx` - point summary + "Reopen their page"
- `src/frontend/src/screens/AnnotateScreen.jsx`, `modes/FocusModeView.jsx`, `modes/OverlayModeView.jsx` - consume the one-shot `?dialog=` param (impersonation only)
- Tests: `UserDetailPanel.test.jsx`, `UserTable.test.jsx`, `authStore.test.js`, e2e impersonation spec

### Related Tasks
- Blocked by: T14980 (the record), T14970 (the URL).
- Blocked by: T14910 and T14920 landing on master (group g-t14900-3, branch
  `feature/T14900-T14910-T14920-journey-transitions-coloured-green`). That group owns
  `routers/admin.py`, with uncommitted edits as of 2026-11-05, and `stores/adminStore.js`, which
  `UserTable.jsx` reads. `dotask start` refuses the overlap while the group is live.
- Related: T1510 (impersonation), T7520 (profile header clearing on impersonate; keep
  `clearProfileHeader()` before the navigation), T7515 (session-exit trail), T14020 (trail in
  the panel).

### Technical Notes
- No schema change. Reads only in the admin path; the one write is the existing impersonation
  audit row.
- `X-Profile-ID` is cleared before navigating (T7520 invariant); the URL's `?profile=` (T14970) is
  verified against the user's profiles before it becomes a header, so the admin lands in the
  point's profile with no cross-tenant header, and the user's active profile is unchanged.
- Privacy: the admin already has impersonation; this adds no new access, only a faster path to
  what they could reach by clicking. The audit row is identical.

## Implementation

### Steps
1. [ ] Failing backend test: detail payload carries the point with resolved titles and
       `profile_id`; null case.
2. [ ] Failing frontend tests: row renders each vocabulary value; action navigates to the point
       path; banner shows summary; `?dialog=` reopens only under impersonation.
3. [ ] Implement; e2e: impersonate at last page lands on the play; user's point unchanged after.
       Same-id e2e: a user with game id N in two profiles, point in the non-active profile; the
       admin lands on that profile's game, and the user's active profile is unchanged after.
4. [ ] Screenshots phone and desktop of the panel row and the banner.

### Progress Log

**2026-11-03**: Filed from the owner's request.

**2026-11-05**: The T14970 worker found ids collide across profiles, so landing in the point's
profile is now a requirement, not an assumption about T14970.

## Ruling

**(owner, 2026-11-08)**, decided on the decision page https://claude.ai/artifact/WRiswtLxEB9ovE4L7WdVGd:
- **No new button** (Q4). Clicking the user's email in `UserTable.jsx` already starts impersonation;
  that click now lands on the resume point when one exists, and on `/` as today when none does.
  No "Impersonate at their last page" action and no "Start at Home" link. The detail panel's
  existing impersonate entry, if any, behaves the same way. Section 2's second action is replaced
  by this.
- Reopen the recorded dialog for the impersonating admin only, via the one-shot `?dialog=` (Q5 A).
  Impression logging already skips impersonated sessions (T7510 guard), so nothing is counted.

## Acceptance Criteria

- [ ] Admin sees screen, step, object titles, playhead, dialog, platform, build and age before
      impersonating; null state is explicit.
- [ ] Clicking the user's email to impersonate lands on the same page as the user's own restore
      would, with the dialog reopened when one was recorded; with no point it lands on `/`. No new
      button is added.
- [ ] When the same id exists in two of the user's profiles, the admin lands on the object in the
      point's profile, and the user's active profile is unchanged afterwards (e2e).
- [ ] Impersonation never changes the user's resume point (e2e).
- [ ] Banner offers "Reopen their page" at any time during the session.
