# T4610: Admin check at router level

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Audit item E6 ([audit doc](../audit-2026-07-03-code-quality.md))
**Updated:** 2026-11-13

## In plain words

Sixty admin endpoints each call the admin check by hand. None is missing it today, but one forgotten call in a new endpoint would be an open admin door. Attach the check once for the whole group, keep the two endpoints that are meant to be open to everyone apart, and add a test that lists every admin endpoint and proves it is guarded. Worked when the test fails for an endpoint added without the guard.

## Current facts (checked 2026-11-13)

Checked against the code on 2026-11-13. Where the older text further down disagrees, this section is right.

- `src/backend/app/routers/admin.py` is 4,517 lines with 62 routes; 60 call `_require_admin()` as their first statement.
- The two without it are intentional: `GET /admin/me` (safe for all users) and `POST /admin/impersonate/stop` (authorised by the session's impersonator id). Put them on an unguarded sub-router.
- Add `dependencies=[Depends(require_admin)]` to the main router, delete the 60 calls, add a meta-test over `router.routes`.
- Do this before T5940.

## Problem

[DEP][security] `admin.py` calls `_require_admin()` imperatively at the top of ~25 handlers (:100, :237, :258, :318, :358, :384, :405, :474, :526, :627, :697, :773, :941, :959, :975, :992, :1022, :1103, :1156, :1188, :1279, :1330, :1363, :1389, …). **One forgotten call = an open admin endpoint** — an ordering obligation on every future handler, exactly the per-handler dependence the [DEP] directive removes. Only 3 `Depends()` usages exist in the whole routers/ tree.

## Solution

```python
router = APIRouter(prefix=..., dependencies=[Depends(require_admin)])
```

1. Convert `_require_admin` into a FastAPI dependency (it likely reads the session — check how it gets the request/session today; contextvar middleware exists, so the dependency form may be a 5-line wrapper).
2. Attach at router level; delete all ~25 imperative calls.
3. **Verify no admin route intentionally skips the check** (grep any handler WITHOUT the call today — if one exists, it's either a bug to fix or a route to move OUT of this router; investigate, don't assume).
4. Regression test: unauthenticated + non-admin requests to a sample of admin routes → 401/403; and a meta-test asserting EVERY route on the admin router rejects non-admin (iterate `router.routes` in the test — future handlers are then covered automatically, which is the [DEP] payoff).

## Steps

1. [ ] Read `_require_admin` (:51) + one caller; write the dependency.
2. [ ] The no-check-handler grep; findings in the Progress Log.
3. [ ] Router-level attach; delete imperative calls; meta-test.
4. [ ] `python -c "from app.main import app"` + backend tests + a manual admin-dashboard smoke on dev.

## Acceptance Criteria

- [ ] Zero imperative `_require_admin()` calls remain
- [ ] Meta-test proves every admin route rejects non-admins (including future ones)
- [ ] Admin dashboard functions unchanged for an admin session
