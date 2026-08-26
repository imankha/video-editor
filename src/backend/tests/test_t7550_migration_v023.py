"""T7550 -- postgres v023 renames pending_teammate_shares.recipient_email ->
invited_email.

The column is ADVISORY (who the share was emailed to), never a claim gate: any
link/id-holder can claim (open-by-token, matching game_link). The rename stops
readers being misled into thinking it authorizes the claim. These tests run
against the real dev Postgres via pg_conn (which replays every migration,
including v023, during setup).
"""

from app.migrations.postgres import RUNNER
from app.migrations.postgres.v023_rename_pending_share_recipient_email import (
    V023RenamePendingShareRecipientEmail,
)


def _columns(conn, table):
    cur = conn.cursor()
    cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
        (table,),
    )
    return {r["column_name"] for r in cur.fetchall()}


def test_v023_registered_at_version_23():
    v023 = [m for m in RUNNER.migrations if m.version == 23]
    assert len(v023) == 1
    assert isinstance(v023[0], V023RenamePendingShareRecipientEmail)


def test_schema_has_invited_email_not_recipient_email(pg_conn):
    """After the pg_conn replay, the live column is renamed."""
    from app.services import pg

    with pg.get_pg() as conn:
        cols = _columns(conn, "pending_teammate_shares")

    assert "invited_email" in cols
    assert "recipient_email" not in cols


def test_migration_is_idempotent(pg_conn):
    """A second run against an already-renamed table is a guarded no-op -- the
    replay in pg_conn already applied v023, so this proves re-running does not
    raise (and the shares table's own recipient_email is untouched)."""
    from app.services import pg

    with pg.get_pg() as conn:
        V023RenamePendingShareRecipientEmail().up(conn)

    with pg.get_pg() as conn:
        pending_cols = _columns(conn, "pending_teammate_shares")
        shares_cols = _columns(conn, "shares")

    assert "invited_email" in pending_cols
    assert "recipient_email" not in pending_cols
    # The separate shares.recipient_email column is a DIFFERENT concept and must
    # NOT have been touched by this migration.
    assert "recipient_email" in shares_cols
