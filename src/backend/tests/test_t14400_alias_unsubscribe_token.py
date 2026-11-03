"""T14400: a --to-email alias clone must get its own users.email_unsubscribe_token.

The token (pg v037, UNIQUE) is the unsubscribe link's only credential. Copying it
onto the alias row (a) aborts the seed with a unique violation when the source
account already lives in the destination Postgres (the staging-gate B/C lanes),
and (b) would let the alias's link unsubscribe the real user. A straight copy is
the same user, so it keeps the source token.
"""
import sys
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

import copy_user_between_envs as cu

from tests.conftest import register_test_user_ids


def _seed_source(dsn):
    suffix = uuid.uuid4().hex[:8]
    src_id = f"t14400-src-{suffix}"
    src_email = f"t14400-src-{suffix}@example.test"
    c = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    cur = c.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email, invite_code) VALUES (%s, %s, %s) "
        "RETURNING email_unsubscribe_token",
        (src_id, src_email, suffix),
    )
    token = cur.fetchone()["email_unsubscribe_token"]
    c.commit()
    c.close()
    return src_id, src_email, token, suffix


def _token(dsn, user_id):
    c = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    cur = c.cursor()
    cur.execute("SELECT email_unsubscribe_token FROM users WHERE user_id = %s", (user_id,))
    row = cur.fetchone()
    c.close()
    return row["email_unsubscribe_token"] if row else None


def _same_pg(monkeypatch, dsn):
    monkeypatch.setattr(cu, "get_pg_conn",
                        lambda cfg: psycopg2.connect(dsn, cursor_factory=RealDictCursor))


def test_alias_clone_into_pg_holding_source_gets_fresh_token(pg_conn, monkeypatch):
    dsn = pg_conn
    src_id, src_email, src_token, suffix = _seed_source(dsn)
    dst_email = f"t14400-alias-{suffix}@example.test"
    dst_id = cu.alias_user_id(src_id, dst_email)
    register_test_user_ids(src_id, dst_id)
    _same_pg(monkeypatch, dsn)

    got = cu.copy_postgres_rows({}, {}, src_email, False, dst_email)

    assert got == (src_id, dst_id)
    alias_token = _token(dsn, dst_id)
    assert alias_token and alias_token != src_token
    uuid.UUID(alias_token)  # same shape as the column default
    assert _token(dsn, src_id) == src_token


def test_straight_copy_keeps_source_token(pg_conn, monkeypatch):
    dsn = pg_conn
    src_id, src_email, src_token, _ = _seed_source(dsn)
    register_test_user_ids(src_id)
    _same_pg(monkeypatch, dsn)

    got = cu.copy_postgres_rows({}, {}, src_email, False)

    assert got == (src_id, src_id)
    assert _token(dsn, src_id) == src_token
