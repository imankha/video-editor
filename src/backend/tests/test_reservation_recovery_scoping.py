"""M6 regression (T5840 review round 2): recover_orphaned_reservations must not
release ANOTHER machine's active in-flight reservation.

Real Postgres via pg_conn (credit_reservations) + a real per-profile SQLite
file (export_jobs) at the path `_open_profile_db` reads directly.
"""

import sqlite3

import pytest

USER = "user-a"
PROFILE = "profileabcd"


@pytest.fixture()
def profile_db(tmp_path, monkeypatch):
    """A real profile.sqlite with an export_jobs table, at the exact path
    materialization._open_profile_db reads (module-level USER_DATA_BASE, so
    patch IT directly -- patching app.database.USER_DATA_BASE alone would not
    reach it, same gotcha credit_ledger.get_pg had)."""
    import app.services.materialization as materialization_mod
    monkeypatch.setattr(materialization_mod, "USER_DATA_BASE", tmp_path)

    db_path = tmp_path / USER / "profiles" / PROFILE / "profile.sqlite"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE export_jobs (
            id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending'
        )
    """)
    conn.commit()
    conn.close()
    return db_path


def _insert_job(profile_db, job_id, status):
    conn = sqlite3.connect(str(profile_db))
    conn.execute("INSERT INTO export_jobs (id, status) VALUES (?, ?)", (job_id, status))
    conn.commit()
    conn.close()


def _make_old_reservation(user_id, job_id, profile_id, amount=20):
    """Insert a reservation old enough to be a recovery candidate (>60s).
    Mirrors reserve_credits(): debits balance AND inserts the reservation row
    -- a reservation that didn't actually debit the balance isn't a faithful
    fixture (the whole point of these tests is checking the balance)."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE credits SET balance = balance - %s WHERE user_id = %s",
            (amount, user_id),
        )
        cur.execute(
            """INSERT INTO credit_reservations (job_id, user_id, profile_id, amount, created_at)
               VALUES (%s, %s, %s, %s, now() - INTERVAL '120 seconds')""",
            (job_id, user_id, profile_id, amount),
        )


class TestHasLiveExportJob:
    def test_none_profile_id_is_conservative_true(self, pg_conn):
        from app.services.credit_ledger import _has_live_export_job
        assert _has_live_export_job(USER, None, "job-1") is True

    def test_profile_not_locally_cached_is_conservative_true(self, pg_conn, tmp_path, monkeypatch):
        import app.services.materialization as materialization_mod
        monkeypatch.setattr(materialization_mod, "USER_DATA_BASE", tmp_path)
        from app.services.credit_ledger import _has_live_export_job
        assert _has_live_export_job(USER, "no-such-profile", "job-1") is True

    def test_pending_job_is_live(self, pg_conn, profile_db):
        from app.services.credit_ledger import _has_live_export_job
        _insert_job(profile_db, "job-1", "pending")
        assert _has_live_export_job(USER, PROFILE, "job-1") is True

    def test_processing_job_is_live(self, pg_conn, profile_db):
        from app.services.credit_ledger import _has_live_export_job
        _insert_job(profile_db, "job-1", "processing")
        assert _has_live_export_job(USER, PROFILE, "job-1") is True

    def test_complete_job_is_not_live(self, pg_conn, profile_db):
        from app.services.credit_ledger import _has_live_export_job
        _insert_job(profile_db, "job-1", "complete")
        assert _has_live_export_job(USER, PROFILE, "job-1") is False

    def test_missing_job_is_not_live(self, pg_conn, profile_db):
        from app.services.credit_ledger import _has_live_export_job
        assert _has_live_export_job(USER, PROFILE, "no-such-job") is False


class TestRecoverOrphanedReservationsScoping:
    def test_active_reservation_with_live_job_is_not_released(self, pg_conn, profile_db):
        """M6 headline: a reservation whose export is still pending/processing
        on ANOTHER machine must survive a cold session-init recovery pass."""
        from app.services.credit_ledger import get_balance, grant, recover_orphaned_reservations

        grant(USER, 100, "stripe_purchase", "stripe:pi_1")
        _make_old_reservation(USER, "job-live", PROFILE, amount=20)
        _insert_job(profile_db, "job-live", "processing")
        assert get_balance(USER) == 80  # reserve already debited (simulated directly above)

        recovered = recover_orphaned_reservations(USER)

        assert recovered == 0, "an active in-flight reservation must not be released"
        assert get_balance(USER) == 80, "balance must be untouched"

    def test_completed_job_reservation_is_released(self, pg_conn, profile_db):
        """A reservation whose job actually finished (confirm/release should
        have cleaned it up, but didn't -- e.g. a crash) is genuinely orphaned."""
        from app.services.credit_ledger import get_balance, grant, recover_orphaned_reservations

        grant(USER, 100, "stripe_purchase", "stripe:pi_1")
        _make_old_reservation(USER, "job-done", PROFILE, amount=20)
        _insert_job(profile_db, "job-done", "complete")
        assert get_balance(USER) == 80

        recovered = recover_orphaned_reservations(USER)

        assert recovered == 1
        assert get_balance(USER) == 100, "genuinely orphaned reservation is released"

    def test_reservation_with_no_export_job_row_is_released(self, pg_conn, profile_db):
        from app.services.credit_ledger import get_balance, grant, recover_orphaned_reservations

        grant(USER, 100, "stripe_purchase", "stripe:pi_1")
        _make_old_reservation(USER, "job-vanished", PROFILE, amount=20)
        assert get_balance(USER) == 80

        recovered = recover_orphaned_reservations(USER)

        assert recovered == 1
        assert get_balance(USER) == 100

    def test_reservation_with_unavailable_profile_db_is_not_released(self, pg_conn, tmp_path, monkeypatch):
        """Conservative default: this machine can't confirm the OTHER
        machine's profile.sqlite is cached locally -- must not release."""
        import app.services.materialization as materialization_mod
        monkeypatch.setattr(materialization_mod, "USER_DATA_BASE", tmp_path)
        from app.services.credit_ledger import get_balance, grant, recover_orphaned_reservations

        grant(USER, 100, "stripe_purchase", "stripe:pi_1")
        _make_old_reservation(USER, "job-elsewhere", "some-other-profile-never-cached-here", amount=20)
        assert get_balance(USER) == 80

        recovered = recover_orphaned_reservations(USER)

        assert recovered == 0
        assert get_balance(USER) == 80

    def test_recent_reservation_not_a_candidate_regardless(self, pg_conn, profile_db):
        """The 60s age gate still applies -- a genuinely fresh reservation is
        never even considered, live job or not."""
        from app.services.credit_ledger import get_balance, grant, reserve_credits, recover_orphaned_reservations

        grant(USER, 100, "stripe_purchase", "stripe:pi_1")
        reserve_credits(USER, 20, "job-fresh", profile_id=PROFILE)
        assert get_balance(USER) == 80

        recovered = recover_orphaned_reservations(USER)

        assert recovered == 0
        assert get_balance(USER) == 80
