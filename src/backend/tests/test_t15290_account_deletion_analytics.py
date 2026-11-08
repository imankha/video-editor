"""T15290: account deletion keeps analytics -- hashed email, kept attribution,
deletion visible in the admin (owner ruling 2026-11-07).

Covers:
  - the hash is keyed (different secret -> different hash)
  - a real deletion writes account_deletions.email_hash
  - deidentify_user_segments keeps utm_*/click_source/landing_path, only
    strips the live-session field
  - a sign-up whose email hash matches a past deletion is marked
    returning_after_deletion, and nothing else about the segment changes
  - the admin user-detail endpoint no longer 404s for a deleted account and
    surfaces is_deleted/deleted_at from account_deletions
  - v045 migration is additive/idempotent and matches fresh _SCHEMA_DDL
"""
import psycopg2
import pytest
from fastapi.testclient import TestClient

from app.services.account_deletions import DeletionActor, DeletionPath, hash_email, record_account_deletion
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

pytestmark = pytest.mark.usefixtures("pg_conn")

_OUR_USER_IDS = (
    "t15290_del_user", "t15290_keep_user", "t15290_ret_old", "t15290_ret_new",
    "t15290_fresh_user", "t15290_admin_detail", "t15290_admin_live",
    "t15290-admin-user",
)


@pytest.fixture(autouse=True)
def _cleanup_account_deletions(pg_conn):
    """account_deletions has no FK to users (by design: it outlives deletion),
    so the shared conftest teardown never cleans it. Clean our own rows here,
    same pattern as test_t8630_deletion_audit.py's _cleanup."""
    def _clean():
        with _pg() as conn:
            cur = conn.cursor()
            placeholders = ",".join(["%s"] * len(_OUR_USER_IDS))
            cur.execute(f"DELETE FROM account_deletions WHERE user_id IN ({placeholders})", _OUR_USER_IDS)
    _clean()
    yield
    _clean()


def _pg():
    from app.services import pg
    return pg.get_pg()


def _segment_row(user_id):
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
        return cur.fetchone()


def _deletion_row(user_id):
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM account_deletions WHERE user_id = %s ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        return cur.fetchone()


# --- Keyed hash --------------------------------------------------------------


def test_hash_is_keyed_different_secret_gives_different_value(monkeypatch):
    monkeypatch.setenv("ACCOUNT_DELETION_EMAIL_HASH_SECRET", "secret-one")
    h1 = hash_email("Person@Example.com")
    monkeypatch.setenv("ACCOUNT_DELETION_EMAIL_HASH_SECRET", "secret-two")
    h2 = hash_email("Person@Example.com")
    assert h1 != h2, "the same email under a different secret must hash differently"


def test_hash_normalises_case_and_whitespace(monkeypatch):
    monkeypatch.setenv("ACCOUNT_DELETION_EMAIL_HASH_SECRET", "secret-one")
    assert hash_email("Person@Example.com") == hash_email("  person@example.com  ")


# --- Real deletion writes email_hash, keeps attribution -----------------------


class TestDeletionKeepsAttribution:
    def test_record_account_deletion_writes_email_hash(self, monkeypatch):
        monkeypatch.setenv("ACCOUNT_DELETION_EMAIL_HASH_SECRET", "t15290-secret")
        user_id = "t15290_del_user"
        email = "t15290-del@test.local"
        create_user(user_id, email=email)
        register_test_user_ids(user_id)

        with _pg() as conn:
            cur = conn.cursor()
            record_account_deletion(
                cur, user_id=user_id, actor=DeletionActor.SELF,
                path=DeletionPath.PRIVACY_ENDPOINT, email=email,
            )

        row = _deletion_row(user_id)
        assert row is not None
        assert row["email_hash"] == hash_email(email)

    def test_deidentify_keeps_utm_click_source_landing_path(self):
        from app.analytics import create_user_segment, deidentify_user_segments

        user_id = "t15290_keep_user"
        create_user(user_id, email="t15290-keep@test.local")
        register_test_user_ids(user_id)
        create_user_segment(
            user_id, "paid_social", None, "otp",
            utm_source="tiktok", utm_medium="cpc", utm_campaign="fall",
            utm_content="soccer", utm_term="highlights", click_source="ttclid123",
            landing_path="/soccer",
        )

        with _pg() as conn:
            cur = conn.cursor()
            deidentify_user_segments(cur, user_id)

        row = _segment_row(user_id)
        assert row["utm_source"] == "tiktok"
        assert row["utm_medium"] == "cpc"
        assert row["utm_campaign"] == "fall"
        assert row["utm_content"] == "soccer"
        assert row["utm_term"] == "highlights"
        assert row["click_source"] == "ttclid123"
        assert row["landing_path"] == "/soccer"
        # The one live-session field left in _DEIDENTIFY_SEGMENT_COLUMNS.
        assert row["current_session_start"] is None


# --- returning_after_deletion --------------------------------------------------


class TestReturningAfterDeletion:
    def test_signup_matching_a_past_deletion_is_marked_returning(self, monkeypatch):
        from app.analytics import create_user_segment

        monkeypatch.setenv("ACCOUNT_DELETION_EMAIL_HASH_SECRET", "t15290-secret")
        old_user_id = "t15290_ret_old"
        new_user_id = "t15290_ret_new"
        email = "t15290-returning@test.local"
        create_user(old_user_id, email=email)
        register_test_user_ids(old_user_id, new_user_id)

        with _pg() as conn:
            cur = conn.cursor()
            record_account_deletion(
                cur, user_id=old_user_id, actor=DeletionActor.SELF,
                path=DeletionPath.PRIVACY_ENDPOINT, email=email,
            )
            cur.execute("DELETE FROM users WHERE user_id = %s", (old_user_id,))

        create_user(new_user_id, email=email)
        create_user_segment(new_user_id, "organic", None, "otp", email=email)

        row = _segment_row(new_user_id)
        assert row["returning_after_deletion"] is True
        # Nothing else is special about this sign-up.
        assert row["origin"] == "organic"

    def test_signup_with_no_prior_deletion_is_not_marked_returning(self):
        from app.analytics import create_user_segment

        user_id = "t15290_fresh_user"
        email = "t15290-fresh@test.local"
        create_user(user_id, email=email)
        register_test_user_ids(user_id)

        create_user_segment(user_id, "organic", None, "otp", email=email)

        row = _segment_row(user_id)
        assert row["returning_after_deletion"] is False


# --- Admin detail: deleted account is visible, not a 404 ----------------------


class TestAdminDetailShowsDeletion:
    @pytest.fixture()
    def client(self):
        create_user("t15290-admin-user", email="t15290-admin@test.local")
        register_test_user_ids("t15290-admin-user")
        with _pg() as conn:
            conn.cursor().execute(
                "INSERT INTO admin_users (email) VALUES ('t15290-admin@test.local') ON CONFLICT DO NOTHING")
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True, headers={"X-User-ID": "t15290-admin-user"})

    def test_analytics_journey_detail_does_not_404_for_deleted_account_and_shows_status(self, client):
        from app.analytics import create_user_segment

        user_id = "t15290_admin_detail"
        email = "t15290-admin-detail@test.local"
        create_user(user_id, email=email)
        register_test_user_ids(user_id)
        create_user_segment(user_id, "organic", None, "otp")

        with _pg() as conn:
            cur = conn.cursor()
            record_account_deletion(
                cur, user_id=user_id, actor=DeletionActor.SELF,
                path=DeletionPath.PRIVACY_ENDPOINT, email=email,
            )
            cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))

        r = client.get(f"/api/admin/analytics/journey/{user_id}")
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["is_deleted"] is True
        assert result["deleted_at"] is not None
        assert result["email"] != email, "a deleted account's real email must not be shown"

    def test_analytics_journey_detail_live_account_is_not_deleted(self, client):
        from app.analytics import create_user_segment

        user_id = "t15290_admin_live"
        email = "t15290-admin-live@test.local"
        create_user(user_id, email=email)
        register_test_user_ids(user_id)
        create_user_segment(user_id, "organic", None, "otp")

        r = client.get(f"/api/admin/analytics/journey/{user_id}")
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["is_deleted"] is False
        assert result["deleted_at"] is None
        assert result["email"] == email


# --- Migration -----------------------------------------------------------------


def test_migration_adds_columns_and_fresh_ddl_matches():
    import os

    from app.migrations.postgres import MIGRATIONS
    from app.services.pg import _SCHEMA_DDL

    migration = next(
        (m for m in MIGRATIONS if "email_hash" in m.description and "returning" in m.description),
        None,
    )
    assert migration is not None, "no migration adds account_deletions.email_hash + user_segments.returning_after_deletion"

    segments_ddl = _SCHEMA_DDL.split("CREATE TABLE IF NOT EXISTS user_segments")[1].split("idx_segments_acquired")[0]
    assert "returning_after_deletion" in segments_ddl
    deletions_ddl = _SCHEMA_DDL.split("CREATE TABLE IF NOT EXISTS account_deletions")[1].split("idx_account_deletions_email_hash")[0]
    assert "email_hash" in deletions_ddl

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:  # one transaction, rolled back: the shared dev DB keeps its columns
        cur = conn.cursor()
        cur.execute("ALTER TABLE account_deletions DROP COLUMN IF EXISTS email_hash")
        cur.execute("ALTER TABLE user_segments DROP COLUMN IF EXISTS returning_after_deletion")
        migration.up(conn)
        cur.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'account_deletions' "
            "AND column_name = 'email_hash'"
        )
        assert cur.fetchone() is not None
        cur.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'user_segments' "
            "AND column_name = 'returning_after_deletion'"
        )
        assert cur.fetchone() is not None
        # Idempotent: running it again must not raise.
        migration.up(conn)
    finally:
        conn.rollback()
        conn.close()
