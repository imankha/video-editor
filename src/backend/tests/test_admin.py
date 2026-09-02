"""
Tests for the admin panel (T550, T3020).

Tests cover:
- admin_users table created on init + seeded with imankh@gmail.com
- is_admin() returns True for admin, False for non-admin
- GET /api/admin/me returns {is_admin: bool} without 403
- GET /api/admin/users returns 403 for non-admin
- GET /api/admin/users returns users with milestones data
- GET /api/admin/users pagination works
- GET /api/admin/users LEFT JOIN returns users without milestones
- POST /api/admin/users/{id}/grant-credits grants credits
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(pg_conn):
    """Fresh Postgres with admin + regular user.

    Uses test-admin@test.local so the email unique constraint doesn't clash
    with real users in the dev database. The admin_users seed (imankh@gmail.com)
    is matched by email, so we insert into admin_users for the test email too.

    The /api/admin/users endpoint INNER JOINs users -> user_segments (T3460:
    the panel only surfaces users that have onboarded segment data), so we
    seed a minimal segment row for each test user. Tests that need richer
    segment/action data layer it via the `milestones_data` fixture.
    """
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
        cur.execute(
            """INSERT INTO user_segments (user_id)
               VALUES ('admin-user'), ('regular-user')
               ON CONFLICT (user_id) DO NOTHING"""
        )
    yield


@pytest.fixture()
def milestones_data(pg_conn):
    """Insert user_segments and user_actions rows for test users."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_segments (user_id, acquired_at, origin, signup_method)
            VALUES
            ('admin-user', '2026-01-15', 'organic', 'google'),
            ('regular-user', '2026-03-10', 'organic', 'otp')
            ON CONFLICT (user_id) DO UPDATE SET
                acquired_at = EXCLUDED.acquired_at,
                origin = EXCLUDED.origin,
                signup_method = EXCLUDED.signup_method
        """)
        actions = [
            ("admin-user", "game_created", 10),
            ("admin-user", "game_upload_succeeded", 1),
            ("admin-user", "clip_created", 25),
            ("admin-user", "export_completed", 5),
            # T8230: per-type export events. export_completed (5) is the generic
            # total; framing (2) + overlay (1) sum to 3, leaving a residual of 2
            # "other"/recovered exports that the total must still surface.
            ("admin-user", "framing_exported", 2),
            ("admin-user", "overlay_exported", 1),
            ("admin-user", "export_failed", 1),
            ("admin-user", "share_completed", 2),
            ("admin-user", "credit_purchased", 3),
            ("admin-user", "credits_consumed", 50),
            ("admin-user", "session_started", 20),
            ("regular-user", "game_created", 3),
            ("regular-user", "clip_created", 8),
            ("regular-user", "export_completed", 1),
            ("regular-user", "session_started", 5),
        ]
        for user_id, action, count in actions:
            cur.execute(
                "INSERT INTO user_actions (user_id, action, count) VALUES (%s, %s, %s)",
                (user_id, action, count),
            )
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    """TestClient wired to a test user context."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client_with_milestones(isolated_auth_db, milestones_data, tmp_path):
    """TestClient with milestones data populated."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


# ---------------------------------------------------------------------------
# auth_db unit tests
# ---------------------------------------------------------------------------

class TestAdminUsersTable:
    def test_table_exists_after_init(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) as cnt FROM admin_users")
            row = cur.fetchone()
        assert row["cnt"] >= 1

    def test_seed_email_present(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM admin_users WHERE email = 'test-admin@test.local'"
            )
            row = cur.fetchone()
        assert row is not None

    def test_seed_is_idempotent(self, isolated_auth_db):
        """Re-seeding must not raise or duplicate the seed."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
            )
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) as cnt FROM admin_users WHERE email = 'test-admin@test.local'")
            row = cur.fetchone()
        assert row["cnt"] == 1


class TestIsAdmin:
    def test_admin_user_returns_true(self, isolated_auth_db):
        from app.services.auth_db import is_admin
        assert is_admin("admin-user") is True

    def test_regular_user_returns_false(self, isolated_auth_db):
        from app.services.auth_db import is_admin
        assert is_admin("regular-user") is False

    def test_unknown_user_returns_false(self, isolated_auth_db):
        from app.services.auth_db import is_admin
        assert is_admin("nonexistent-user") is False


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class TestAdminMe:
    def test_admin_user_gets_true(self, client):
        resp = client.get("/api/admin/me", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True

    def test_regular_user_gets_false(self, client):
        resp = client.get("/api/admin/me", headers=_auth_headers("regular-user"))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False


class TestAdminUsers:
    def test_non_admin_gets_403(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("regular-user"))
        assert resp.status_code == 403

    def test_admin_gets_user_list(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        assert "regular-user" in user_ids

    def test_response_shape(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data
        assert "total_users" in data
        assert "total_pages" in data
        assert "page" in data
        for user in data["users"]:
            assert "user_id" in user
            assert "email" in user
            assert "credits" in user
            assert "origin" in user
            assert "acquired_at" in user
            assert "session_count" in user
            assert "last_active_at" in user

    def test_milestones_data_included(self, client_with_milestones):
        resp = client_with_milestones.get(
            "/api/admin/users", headers=_auth_headers("admin-user")
        )
        assert resp.status_code == 200
        data = resp.json()
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        assert admin["origin"] == "organic"
        assert admin["game_created_count"] == 10
        assert admin["game_upload_succeeded_count"] == 1
        assert admin["clip_created_count"] == 25
        assert admin["export_completed_count"] == 5
        assert admin["session_count"] == 20

        regular = next(u for u in data["users"] if u["user_id"] == "regular-user")
        assert regular["origin"] == "organic"
        assert regular["acquired_at"] == "2026-03-10"
        # regular-user has 3 game_created (attempts) and NO game_upload_succeeded
        # rows seeded -- the counts must stay independent, never collapsed.
        assert regular["game_created_count"] == 3
        assert regular["game_upload_succeeded_count"] == 0

    def test_games_tried_vs_succeeded_never_conflated(self, client_with_milestones):
        """T8220: regression for the bknoto/chenyh1225 prod findings -- the
        People table's game count must show BOTH the attempt (game_created) and
        the durable outcome (game_upload_succeeded) as independent numbers, never
        one bare count standing in for the other. admin-user here mirrors
        bknoto's shape (attempts >> successes, but not zero); regular-user
        mirrors chenyh1225's shape (attempts with ZERO successes)."""
        resp = client_with_milestones.get(
            "/api/admin/users", headers=_auth_headers("admin-user")
        )
        data = resp.json()
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        regular = next(u for u in data["users"] if u["user_id"] == "regular-user")

        # Attempts and successes are NOT the same field/value.
        assert admin["game_created_count"] != admin["game_upload_succeeded_count"]
        assert admin["game_created_count"] == 10
        assert admin["game_upload_succeeded_count"] == 1

        # A user with attempts and zero successes must show 0, not fall back to
        # the attempt count or omit the field entirely.
        assert regular["game_created_count"] == 3
        assert "game_upload_succeeded_count" in regular
        assert regular["game_upload_succeeded_count"] == 0

    def test_export_types_split_focus_overlay(self, client_with_milestones):
        """T8230: the Exports total must be surfaced split into its per-type
        events. admin-user has 5 export_completed (the generic total), 2
        framing_exported (Focus) and 1 overlay_exported (Overlay); the remaining
        2 are "other"/recovered exports that only ever fire the generic event.
        Both per-type counts appear as their own fields AND the total stays, so
        the residual (5 - 2 - 1 = 2) is accounted for, never silently dropped."""
        resp = client_with_milestones.get(
            "/api/admin/users", headers=_auth_headers("admin-user")
        )
        assert resp.status_code == 200
        data = resp.json()
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        assert admin["export_completed_count"] == 5
        assert admin["framing_exported_count"] == 2
        assert admin["overlay_exported_count"] == 1
        # The total is never less than the parts, so the residual is well-defined
        # and non-negative -- nothing is dropped from the sum.
        residual = (
            admin["export_completed_count"]
            - admin["framing_exported_count"]
            - admin["overlay_exported_count"]
        )
        assert residual == 2

        # A user with exports but no per-type rows shows 0 for each split, not the
        # total and not a missing field.
        regular = next(u for u in data["users"] if u["user_id"] == "regular-user")
        assert regular["export_completed_count"] == 1
        assert regular["framing_exported_count"] == 0
        assert regular["overlay_exported_count"] == 0

    def test_new_export_split_columns_are_sortable(self, client_with_milestones):
        """T8230: every UserTable header triggers a server-side sort, so the new
        Focus/Overlay columns must be in the sort whitelist -- clicking them must
        return 200, not the 422 an un-whitelisted sort key raises."""
        for key in ("framing_exported_count", "overlay_exported_count"):
            resp = client_with_milestones.get(
                f"/api/admin/users?sort={key}&sort_dir=desc",
                headers=_auth_headers("admin-user"),
            )
            assert resp.status_code == 200, key
            # admin-user (framing=2/overlay=1) outranks regular-user (0/0).
            assert resp.json()["users"][0]["user_id"] == "admin-user"

    def test_users_with_segments_but_no_actions(self, client):
        """T3460: the panel INNER JOINs user_segments, so users appear once a
        segment row exists. Users with only a default segment row (no user_actions)
        surface with default-origin and zero action counts."""
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        assert admin["game_created_count"] == 0
        assert admin["game_upload_succeeded_count"] == 0
        assert admin["origin"] == "organic"

    def test_pagination(self, client_with_milestones):
        resp = client_with_milestones.get(
            "/api/admin/users?page=1&page_size=1",
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["users"]) == 1
        assert data["total_users"] >= 2
        assert data["total_pages"] >= 2
        assert data["page"] == 1

        resp2 = client_with_milestones.get(
            "/api/admin/users?page=2&page_size=1",
            headers=_auth_headers("admin-user"),
        )
        data2 = resp2.json()
        assert len(data2["users"]) == 1
        assert data2["page"] == 2

    def test_pagination_returns_all_test_users(self, client_with_milestones):
        """Fetching all pages includes both test users."""
        resp = client_with_milestones.get(
            "/api/admin/users?page=1&page_size=50",
            headers=_auth_headers("admin-user"),
        )
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        assert "regular-user" in user_ids


class TestAdminGrantCredits:
    def test_non_admin_gets_403(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 10, "request_id": "req-1"},
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403

    def test_admin_can_grant_credits(self, client):
        from app.services.credit_ledger import get_credit_balance
        balance_before = get_credit_balance("regular-user")["balance"]
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 50, "request_id": "req-2"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        assert resp.json()["balance"] == balance_before + 50

    def test_zero_amount_rejected(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 0, "request_id": "req-3"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# T4860: Bulk user actions
# ---------------------------------------------------------------------------

class TestAdminBulkGrantCredits:
    def test_non_admin_gets_403(self, client):
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": ["regular-user"], "amount": 10, "batch_id": "b0"},
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403

    def test_happy_path_grants_each_user(self, client):
        """Proves the bulk route is reachable (not captured by the
        /users/{user_id}/grant-credits route) and grants each user."""
        from app.services.credit_ledger import get_credit_balance
        before = get_credit_balance("regular-user")["balance"]
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": ["admin-user", "regular-user"], "amount": 15, "batch_id": "b1"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["granted"] == 2
        assert data["failed"] == 0
        by_id = {r["user_id"]: r for r in data["results"]}
        assert by_id["regular-user"]["ok"] is True
        assert by_id["regular-user"]["balance"] == before + 15

    def test_unknown_id_is_partial_failure(self, client):
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": ["regular-user", "nope-nobody"], "amount": 5, "batch_id": "b2"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["granted"] == 1
        assert data["failed"] == 1
        by_id = {r["user_id"]: r for r in data["results"]}
        assert by_id["regular-user"]["ok"] is True
        assert by_id["nope-nobody"]["ok"] is False
        assert by_id["nope-nobody"]["error"] == "user not found"

    def test_over_cap_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": [f"u{i}" for i in range(101)], "amount": 1, "batch_id": "b3"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400

    def test_empty_ids_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": [], "amount": 1, "batch_id": "b4"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400

    def test_zero_amount_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/grant-credits",
            json={"user_ids": ["regular-user"], "amount": 0, "batch_id": "b5"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400

    def test_retry_same_batch_id_does_not_double_grant(self, client):
        from app.services.credit_ledger import get_credit_balance
        before = get_credit_balance("regular-user")["balance"]
        payload = {"user_ids": ["regular-user"], "amount": 15, "batch_id": "b-retry"}
        client.post("/api/admin/users/bulk/grant-credits", json=payload, headers=_auth_headers("admin-user"))
        resp = client.post("/api/admin/users/bulk/grant-credits", json=payload, headers=_auth_headers("admin-user"))
        assert resp.json()["results"][0]["balance"] == before + 15


class TestAdminBulkEmail:
    @pytest.fixture(autouse=True)
    def _dev_mode(self, monkeypatch):
        """Force dev-mode email: with RESEND_API_KEY unset, send_admin_update_email
        logs and returns True instead of hitting the network (never 500s)."""
        monkeypatch.delenv("RESEND_API_KEY", raising=False)

    def test_non_admin_gets_403(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={"user_ids": ["regular-user"], "subject": "Hi", "body": "Hello"},
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403

    def test_happy_path_sends_each_recipient(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={
                "user_ids": ["admin-user", "regular-user"],
                "subject": "New features",
                "body": "We shipped bulk actions.\n\nEnjoy!",
            },
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["sent"] == 2
        assert data["failed"] == 0
        by_id = {r["user_id"]: r for r in data["results"]}
        assert by_id["regular-user"]["ok"] is True
        assert by_id["regular-user"]["email"] == "other@test.local"

    def test_test_send_ignores_ids_and_hits_only_caller(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={
                "user_ids": ["regular-user", "admin-user"],
                "subject": "Preview",
                "body": "Test body",
                "test": True,
            },
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["sent"] == 1
        assert data["failed"] == 0
        assert len(data["results"]) == 1
        assert data["results"][0]["user_id"] == "admin-user"
        assert data["results"][0]["email"] == "test-admin@test.local"

    def test_dev_mode_does_not_500(self, client):
        """With RESEND_API_KEY unset, the endpoint returns 200 (logs), not 500."""
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={"user_ids": ["regular-user"], "subject": "Yo", "body": "Body"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        assert resp.json()["sent"] == 1

    def test_over_cap_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={
                "user_ids": [f"u{i}" for i in range(101)],
                "subject": "Hi",
                "body": "Body",
            },
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400

    def test_empty_subject_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={"user_ids": ["regular-user"], "subject": "   ", "body": "Body"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400

    def test_whitespace_only_body_rejected(self, client):
        resp = client.post(
            "/api/admin/users/bulk/email",
            json={"user_ids": ["regular-user"], "subject": "Hi", "body": "\n\n  \n"},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400


class TestAdminUpdateEmailBuilder:
    """Unit tests for the branded update-email builder (no network)."""

    def test_body_text_to_html_escapes_and_paragraphs(self):
        from app.services.email import body_text_to_html
        html = body_text_to_html("Line one\nLine two\n\nSecond para")
        assert "<p " in html
        assert "Line one<br>Line two" in html
        assert html.count("<p ") == 2  # two blank-line-separated paragraphs

    def test_body_text_to_html_never_emits_raw_html(self):
        from app.services.email import body_text_to_html
        html = body_text_to_html("<script>alert(1)</script>")
        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_update_email_escapes_subject(self):
        from app.services.email import _build_update_email, body_text_to_html
        html = _build_update_email("<b>Hi</b>", body_text_to_html("body"))
        assert "<b>Hi</b>" not in html
        assert "&lt;b&gt;Hi&lt;/b&gt;" in html


class TestMigratePostgresRoute:
    """T5087: POST /api/admin/migrate -> POST /api/admin/migrate-postgres.

    Route-level coverage the rename itself had none of -- migrate_postgres()
    was already tested directly (test_t2930_migrations.py::TestPostgresMigration),
    but nothing exercised the actual HTTP route until now, so a broken
    decorator/wiring in the rename would have gone uncaught. Mocks
    migrate_postgres() itself (its business logic is covered elsewhere) to
    isolate what this class actually verifies: admin gating, the route path,
    and that the response is the function's return value verbatim (the flat
    shape, not the old sweep's {"postgres": {...}} nesting)."""

    def test_non_admin_403(self, client):
        resp = client.post("/api/admin/migrate-postgres", headers=_auth_headers("regular-user"))
        assert resp.status_code == 403

    def test_admin_gets_the_flat_migrate_postgres_result_verbatim(self, client):
        fake_result = {"applied": [], "current_version": 25, "latest_version": 25, "error": None}
        with patch("app.migrations.migrate_postgres", return_value=fake_result) as mock_migrate:
            resp = client.post("/api/admin/migrate-postgres", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        assert resp.json() == fake_result
        assert "postgres" not in resp.json(), \
            "T5087: response must be the flat migrate_postgres() dict, never the old nested " \
            "{'postgres': {...}, 'users': {...}} sweep shape"
        mock_migrate.assert_called_once()

    def test_old_migrate_path_is_gone(self, client):
        """T5087 deleted POST /api/admin/migrate outright -- it is not an
        alias for the new path, it must 404, never silently still work."""
        resp = client.post("/api/admin/migrate", headers=_auth_headers("admin-user"))
        assert resp.status_code == 404
