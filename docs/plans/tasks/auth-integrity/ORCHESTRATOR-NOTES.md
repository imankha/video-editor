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
