"""Tests for V005QuestRestructure — T3700 quest-id reconciliation for existing users."""
import sqlite3

import pytest

from app.migrations.user_db.v005_quest_restructure import V005QuestRestructure


def _make_db():
    conn = sqlite3.connect(":memory:")
    conn.execute("""
        CREATE TABLE completed_quests (
            quest_id TEXT PRIMARY KEY,
            completed_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE credit_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            source TEXT NOT NULL,
            reference_id TEXT,
            video_seconds REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX idx_credit_tx_idempotent
        ON credit_transactions(user_id, source, reference_id)
        WHERE reference_id IS NOT NULL
    """)
    return conn


def _seed(conn, completed=(), claimed=()):
    for qid in completed:
        conn.execute("INSERT INTO completed_quests (quest_id) VALUES (?)", (qid,))
    for qid in claimed:
        conn.execute(
            "INSERT INTO credit_transactions (user_id, amount, source, reference_id) VALUES (?, ?, 'quest_reward', ?)",
            ("u1", 25, qid),
        )
    conn.commit()


def _completed(conn):
    return {r[0] for r in conn.execute("SELECT quest_id FROM completed_quests")}


def _claimed(conn):
    return {r[0] for r in conn.execute(
        "SELECT reference_id FROM credit_transactions WHERE source='quest_reward'")}


def test_finished_everything():
    """Completed all 3 old quests -> all 4 new quests resolved."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2", "quest_3"),
          claimed=("quest_1", "quest_2", "quest_3"))
    V005QuestRestructure().up(conn)

    # quest_3 (Annotate More) became quest_4; quest_2 spawned a completed quest_3 (Spotlight)
    assert _completed(conn) == {"quest_1", "quest_2", "quest_3", "quest_4"}
    # claim ledger: quest_3's 40cr reward rekeyed to quest_4; no new credit row for new quest_3
    assert _claimed(conn) == {"quest_1", "quest_2", "quest_4"}


def test_framing_overlay_only():
    """Completed old quest_2 (framing+overlay) but not old quest_3."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"), claimed=("quest_1", "quest_2"))
    V005QuestRestructure().up(conn)

    assert _completed(conn) == {"quest_1", "quest_2", "quest_3"}
    assert _claimed(conn) == {"quest_1", "quest_2"}  # quest_4 not reached


def test_only_get_started():
    conn = _make_db()
    _seed(conn, completed=("quest_1",), claimed=("quest_1",))
    V005QuestRestructure().up(conn)
    assert _completed(conn) == {"quest_1"}
    assert _claimed(conn) == {"quest_1"}


def test_old_q3_without_q2():
    """Edge: completed old quest_3 (Annotate More) but never old quest_2."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_3"), claimed=("quest_1", "quest_3"))
    V005QuestRestructure().up(conn)
    # quest_3 -> quest_4; no quest_2 so no new quest_3
    assert _completed(conn) == {"quest_1", "quest_4"}
    assert _claimed(conn) == {"quest_1", "quest_4"}


def test_idempotent():
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2", "quest_3"),
          claimed=("quest_1", "quest_2", "quest_3"))
    V005QuestRestructure().up(conn)
    first_completed, first_claimed = _completed(conn), _claimed(conn)
    V005QuestRestructure().up(conn)  # run again
    assert _completed(conn) == first_completed
    assert _claimed(conn) == first_claimed


def test_fresh_user_noop():
    """A brand-new user with no quest state is untouched."""
    conn = _make_db()
    V005QuestRestructure().up(conn)
    assert _completed(conn) == set()
    assert _claimed(conn) == set()
