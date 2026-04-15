# T1510: Admin "Login as User" (Impersonation)

**Status:** TODO
**Type:** Feature — Admin tooling
**Priority:** 2.5 (unblocks debugging user-reported issues without credential handoff)
**Created:** 2026-04-15

## Problem

Admin support / debugging today requires one of:

1. Asking the user to screen-share or describe their state.
2. Logging into a scratch account that doesn't have the user's data.
3. Pulling the user's DB locally and poking at it out-of-app.

None of these reproduce the user's actual in-app experience. The
admin panel already shows a user list with email/credits/created_at;
making the username a link that drops the admin into the app *as* that
user closes the loop.

## Scope

- Clickable username/email in the admin user list → starts an
  impersonation session for that user.
- Red persistent banner app-wide while impersonation is active, with a
  "Stop impersonating" button that restores the admin's own session.
- Every impersonation start/stop written to an audit log in
  `auth.sqlite` (not the target user's DB).
- Works correctly with existing auth middleware — all backend reads /
  writes route to the target user's DB + R2 prefix without code
  changes elsewhere.

## Design

### Session shape

The session cookie (or server-side session record, whichever matches
current auth) carries two identities while impersonating:

```
user_id           = target user (app behaves as them)
impersonator_id   = admin (present only when impersonating)
impersonation_ttl = absolute expiry, 60 min
original_session  = admin's prior session ref (to restore on stop)
```

`user_context.py` continues to resolve `user_id` the same way — 99% of
backend code (R2 prefixing, SQLite-per-user, credit balances) keeps
working unchanged. Only new code reads `impersonator_id`.

### Endpoints

| Method | Path | Guard | Behavior |
|--------|------|-------|----------|
| POST | `/api/admin/impersonate/{target_user_id}` | `_require_admin()` | Write audit row, mint impersonation session, return cookie + target user profile |
| POST | `/api/admin/impersonate/stop` | session has `impersonator_id` | Write audit row, restore admin's original session, clear impersonation cookie |
| GET | `/api/auth/me` | any | Extended: return `{user_id, email, is_admin, impersonator: {id, email} | null}` |

**Hard rules:**
- Target user_id comes from the path param, never from a client store.
- Admin cannot impersonate another admin (avoids privilege laundering).
- TTL is short (60 min default) — expired session drops back to admin.

### Frontend

- [AdminScreen.jsx](src/frontend/src/screens/AdminScreen.jsx) user list: wrap email cell in a button that POSTs to impersonate endpoint, then navigates to `/` and refreshes auth state.
- New `<ImpersonationBanner />` component, rendered app-wide, **fixed to the bottom of the viewport** (not the top — the top bar has too much valuable UI to cover). Full-width red bar, sits above any bottom nav, uses safe-area-inset-bottom on mobile. Shows target email + "Stop impersonating" button when `authStore.impersonator != null`. Must not be dismissable.
- [authStore.js](src/frontend/src/stores/authStore.js) extended with `impersonator` field populated from `/api/auth/me`.
- On "stop", POST stop endpoint, clear local caches (editorStore, adminStore), reload to admin view.

### Audit log

New table in `auth.sqlite`:

```sql
CREATE TABLE impersonation_audit (
  id INTEGER PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'start' | 'stop' | 'expire'
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Must live in `auth.sqlite` (global), not per-user DB — admin actions
should not be scoped to the target user's DB (which they could
technically delete from within the impersonated session).

### Write actions while impersonating

**Default: allow.** The whole point is to reproduce the user's
experience, which includes writing. Every write made during an
impersonated session is already attributed to `target_user_id` via the
normal data path. The audit log trail (start → stop) bounds the window.

Optional follow-up (not this task): tag DB writes with
`impersonator_id` so forensics can distinguish admin-authored rows
from user-authored ones. Skipped here to keep scope tight.

## Files

### Backend
- `src/backend/app/routers/admin.py` — new impersonate start/stop endpoints
- `src/backend/app/services/auth_db.py` — `impersonation_audit` schema + insert helpers
- `src/backend/app/user_context.py` — expose `impersonator_id` alongside `user_id`
- `src/backend/app/routers/auth.py` — extend `/me` response

### Frontend
- `src/frontend/src/screens/AdminScreen.jsx` — clickable email
- `src/frontend/src/components/ImpersonationBanner.jsx` — NEW
- `src/frontend/src/App.jsx` — mount banner
- `src/frontend/src/stores/authStore.js` — `impersonator` field + start/stop actions

## Open questions (resolve in design stage)

1. **Session mechanism.** Does current auth use server-side session
   records or stateless JWTs? Impersonation needs server-side so we
   can revoke on stop — if we're currently stateless, we need a
   minimal server-side layer just for impersonation sessions.
2. **WebSocket reconnect on swap.** Existing WS connections hold the
   admin's identity until reconnect. Options: force reconnect on
   start/stop, or require a full page reload (simpler). Recommend the
   reload — cheap for an admin-only flow.
3. **Interaction with T1190 (machine pinning).** When T1190 lands, an
   impersonation session must pin to the target user's machine
   (because their DB is there). Flag in T1190's design doc so this is
   handled at the same time rather than as a follow-up fix.
4. **Stop-impersonating on admin logout.** If admin closes tab / logs
   out while impersonating, next admin login should not auto-resume
   the impersonation. Session TTL handles this but confirm.
5. **Admin-cannot-impersonate-admin.** Enforce or allow? Default
   enforce; revisit if there's a real support case that needs it.

## Acceptance

- [ ] Admin clicks email in user list → app reloads as that user,
      banner visible.
- [ ] All per-user backend calls (projects list, clips, credits)
      return the target user's data.
- [ ] "Stop impersonating" returns admin to admin view within one
      request.
- [ ] Session expires after TTL without crashing — drops to admin
      login or admin session restored.
- [ ] `impersonation_audit` rows written for every start/stop/expire.
- [ ] Admin cannot impersonate another admin.
- [ ] E2E test: admin → impersonate user → see user's data → stop →
      back to admin.

## Out of scope

- Per-row `impersonator_id` tagging on DB writes (see "Write actions"
  section) — future follow-up.
- Read-only impersonation mode — not requested.
- Bulk / batch impersonation. Always one target at a time.
- Non-admin "share session" features (support handoff between users).
