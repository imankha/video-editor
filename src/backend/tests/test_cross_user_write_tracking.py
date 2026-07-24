"""Write tracking must record WHOSE database was written, not just that one was.

Historically TrackedConnection recorded only booleans (`has_writes` /
`has_user_db_writes`), so the middleware could only ever sync the SESSION user's
databases -- by construction. Any handler that wrote a DIFFERENT user's DB (admin
credit grants, Stripe webhook fulfilment) left that write on local disk, where the
next machine replacement destroyed it. That is the 400-credit prod loss, and it
had already been patched at two call sites individually before being fixed here.

These tests pin the identity, which is what lets the middleware sync every DB a
request actually touched.
"""

import sqlite3

import pytest

SESSION_USER = "session-user"
OTHER_USER = "other-user"


@pytest.fixture
def req_ctx():
    """A live request write-tracking context, torn down after the test."""
    from app import database as db
    from app.user_context import set_current_user_id

    set_current_user_id(SESSION_USER)
    db.init_request_context()
    yield db
    db.clear_request_context()


def _write(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS t (x INTEGER)")
    conn.execute("INSERT INTO t (x) VALUES (1)")
    conn.commit()


class TestTrackedConnectionIdentity:

    def test_user_db_write_records_the_owner(self, req_ctx, tmp_path):
        db = req_ctx
        conn = db.TrackedConnection(
            sqlite3.connect(str(tmp_path / "u.sqlite")),
            db_type="user",
            owner_user_id=OTHER_USER,
        )
        _write(conn)
        conn.close()

        assert db.get_request_has_user_db_writes() is True
        assert db.get_request_written_user_dbs() == {OTHER_USER}, (
            "the middleware cannot sync a DB it cannot name"
        )

    def test_profile_db_write_records_user_and_profile(self, req_ctx, tmp_path):
        db = req_ctx
        conn = db.TrackedConnection(
            sqlite3.connect(str(tmp_path / "p.sqlite")),
            owner_user_id=OTHER_USER,
            owner_profile_id="abcd1234",
        )
        _write(conn)
        conn.close()

        assert db.get_request_has_writes() is True
        assert db.get_request_written_profile_dbs() == {(OTHER_USER, "abcd1234")}

    def test_reads_record_nothing(self, req_ctx, tmp_path):
        """Only writes should trigger an upload."""
        db = req_ctx
        path = tmp_path / "r.sqlite"
        seed = sqlite3.connect(str(path))
        seed.execute("CREATE TABLE t (x INTEGER)")
        seed.commit()
        seed.close()

        conn = db.TrackedConnection(
            sqlite3.connect(str(path)), db_type="user", owner_user_id=OTHER_USER
        )
        conn.execute("SELECT * FROM t").fetchall()
        conn.close()

        assert db.get_request_written_user_dbs() == set()

    def test_no_request_context_is_safe(self, tmp_path):
        """Background workers run outside a request; tracking must not explode."""
        from app import database as db

        db.clear_request_context()
        conn = db.TrackedConnection(
            sqlite3.connect(str(tmp_path / "bg.sqlite")),
            db_type="user",
            owner_user_id=OTHER_USER,
        )
        _write(conn)
        conn.close()
        assert db.get_request_written_user_dbs() == set()


class TestCrossUserWriteIsVisible:

    def test_writing_another_users_db_is_distinguishable_from_the_session_user(
        self, req_ctx, tmp_path, monkeypatch
    ):
        """The real shape of an admin credit grant: session user is the admin,
        the write lands in the GRANTEE's user.sqlite. The middleware subtracts the
        session user, so the grantee must remain in the set."""
        from app.services import user_db as m

        monkeypatch.setattr(m, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        monkeypatch.setattr(m, "ensure_user_database", lambda uid: None)
        (tmp_path / OTHER_USER).mkdir(parents=True, exist_ok=True)

        with m.get_user_db_connection(OTHER_USER) as conn:
            _write(conn)

        db = req_ctx
        written = db.get_request_written_user_dbs()
        assert written == {OTHER_USER}
        # This subtraction is exactly what the middleware does; it must be non-empty
        # or the grant is never uploaded.
        assert written - {SESSION_USER} == {OTHER_USER}

    def test_session_users_own_write_is_not_treated_as_foreign(
        self, req_ctx, tmp_path, monkeypatch
    ):
        """The common case must not produce a redundant second upload."""
        from app.services import user_db as m

        monkeypatch.setattr(m, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        monkeypatch.setattr(m, "ensure_user_database", lambda uid: None)
        (tmp_path / SESSION_USER).mkdir(parents=True, exist_ok=True)

        with m.get_user_db_connection(SESSION_USER) as conn:
            _write(conn)

        db = req_ctx
        assert db.get_request_written_user_dbs() - {SESSION_USER} == set()
