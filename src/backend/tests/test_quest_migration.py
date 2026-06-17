"""Tests for V005QuestRestructure — T3700 quest reconciliation for existing users."""
import sqlite3

from app.migrations.user_db.v005_quest_restructure import V005QuestRestructure
from app.migrations.user_db.v006_split_overlay_quest import V006SplitOverlayQuest


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


def test_framing_overlay_done_marks_spotlight():
    """Completed old quest_2 (framing+overlay) -> new quest_3 (Spotlight) marked complete."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"), claimed=("quest_1", "quest_2"))
    V005QuestRestructure().up(conn)
    assert _completed(conn) == {"quest_1", "quest_2", "quest_3"}


def test_finished_old_flow():
    """Old quest_1/2/3 complete -> still the 3 new quests complete (quest_3 idempotent insert)."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2", "quest_3"))
    V005QuestRestructure().up(conn)
    assert _completed(conn) == {"quest_1", "quest_2", "quest_3"}


def test_only_get_started():
    conn = _make_db()
    _seed(conn, completed=("quest_1",))
    V005QuestRestructure().up(conn)
    assert _completed(conn) == {"quest_1"}


def test_no_quest_2_no_spotlight():
    """Without old quest_2, the migration does not fabricate quest_3."""
    conn = _make_db()
    _seed(conn, completed=("quest_1",))
    V005QuestRestructure().up(conn)
    assert "quest_3" not in _completed(conn)


def test_idempotent():
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"))
    V005QuestRestructure().up(conn)
    first = _completed(conn)
    V005QuestRestructure().up(conn)
    assert _completed(conn) == first


def test_fresh_user_noop():
    conn = _make_db()
    V005QuestRestructure().up(conn)
    assert _completed(conn) == set()


# --- V006: overlay quest split (quest_3 -> quest_3 Configure + quest_4 Publish) ---

def test_v006_old_overlay_flow_marks_publish():
    """Completed old quest_2 (bundled overlay) -> new quest_4 (Publish) marked complete."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"))
    V006SplitOverlayQuest().up(conn)
    assert "quest_4" in _completed(conn)


def test_v006_no_quest_2_no_publish():
    """Without old quest_2, the migration does not fabricate quest_4."""
    conn = _make_db()
    _seed(conn, completed=("quest_1",))
    V006SplitOverlayQuest().up(conn)
    assert "quest_4" not in _completed(conn)


def test_v006_idempotent():
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"))
    V006SplitOverlayQuest().up(conn)
    first = _completed(conn)
    V006SplitOverlayQuest().up(conn)
    assert _completed(conn) == first


def test_v005_then_v006_full_reconcile():
    """Old quest_2 done -> v005 marks quest_3 (Configure), v006 marks quest_4 (Publish)."""
    conn = _make_db()
    _seed(conn, completed=("quest_1", "quest_2"), claimed=("quest_1", "quest_2"))
    V005QuestRestructure().up(conn)
    V006SplitOverlayQuest().up(conn)
    assert _completed(conn) == {"quest_1", "quest_2", "quest_3", "quest_4"}


def test_v006_fresh_user_noop():
    conn = _make_db()
    V006SplitOverlayQuest().up(conn)
    assert _completed(conn) == set()
