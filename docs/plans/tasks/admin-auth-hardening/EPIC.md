# Epic: Admin Auth Hardening — close the `X-User-ID` production bypass

**Created:** 2026-09-01
**Impact:** 10
**Status:** STAGING — both children merged to master 2026-09-01 (T8300 `bc312f54`, T8290 `00a3ece9`)

## Goal

Remove the `X-User-ID` header's ability to authenticate a request on production, without
breaking the operator tooling that currently depends on it.

## Why this is an epic and not one task

The security fix and the tooling migration **cannot be separated**, and the order is forced:

- `scripts/task-manager.py` (the task board, used constantly) and `scripts/promote-bugs.py`
  authenticate to prod admin endpoints today by sending an admin's `user_id` as `X-User-ID`.
  That only works *because* of the bypass being removed.
- Land T8290 first and the task board breaks against prod the moment it deploys.
- Land T8300 first and nothing breaks: the scripts move to real session-cookie auth, which
  already works today and keeps working after the bypass is gone.

So: **T8300, then T8290.** Strict order, no overlap.

## Sequencing directive (2026-09-01, user)

T8290 does not start until T8300 has landed.

**Counter-pressure that must not be lost:** T8290 is a P0 with a live, ~3-month-old
production exposure window (see its task file for the proof and the blast radius). The
dependency is real, but it is not a reason to let this epic sit. Both children are small.
Target both in the **same deploy**, ideally the same working session, T8300 first. If T8300
turns out to be bigger than expected, that is a signal to escalate the epic, not to let
T8290 drift behind it.

## Children (strict order)

| # | ID | Task | Why it is here |
|---|----|------|----------------|
| 1 | T8300 | [Operator scripts to session-cookie auth](T8300-operator-scripts-cookie-auth.md) | Removes the only real dependency on the bypass, so T8290 can land without breaking the task board |
| 2 | T8290 | [Remove the `X-User-ID` prod auth bypass](T8290-xuserid-prod-admin-auth-bypass.md) | The actual security fix: `db_sync.py` carve-out + the unguarded `shares.py` reads |

## Shared context

The bypass has two independent halves, both live on production:

1. **`db_sync.py:826-833`** — reads `X-User-ID` when `APP_ENV != "production" **or
   is_admin_route**`. The `or is_admin_route` clause is the carve-out, added by `5e88e51cb`
   (2026-05-26) after `86df81f4c` (2026-04-22) had closed the hole. Reaches all 42 admin
   endpoints, and `POST /admin/impersonate/{id}` escalates it to full account takeover by
   returning a genuine `rb_session` cookie.
2. **`shares.py:179` and `:194`** — read the header with **no environment guard at all**.
   `/api/shared/` is in `AUTH_ALLOWLIST_PREFIXES`, so these are reachable unauthenticated.

Only half 1 is what the operator scripts depend on. Half 2 has no legitimate consumer and
could in principle be fixed independently, but it is kept in T8290 so the "is the header ever
trusted in prod?" question gets one answer, tested once, rather than two.

`app/routers/auth.py:432-444` guards its own header read correctly
(`if APP_ENV != "production"`). That is the reference pattern for both fixes.

## Completion criteria

- No code path on production derives request identity from an `X-User-ID` header.
- Regression tests, written failing first, assert this for the admin routes AND for each
  affected `shares.py` route, with `APP_ENV="production"`.
- Cookie auth still works on all of those routes.
- The task board and `promote-bugs.py` work against prod with no `X-User-ID` header present.
- Prod logs have been grepped for `/api/admin/` + `(via header)` over 2026-05-26 to the fix
  date, and any non-tooling hit has been triaged (see T8290's "Before patching" section).

## Notes

Found 2026-09-01 during the Tbug49p production remediation for bknoto@gmail.com. The
remediation itself ran on the bypass, which is how it surfaced. The prior session's handoff
had filed it as an unexplained curiosity rather than a vulnerability.
