"""T14410: the pg_conn schema rebuild must never replay a data-mutating migration.

pg_conn runs against the SHARED dev Postgres, which is already at head. The
rebuild used to wipe the ledger from v005 up and replay every migration, so
one-time data migrations ran again on every test session: v025's unscoped
`DELETE FROM game_storage_refs` wiped every dev user's storage refs, v009's
viral-origin pass rewrote user_segments.origin, v015 rewrote user_actions
platforms and v035 nulled deleted users' segment activity.
"""
import ast
import os
import re
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from tests.conftest import _build_pg_schema, mark_pg_schema_dirty

_PARENT = "t14410-real-parent"
_CHILD = "t14410-real-child"
_GONE = "t14410-deleted-user"
_HASH = "t14410-hash"

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "app" / "migrations" / "postgres"


def _connect():
    conn = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    conn.autocommit = True
    return conn


def _cleanup(cur):
    users = (_PARENT, _CHILD, _GONE)
    cur.execute("DELETE FROM game_storage_refs WHERE user_id = ANY(%s)", (list(users),))
    cur.execute("DELETE FROM user_actions WHERE user_id = ANY(%s)", (list(users),))
    cur.execute("DELETE FROM user_segments WHERE user_id = ANY(%s)", (list(users),))
    cur.execute("DELETE FROM users WHERE user_id = ANY(%s)", (list(users),))


def test_schema_rebuild_keeps_non_test_rows(pg_conn):
    conn = _connect()
    cur = conn.cursor()
    try:
        _cleanup(cur)
        for uid in (_PARENT, _CHILD):
            cur.execute("INSERT INTO users (user_id, email) VALUES (%s, %s)",
                        (uid, f"{uid}@example.invalid"))
        # v025: a live storage ref for a real dev user
        cur.execute(
            "INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, "
            "storage_expires_at) VALUES (%s, 'p1', %s, 123, now() + interval '30 days')",
            (_PARENT, _HASH),
        )
        # v009: a referred user whose origin differs from the referrer's
        cur.execute("INSERT INTO user_segments (user_id, origin) VALUES (%s, 'meta-ads')", (_PARENT,))
        cur.execute("INSERT INTO user_segments (user_id, origin, referrer_id) VALUES (%s, 'organic', %s)",
                    (_CHILD, _PARENT))
        # v015: an action row holding a legacy platform value
        cur.execute("INSERT INTO user_actions (user_id, action, platform) VALUES (%s, 'session_started', 'desktop')",
                    (_PARENT,))
        # v035: a retained segment of a deleted user that still has activity
        cur.execute("INSERT INTO user_segments (user_id, last_active_at, total_usage_seconds) "
                    "VALUES (%s, '2020-01-02', 77)", (_GONE,))

        mark_pg_schema_dirty()
        _build_pg_schema(cur)

        cur.execute("SELECT count(*) AS n FROM game_storage_refs WHERE user_id = %s AND blake3_hash = %s",
                    (_PARENT, _HASH))
        refs = cur.fetchone()["n"]
        cur.execute("SELECT origin FROM user_segments WHERE user_id = %s", (_CHILD,))
        child_origin = cur.fetchone()["origin"]
        cur.execute("SELECT platform FROM user_actions WHERE user_id = %s", (_PARENT,))
        platform = cur.fetchone()["platform"]
        cur.execute("SELECT total_usage_seconds FROM user_segments WHERE user_id = %s", (_GONE,))
        gone_usage = cur.fetchone()["total_usage_seconds"]

        assert (refs, child_origin, platform, gone_usage) == (1, "organic", "desktop", 77)
    finally:
        _cleanup(cur)
        conn.close()


_DML = re.compile(r"^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b", re.IGNORECASE)


def _executes_dml(source):
    """True when any cur.execute(...) SQL literal in `source` holds a DML statement."""
    for node in ast.walk(ast.parse(source)):
        if not (isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "execute" and node.args):
            continue
        sql_node = node.args[0]
        parts = [n.value for n in ast.walk(sql_node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        if any(_DML.match(stmt) for stmt in "".join(parts).split(";")):
            return True
    return False


def test_every_data_mutating_migration_is_never_replayed():
    """A new postgres migration that writes rows must be classified, or the
    fixture would replay it against the shared dev DB on every test session."""
    from app.migrations.postgres import RUNNER
    from tests.conftest import _NEVER_REPLAYED_DATA_MIGRATIONS
    by_version = {m.version: m for m in RUNNER.migrations}
    writers = set()
    for path in sorted(_MIGRATIONS_DIR.glob("v*.py")):
        version = int(path.name[1:4])
        if version >= 5 and _executes_dml(path.read_text()):
            writers.add(version)
    assert writers == set(_NEVER_REPLAYED_DATA_MIGRATIONS), (
        f"data-mutating migrations {sorted(writers)} vs never-replayed {sorted(_NEVER_REPLAYED_DATA_MIGRATIONS)}"
    )
    assert set(_NEVER_REPLAYED_DATA_MIGRATIONS) <= set(by_version)
