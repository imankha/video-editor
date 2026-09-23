"""T11040 - migration exceptions raised during session-init must not become 500s.

`user_session_init` runs INSIDE DBSyncMiddleware (`ensure_database` ->
`run_profile_seam`), and it can raise `MigrationBlocked` / `BelowMigrationFloor`.
Starlette's app-level exception handlers in main.py sit BELOW user middleware, so
an exception raised there never reaches them -- it escapes `BaseHTTPMiddleware`
as `RuntimeError: No response returned` and the client gets an opaque 500.

Observed in prod (reel-ballers-api, 2026-09-23 04:38:58) as exactly that
RuntimeError. The middleware now translates both exceptions itself; these tests
pin the translation to the SAME contract main.py promises, since the frontend
routes its retry behaviour off the status code and the `code` field.
"""

import json

from app.middleware.db_sync import migration_exception_response
from app.migrations import BelowMigrationFloor, MigrationBlocked


def _body(response):
    return json.loads(bytes(response.body).decode())


def test_migration_blocked_maps_to_retryable_503():
    exc = MigrationBlocked("user-1", "profile-1", "wal_busy")
    response = migration_exception_response(exc, "/api/games/4/load")

    assert response.status_code == 503
    assert _body(response)["code"] == "pending_migration"


def test_below_floor_maps_to_non_retryable_500():
    exc = BelowMigrationFloor("profile_db", 3, 7)
    response = migration_exception_response(exc, "/api/games/4/load")

    # Deliberately NOT 503: retrying can never lift a below-floor DB, so the
    # client must not spin on it (T5089).
    assert response.status_code == 500
    assert _body(response)["code"] == "schema_below_floor"


def test_the_two_outcomes_stay_distinguishable():
    blocked = migration_exception_response(MigrationBlocked("u", "p", "not_at_head"), "/x")
    floored = migration_exception_response(BelowMigrationFloor("user_db", 1, 9), "/x")

    assert blocked.status_code != floored.status_code
    assert _body(blocked)["code"] != _body(floored)["code"]
