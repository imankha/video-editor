# Orchestrator Carry-Forward Notes

Running ledger of surprises, shared context, and hand-off notes between
subagents working the Auth Integrity epic. Each task appends a section.

## T1270 — Cookie Path + SameSite

- Branch: `feature/T1270-cookie-path-fix` (NOT merged; awaiting user approval
  and manual Google OAuth / OTP verification).
- `src/backend/app/routers/auth.py` has 4 `set_cookie("rb_session", ...)` calls
  (google_auth ~l.561, init_guest ~l.670, OTP verify ~l.924, test-login
  ~l.979) plus 1 `delete_cookie` in logout (~l.945). All now include
  `path="/"`. If T1290/T1340/T1330 add new cookie call sites, they MUST
  include `path="/"` and `samesite=_SAMESITE` — the AST test in
  `tests/test_auth_cookie_config.py` will catch omissions on all 5+ sites.
- `_SAMESITE` is now an unconditional string literal `"lax"`. Do not change
  it back to a ternary — the AST test resolves `samesite=_SAMESITE` by
  following module-level string-literal assignments and will fail
  (resolve to `None`) if it becomes a conditional expression again.
- `_SECURE_COOKIES` is still environment-driven (`SECURE_COOKIES=true` in
  staging/prod). Leave it alone.
- Test pattern: AST inspection of `auth.py` was chosen over TestClient
  because driving Google OAuth and OTP verify through TestClient requires
  mocking `google.oauth2.id_token.verify_oauth2_token` and the OTP state
  machine. AST inspection gives equivalent coverage in one file with no
  mocks. Future auth tests should follow this pattern for cookie attributes.
- Backend suite has 15 pre-existing failures unrelated to this epic: most
  notable are `test_sync_retry` (`ImportError: retry_pending_sync` — symbol
  no longer exists in `app/middleware/db_sync.py`), `test_annotations_aggregates`
  (6 errors — `/api/games/{id}` returning 404 in the TestClient fixture),
  and `test_admin::test_admin_can_grant_credits` (balance 150 vs expected 50,
  likely test pollution). **T1290 works in `app/main.py` startup and
  `app/services/auth_db.py` — it will not touch these failing suites, but
  be aware they are already red on master.**
- T1290 should assume `test_guest_migration.py` and
  `test_migration_recovery.py` still exist and some are red on master; T1330
  will delete them. Do not fix them under T1290 — scope creep.
- `conftest.py` autouse fixture sets `set_current_profile_id("testdefault")`
  and pre-seeds `_init_cache` for user IDs `"a"` and `"testdefault"`. Any
  new backend auth test that mutates profile context should reset it in
  teardown — otherwise later tests in the same session inherit the change.
- Commits on the branch:
  - `55e1ef1` — failing test
  - `612f037` — fix
  - (docs commit to follow)
- Do not push. Do not merge to master. Orchestrator will do both after
  user approval.

## T1290 — Auth DB Restore

- Branch: `feature/T1290-auth-db-restore-must-succeed` (NOT merged; awaiting
  user approval and manual staging verification of the fatal-fail path).
- Startup touch point is `app/main.py` ~lines 270–274 (now 270–275, a single
  `restore_auth_db_or_fail()` call). The old `if _r2: sync_auth_db_from_r2(); init_auth_db()`
  pattern is gone — T1340 should import the new helper instead if it needs to
  re-trigger auth DB setup (it shouldn't, but heads up).
- `sync_auth_db_from_r2` behaviour CHANGED: it now **raises** on transient /
  non-404 errors instead of swallowing into `return False`. Any other code
  path that calls this function (currently only startup) must treat a raised
  exception as a real failure. Grep: only one call site today, in
  `restore_auth_db_or_fail` itself.
- New `_r2_enabled()` shim in `auth_db.py` wraps `storage.R2_ENABLED` — exists
  purely as a patch target for tests. Don't inline it away.
- Retry wrapper at startup is hand-rolled (not `retry_r2_call`) because the
  retry util retries *transient* errors only — at startup level we want to
  retry any failure from `sync_auth_db_from_r2` including RuntimeErrors, so
  a dedicated 3-attempt loop with exponential backoff (1s → 2s → 4s) lives
  inside `restore_auth_db_or_fail`. `sync_auth_db_from_r2` still uses
  `retry_r2_call` internally for the network-level retries, so the worst case
  is 3 × 4 = 12 download attempts before fatal — acceptable on boot.
- Log conventions: all new lines use the `[AuthDB]` prefix (matches existing
  style). Warnings for attempts 1–2 of 3 retries, error for the final
  attempt, then a `RuntimeError` raise. No `print()`. T1340 should mirror
  the `[AuthX]` bracketed-component prefix when adding startup-time logs.
- Test pattern: `tests/test_auth_db_restore.py` patches `auth_db._r2_enabled`,
  `auth_db.sync_auth_db_from_r2`, and `auth_db.init_auth_db` directly. This
  is the cleanest way to exercise startup retry logic without hitting R2.
  T1340/T1330 auth tests should follow the same "patch the module-level
  seam, not the storage globals" pattern where possible.
- Backend suite remains at 15 FAILED + 6 ERRORS, matching the T1270 baseline
  exactly. Zero new failures from T1290. The earlier estimate of "15
  pre-existing failures" was approximate; the actual count on master is
  15 failures + 6 errors (same as now). If T1340/T1330 see the same number
  they are clean.
- Commits on the branch:
  - `d4ce555` — failing tests
  - `38c3b2e` — fix
  - (docs commit to follow)
- Fly auto-restart behaviour is assumed (standard Fly machine policy on
  non-zero exit) — not re-verified under this task. Manual verification
  steps live in the task file under "Manual Verification".
