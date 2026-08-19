# T7200: Admin loses admin status after impersonation reload; move Admin entry point into the profile switcher

**Status:** DONE (deployed 2026-08-19 prod)
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-18
**Updated:** 2026-08-18

## Problem

Reported by the admin user (imankh@gmail.com) directly:

1. **Bug:** Impersonating a user, then stopping impersonation, loses admin access — the Admin
   control disappears and `/api/admin/*` calls fail client-side. Root cause: `authStore.checkAdmin()`
   is only invoked from `onAuthSuccess` (first login in a session) and from `setSessionState()` when
   `skipFetches` is `false`. `sessionInit.js`'s `initSession()` always calls `setSessionState(...,
   { skipFetches: true })` on every page load, with a comment claiming "bootstrap will provide
   credits/admin data" — but `GET /api/bootstrap` never returns `is_admin` (only `GET /api/admin/me`
   does). So `isAdmin` resets to `false` on any hard reload and is never recomputed. Both
   `startImpersonation` and `stopImpersonation` do `window.location.href = '/'` (a hard reload),
   which is why this surfaces around impersonation — though the underlying bug affects any hard
   reload, not impersonation specifically.

2. **UI:** The floating `AdminButton` in `App.jsx` (~line 974) has a comment claiming "fixed
   top-right" but its `className` has no `fixed`/`top`/`right` classes, so it renders in normal
   document flow as the last sibling after the page footer — landing at the bottom of the screen.
   User wants it removed and folded into the existing profile-switcher UI instead of fixed in place,
   so opening admin feels like switching to an admin "profile" rather than a separate floating
   control.

## Solution

1. In `authStore.js`, always call `checkAdmin()` when authenticated, regardless of `skipFetches`
   (nothing else ever supplies `is_admin`; `checkAdmin()` already dedups via its own module-level
   promise, so calling it every reload is cheap and safe).
2. Remove the floating `AdminButton` from `App.jsx`. Add an "Admin" row to the top of
   `ManageProfilesModal`'s profile list, gated on `useAuthStore(s => s.isAdmin)`, visually distinct
   from real profiles (shield icon, no sport selector/edit/delete, separated by a divider). Clicking
   it closes the modal and calls `setEditorMode(EDITOR_MODES.ADMIN)` (same action the old button
   performed) instead of `switchProfile`.

## Context

### Relevant Files
- `src/frontend/src/stores/authStore.js` — `setSessionState()` checkAdmin gating fix
- `src/frontend/src/App.jsx` — remove `AdminButton` + its render site; `setEditorMode` for ADMIN mode already exists
- `src/frontend/src/components/ManageProfilesModal.jsx` — add gated "Admin" list entry
- `src/frontend/src/components/ProfileSportButton.jsx` — no change expected (already opens `ManageProfilesModal`); read for context only

### Related Tasks
None.

### Technical Notes
- No backend or schema changes. `GET /api/admin/me` is already safe to call for any authenticated
  user (returns `{is_admin: false}` for non-admins).
- `isAdmin` is the authoritative admin gate (backend-enforced); the "only me" framing from the user
  just describes that there is currently only one admin account, not an additional restriction to
  hardcode by email.

## Implementation

### Steps
1. [x] Investigate root cause of both issues
2. [x] Fix `authStore.setSessionState()` to always call `checkAdmin()` when authenticated
3. [x] Remove floating `AdminButton` from `App.jsx`
4. [x] Add gated "Admin" row to `ManageProfilesModal.jsx`
5. [x] Manual verification in browser (impersonate -> stop -> admin access retained; profile switcher shows Admin row only for admin)
6. [x] Reviewer pass on diff
7. [x] Commit + push, merged to master (2026-08-19, ff-merge via `feature/T7200-admin-profile-switcher`, Branch CI green)

### Progress Log

**2026-08-18**: Investigated and confirmed root cause of both issues via code read (authStore.js,
sessionInit.js, bootstrap.py, App.jsx, ManageProfilesModal.jsx). User confirmed preferred UI
approach (profile-switcher row, not just repositioning the floating button) via AskUserQuestion.

**2026-08-18/19**: Implemented both fixes. Added tests: `authStore.test.js` (checkAdmin always
fires on `setSessionState` regardless of `skipFetches`), `ManageProfilesModal.adminRow.test.jsx`
(Admin row gating, ordering, absence of profile-only controls, click behavior). Updated
`ManageProfilesModal.T6690.test.jsx`'s `../../stores` mock to include the newly-imported
`useEditorStore`/`EDITOR_MODES`. Ran the curated relevant set (`vitest related` on the 3 changed
source files): 81 files / 785 tests passed. Spawned the Reviewer agent on the staged diff — it
found 1 MAJOR (two e2e specs, `T4860-admin-bulk-actions.spec.js` and
`T5770-admin-weekly-usage.spec.js`, drove into the admin panel via the now-removed
`[title="Admin Panel"]` button) and 6 MINOR findings. Fixed the MAJOR by switching both specs to
`page.goto('/admin')` (the existing `MODE_PATHS`/`PATH_TO_MODE` route, covered by
`editorStore.test.js`) and removing their now-redundant manual `checkAdmin()` in-page hack (the
authStore fix makes it fire automatically on load). Addressed 2 of the 6 MINORs: added
`console.warn` on `checkAdmin()`'s failure paths (was silent), and tightened the new admin-row
test to assert DOM order and absence of sport/edit controls instead of just presence. Remaining
MINORs were noted as out-of-scope-for-this-diff (backend `is_admin` round-trip consolidation) or
already-acceptable precedent (dual `stores`/`stores/authStore` import paths, matching
`ProfileSportButton.jsx`).

Manually verified end-to-end in a real browser via Playwright MCP as imankh@gmail.com (dev-login):
home screen has no floating Admin button anywhere (confirmed via full-page screenshot); the
profile-switcher glyph opens `ManageProfilesModal` showing the "Admin" row above the real profile,
divided, with no sport/edit controls; clicking it navigates to `/admin` and opens the real Admin
panel; started impersonating `hello@reelballers.com` from the admin table (confirm dialog ->
impersonation banner appears, red, "Stop impersonating"); clicked Stop impersonating -> hard
reload back to `/`, admin's own data restored; reopened the profile switcher -> **Admin row still
present** (previously would have disappeared here); clicked it again -> `/admin` panel loaded
successfully; checked network log -> every `/api/admin/*` call across the whole flow, including
the `checkAdmin` call fired automatically right after the stop-impersonate reload, returned `200`
(no 403s). All acceptance criteria confirmed.

## Acceptance Criteria

- [x] Impersonate a user, stop impersonating -> Admin entry still present in profile switcher and `/api/admin/*` calls succeed
- [x] Floating bottom-of-screen Admin button is gone
- [x] "Admin" row appears at top of Manage Profiles modal, admin-only, opens Admin panel on click
- [x] Non-admin users see no Admin row and no behavior change to their profile list
- [x] Frontend unit tests pass for touched files
