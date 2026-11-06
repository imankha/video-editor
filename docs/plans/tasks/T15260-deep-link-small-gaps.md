# T15260: Small deep link gaps left after T14970

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** S to M (frontend only, no schema change)
**Created:** 2026-11-06
**Updated:** 2026-11-06

Low-severity items from independent verification of T14970, none blocking.

## Problem

1. `/overlay/p/{id}` for a play with no working video opens the locked Spotlight mode, instead of
   the step that play can actually use.
2. When a play fails to load with a 500, Home shows with Retry but the URL stays `/focus/p/{id}`.
3. A malformed URL leaves a stale `pendingGameId` in sessionStorage. Nothing opens from it.
4. `FocusScreen.jsx` retry path builds `/api/clips/{id}/file`, a route that does not exist (the real
   ones are `/raw/{clip_id}/file` and `/projects/{project_id}/clips/{clip_id}/file`), so that fallback
   always 404s. Unrelated to profiles.
5. The T14970 backend red for the clip `/file` route only distinguishes the error text, because the
   route already returned 404 for an unknown clip. A test with a real clip in the tab's profile would
   be a stronger proof.

## Solution

Fix each where it lives. Item 1 needs a decision on where such a play should land.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/stores/editorStore.js`, `src/frontend/src/utils/deepLinkRecovery.js`
- `src/frontend/src/screens/FocusScreen.jsx`
- `src/backend/tests/test_t14970_media_profile_param.py`

### Related Tasks

- T14970.

## Acceptance Criteria

- [ ] A play with no working video opens on a usable step.
- [ ] A failed play load leaves a URL that matches the screen.
- [ ] A malformed URL leaves no pending game behind.
- [ ] The FocusScreen retry fallback points at a real route, or is removed.
- [ ] A backend test proves a clip `/file` read through `?profile_id=` from another profile.
