# T8290: `X-User-ID` header is a live authentication bypass for the whole admin surface on production

**Status:** TODO
**Impact:** 10
**Complexity:** 3
**Created:** 2026-09-01

## Problem

On **production**, sending the raw header `X-User-ID: <an admin's user_id>` with **no cookie and
no bearer token** authenticates the request as that admin. Confirmed empirically 2026-09-01
against `https://api.reelballers.com`:

```bash
curl -s "https://api.reelballers.com/api/admin/users?search=..." \
     -H "X-User-ID: 3ed03fb5-949d-4cfd-b708-0c758ea68ef3"
# -> full admin user list: every email, credit balance, revenue figure
curl -s -X POST "https://api.reelballers.com/api/admin/impersonate/<any-user-id>" \
     -H "X-User-ID: 3ed03fb5-949d-4cfd-b708-0c758ea68ef3"
# -> 200 + a real Set-Cookie: rb_session=... for that user
```

This is **not** misconfiguration and **not** a dev-only leftover. `APP_ENV` really is
`"production"` (proved: `GET /api/admin/me` returns `{"is_admin":true,"environment":"production"}`),
and the general bypass is correctly closed — `GET /api/profiles` with the same header returns
401. The hole is a deliberate carve-out for admin routes specifically.

### Mechanism

`src/backend/app/middleware/db_sync.py:826-833`:

```python
# SECURITY: Only enabled in dev/staging -- never in production,
# except for /api/admin/ routes (which have their own admin gate).
is_admin_route = request.url.path.startswith("/api/admin/")
if not user_id and (APP_ENV != "production" or is_admin_route):
    raw_user_id = request.headers.get('X-User-ID')
    if raw_user_id:
        sanitized = ''.join(c for c in raw_user_id if c.isalnum() or c in '_-')
        if sanitized:
            user_id = sanitized
            auth_source = "header"
```

The sanitized string is passed straight to `set_current_user_id(user_id)` (`db_sync.py:881`).
No signature, no cookie, no secret — the header **becomes** the request identity.

The comment's justification ("which have their own admin gate") is circular, and is the entire
bug. `_require_admin()` (`app/routers/admin.py:55-59`) does:

```python
user_id = get_current_user_id()   # <- whatever the header said
if not is_admin(user_id): raise HTTPException(403, ...)
```

`is_admin()` (`app/services/auth_db.py:236-244`) is a plain DB lookup against `admin_users`.
The gate answers *"is this user an admin?"* but nothing ever answers *"is the caller actually
this user?"* — the attacker supplies the answer to the question that is never asked.

### Git archaeology

| Commit | Date | Effect |
|---|---|---|
| `86df81f4c` | 2026-04-22 | "Gate X-User-ID auth bypass to dev/staging only -- block in production" — **closed** the hole |
| `5e88e51cb` | 2026-05-26 | "bug card UI cleanup + **allow X-User-ID for admin routes on prod**" — **reopened** it for admin routes |

Exposure window: **2026-05-26 to present (~3 months).**

The carve-out exists to serve operator scripts: `scripts/task-manager.py:197-205` and
`scripts/promote-bugs.py:34` authenticate to prod admin endpoints by sending an admin's user_id
as `X-User-ID`. The docstring at `task-manager.py:197-198` still claims this "works for local
dev/staging where the header fallback is enabled", unaware the carve-out extended it to prod.

### Second, independent bypass (unguarded, also live on prod)

`src/backend/app/routers/shares.py:179` and `:194` read the raw header with **no env check at
all**. `/api/shared/` is in `AUTH_ALLOWLIST_PREFIXES` (`db_sync.py:636`), so those requests pass
the middleware with no user context (`db_sync.py:837-844`) and the handlers then trust the
header directly. Exposes:

- `PATCH /api/shared/{token}` (`:1136-1152`) and `DELETE /api/shared/{token}` — ownership check
  is `share["sharer_user_id"] != user_id`, satisfied by asserting the sharer's id. Flip any
  share public, or delete it.
- `POST /api/shared/{token}/claim` (`:795`) — claim a game link as an arbitrary user.
- The private-share recipient gate (`:867-869`, `:902`, `:953`) compares the header-derived
  email to `recipient_email` — supply the recipient's user_id, receive the private media.

(For contrast, `app/routers/auth.py:432-444` guards its header read correctly with
`if APP_ENV != "production"`. That is the pattern to copy.)

## Blast radius

**Proved:**
- **All 42 admin endpoints.** 41 call `_require_admin()` (the exception, `GET /admin/me`, is
  intentionally public); every one is satisfied by the header. Includes reads (`/admin/users` —
  emails, credit balances, revenue; `/admin/analytics/*`; `/admin/bugs/*` incl. user
  screenshots) and **writes**: `POST /admin/users/{id}/grant-credits`, `/set-credits`,
  `/users/bulk/email` (mass email to the entire user base), `/users/bulk/grant-credits`,
  `DELETE /admin/bugs/purge`, `POST /admin/migrate-postgres`, `POST /admin/credits/open-gate`.
- **Full enumeration of every user_id in the system** via `GET /api/admin/users`, which
  bootstraps every other attack.
- Non-admin routers (`projects`, `clips`, `games`, ...) are **not** directly reachable by the
  header — the 401 on `/api/profiles` proves it.

**Escalation to full account takeover:** `POST /api/admin/impersonate/{target}`
(`admin.py:665-702`) calls `create_impersonation_session(...)` then `_set_session_cookie(...)`,
returning a genuine `rb_session` cookie for any non-admin target — which then works on **every**
route in the app, not just `/api/admin/`. The only guard is `is_admin(target)` blocking
admin-to-admin impersonation (`:682`), irrelevant when the attacker is already the admin.

**Why a user_id is not a secret** (this is what makes it urgent rather than theoretical):
- `src/frontend/src/utils/sessionInit.js:93` and `:184` attach `X-User-ID` to **every** API
  request in production, unconditionally. An admin using the app broadcasts the credential in
  plaintext on every call — visible in devtools, in any HAR capture (we capture HARs for perf
  work, see the har-analysis skill), and to any browser extension or proxy.
- `db_sync.py:873-878` logs `user={user_id}` in plaintext on every request, so it is in
  application logs and any aggregation/error-tracking sink.
- `GET /api/auth/me` returns the caller's own user_id; `GET /api/admin/users` returns everyone's.

A UUID printed in logs and sent on every request is an **identifier**. This code promotes it to
a **credential**.

## Solution

1. **`db_sync.py:826-827`** — delete the `is_admin_route` variable and the `or is_admin_route`
   clause; restore `if not user_id and APP_ENV != "production":`. This should break nothing in
   the admin UI, because the frontend sends the session cookie and the cookie path is tried
   first (`db_sync.py:802-821`); the carve-out only ever served curl-style scripts.
2. **`shares.py:171-194`** — wrap both header reads in `if APP_ENV != "production":`, matching
   `auth.py:432`.
3. **Operator tooling** — `scripts/task-manager.py:203-207` already supports real cookie auth.
   Delete the UUID branch at `:204-205`, have operators paste an `rb_session` cookie, and fix
   the stale docstring at `:197-198`. Same for `scripts/promote-bugs.py:34`.
4. **Regression tests** (bug-reproduction skill, failing first): with `APP_ENV="production"`,
   assert `X-User-ID` alone yields 401/403 on an admin route AND on each `shares.py` route
   above; assert cookie auth still succeeds on both.

## Before patching: check for exploitation

`auth_source` is logged, so exploitation is greppable in prod logs. Search for `[REQ]` lines
matching `/api/admin/` together with `(via header)` over 2026-05-26 → present. Any hit that is
not our own tooling (`task-manager.py` / `promote-bugs.py`) is a real intrusion.

Because user_ids cannot be rotated, treat any confirmed hit as full compromise of the affected
accounts, and audit `admin_impersonation` log rows (`log_impersonation`, `admin.py:689`) plus
credit-grant history for the same window.

## Notes

Found 2026-09-01 while doing the Tbug49p production remediation for bknoto@gmail.com — the
remediation itself depended on this bypass (the prior session's handoff had filed "why does
`X-User-ID` work on prod?" as an unexplained curiosity). Reported to the user, who chose to file
rather than fix immediately. **Fixing this will break `scripts/task-manager.py` and
`scripts/promote-bugs.py` until step 3 lands — do steps 1-3 together.**
