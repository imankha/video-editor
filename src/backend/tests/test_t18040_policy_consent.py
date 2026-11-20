"""
T18040: tell existing users the privacy policy changed, and let them opt out in the app.

Two facts on the users row (v051): the policy version the account last acknowledged
(`policy_version_acknowledged`) and when it turned off the internal-testing use of its
footage (`testing_opted_out_at`, NULL = allowed). Each is written by its own gesture:
"Got it" on the notice (POST /api/auth/acknowledge-policy) and the switch under "Your
privacy rights" (PUT /api/auth/testing-consent). /me tells the app whether to show the
notice. may_use_for_testing() is the one rule the footage-pulling scripts ask.
"""

import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.services import auth_db

EXISTING_ID = "t18040-existing"
NEW_ID = "t18040-new"
ADMIN_ID = "t18040-admin"

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def _insert_pre_feature_user(user_id, email):
    """An account created before T18040: its row never had the acknowledged version set."""
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "INSERT INTO users (user_id, email, verified_at, terms_accepted_at) "
            "VALUES (%s, %s, now(), now())",
            (user_id, email),
        )


@pytest.fixture()
def users(pg_conn):
    from tests.conftest import register_test_user_ids
    register_test_user_ids(EXISTING_ID, NEW_ID, ADMIN_ID)
    _insert_pre_feature_user(EXISTING_ID, "t18040-existing@example.com")
    auth_db.create_user(NEW_ID, email="t18040-new@example.com")
    auth_db.create_user(ADMIN_ID, email="t18040-admin@example.com")


@pytest.fixture()
def client(users, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _sign_in(client, user_id):
    client.cookies.set("rb_session", auth_db.create_session(user_id))


def _row(user_id):
    with auth_db.get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT policy_version_acknowledged, testing_opted_out_at FROM users WHERE user_id = %s",
            (user_id,),
        )
        return cur.fetchone()


def _may_use(user_id):
    from app.services.policy_consent import may_use_for_testing
    with auth_db.get_auth_db() as conn:
        return may_use_for_testing(conn.cursor(), user_id)


# C1 ------------------------------------------------------------------------

def test_c1_existing_user_sees_notice_until_got_it_then_never_again(client):
    from app.services.policy_consent import CURRENT_POLICY_VERSION
    _sign_in(client, EXISTING_ID)
    me = client.get("/api/auth/me").json()
    assert me["needs_policy_notice"] is True
    assert me["policy_version"] == CURRENT_POLICY_VERSION

    resp = client.post("/api/auth/acknowledge-policy", json={"version": CURRENT_POLICY_VERSION})
    assert resp.status_code == 200
    assert _row(EXISTING_ID)["policy_version_acknowledged"] == CURRENT_POLICY_VERSION
    assert client.get("/api/auth/me").json()["needs_policy_notice"] is False

    # Another device: a brand-new session for the same account.
    other = TestClient(client.app)
    _sign_in(other, EXISTING_ID)
    assert other.get("/api/auth/me").json()["needs_policy_notice"] is False


def test_c1_acknowledging_a_version_that_is_not_current_is_refused(client):
    _sign_in(client, EXISTING_ID)
    resp = client.post("/api/auth/acknowledge-policy", json={"version": "2026-05-07"})
    assert resp.status_code == 409
    assert _row(EXISTING_ID)["policy_version_acknowledged"] is None


def test_c1_admin_viewing_as_the_user_neither_sees_nor_records_the_notice(client):
    from app.services.policy_consent import CURRENT_POLICY_VERSION
    client.cookies.set(
        "rb_session", auth_db.create_impersonation_session(EXISTING_ID, ADMIN_ID, ttl_minutes=10)
    )
    assert client.get("/api/auth/me").json()["needs_policy_notice"] is False
    resp = client.post("/api/auth/acknowledge-policy", json={"version": CURRENT_POLICY_VERSION})
    assert resp.status_code == 403
    resp = client.put("/api/auth/testing-consent", json={"use_for_testing": False})
    assert resp.status_code == 403
    assert _row(EXISTING_ID)["policy_version_acknowledged"] is None
    assert _row(EXISTING_ID)["testing_opted_out_at"] is None


# C2 ------------------------------------------------------------------------

def test_c2_new_account_acknowledges_by_signing_up_and_never_sees_notice(client):
    from app.services.policy_consent import CURRENT_POLICY_VERSION
    assert _row(NEW_ID)["policy_version_acknowledged"] == CURRENT_POLICY_VERSION
    _sign_in(client, NEW_ID)
    assert client.get("/api/auth/me").json()["needs_policy_notice"] is False


# C3 ------------------------------------------------------------------------

def test_c3_switch_turns_testing_use_off_and_on_and_survives_reload(client):
    _sign_in(client, NEW_ID)
    assert client.get("/api/auth/me").json()["use_for_testing"] is True

    assert client.put("/api/auth/testing-consent", json={"use_for_testing": False}).status_code == 200
    assert _row(NEW_ID)["testing_opted_out_at"] is not None
    assert client.get("/api/auth/me").json()["use_for_testing"] is False

    assert client.put("/api/auth/testing-consent", json={"use_for_testing": True}).status_code == 200
    assert _row(NEW_ID)["testing_opted_out_at"] is None
    assert client.get("/api/auth/me").json()["use_for_testing"] is True


def test_c3_switch_requires_a_boolean(client):
    _sign_in(client, NEW_ID)
    assert client.put("/api/auth/testing-consent", json={}).status_code == 422


# C4 ------------------------------------------------------------------------

def test_c4_may_use_for_testing_only_when_acknowledged_and_not_opted_out(users):
    from app.services.policy_consent import set_use_for_testing
    assert _may_use(NEW_ID) is True
    assert _may_use(EXISTING_ID) is False  # has not acknowledged the current version
    set_use_for_testing(NEW_ID, False)
    assert _may_use(NEW_ID) is False


def test_c4_older_acknowledgement_does_not_count(users):
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "UPDATE users SET policy_version_acknowledged = '2026-05-07' WHERE user_id = %s",
            (EXISTING_ID,),
        )
    assert _may_use(EXISTING_ID) is False


def test_c4_unknown_account_is_an_error_not_a_yes(users):
    from app.services.policy_consent import may_use_for_testing
    with auth_db.get_auth_db() as conn, pytest.raises(LookupError):
        may_use_for_testing(conn.cursor(), "t18040-no-such-user")


def test_c4_footage_script_refuses_an_account_that_may_not_be_used(users):
    spec = importlib.util.spec_from_file_location(
        "copy_user_between_envs", _SCRIPTS / "copy_user_between_envs.py"
    )
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    with auth_db.get_auth_db() as conn:
        cur = conn.cursor()
        with pytest.raises(SystemExit) as refused:
            script.require_testing_consent(cur, EXISTING_ID, "t18040-existing@example.com")
        assert "may not be used for testing" in str(refused.value)
        script.require_testing_consent(cur, NEW_ID, "t18040-new@example.com")  # allowed: no raise


# C7 ------------------------------------------------------------------------

def test_c7_data_export_includes_acknowledged_version_and_setting(client):
    from app.services.policy_consent import CURRENT_POLICY_VERSION
    _sign_in(client, NEW_ID)
    client.put("/api/auth/testing-consent", json={"use_for_testing": False})
    with patch("app.routers.privacy.R2_ENABLED", False):
        resp = client.post("/api/privacy/export-data")
    assert resp.status_code == 200
    account = resp.json()["account"]
    assert account["policy_version_acknowledged"] == CURRENT_POLICY_VERSION
    assert account["use_for_testing"] is False
    assert account["testing_opted_out_at"] is not None


def test_c7_both_values_live_on_the_users_row_so_deletion_removes_them(users):
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute("DELETE FROM users WHERE user_id = %s", (NEW_ID,))
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name FROM information_schema.columns "
            "WHERE column_name IN ('policy_version_acknowledged', 'testing_opted_out_at')"
        )
        assert {r["table_name"] for r in cur.fetchall()} == {"users"}
    assert _row(NEW_ID) is None


# Migration -----------------------------------------------------------------

def test_v051_adds_both_columns_leaves_existing_rows_unacknowledged_and_is_idempotent(users):
    from app.migrations.postgres.v051_policy_consent import V051PolicyConsent
    from tests.conftest import mark_pg_schema_dirty
    mark_pg_schema_dirty()
    with auth_db.get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS policy_version_acknowledged")
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS testing_opted_out_at")
    with auth_db.get_auth_db() as conn:
        V051PolicyConsent().up(conn)
        V051PolicyConsent().up(conn)
    row = _row(EXISTING_ID)
    assert row["policy_version_acknowledged"] is None
    assert row["testing_opted_out_at"] is None


def test_v052_records_the_in_person_accounts_as_acknowledged_only(users, monkeypatch):
    """Owner ruling 2026-11-20: the three accounts that agreed in person are acknowledged.

    The email list is swapped for test accounts so the test never touches a real dev user.
    """
    from app.migrations.postgres import v052_in_person_policy_consent as v052
    from app.services.policy_consent import CURRENT_POLICY_VERSION
    assert v052.IN_PERSON_EMAILS == (
        "imankh@gmail.com", "sarkarati@gmail.com", "arshia.kalentari@gmail.com",
    )
    monkeypatch.setattr(v052, "IN_PERSON_EMAILS", ("t18040-existing@example.com",))
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "UPDATE users SET policy_version_acknowledged = NULL WHERE user_id = %s", (ADMIN_ID,)
        )
    with auth_db.get_auth_db() as conn:
        v052.V052InPersonPolicyConsent().up(conn)
        v052.V052InPersonPolicyConsent().up(conn)
    assert _row(EXISTING_ID)["policy_version_acknowledged"] == CURRENT_POLICY_VERSION
    assert _row(ADMIN_ID)["policy_version_acknowledged"] is None  # not on the list
    assert _may_use(EXISTING_ID) is True
