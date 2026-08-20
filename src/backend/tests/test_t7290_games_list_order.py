"""T7290: the games list is ordered by MATCH date, not upload date.

The Games tab groups by game_date; list_games must hand back the same order so the
first paint (and any consumer that trusts server order) cannot contradict what the
frontend renders. These tests run the EXACT production ORDER BY expression against a
real sqlite games table, so the clause and its test can never drift apart.
"""
import sqlite3

from app.routers.games import GAMES_MATCH_DATE_ORDER_BY


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE games (
               id INTEGER PRIMARY KEY,
               name TEXT,
               game_date TEXT,
               created_at TIMESTAMP)"""
    )
    return conn


def _add(conn, game_id, game_date, created_at):
    conn.execute(
        "INSERT INTO games (id, name, game_date, created_at) VALUES (?, ?, ?, ?)",
        (game_id, f"game-{game_id}", game_date, created_at),
    )


def _ordered_ids(conn):
    rows = conn.execute(
        f"SELECT g.id FROM games g {GAMES_MATCH_DATE_ORDER_BY}"
    ).fetchall()
    return [r["id"] for r in rows]


def test_orders_by_match_date_not_upload_date():
    conn = _conn()
    # The reported case: one June upload batch, match dates spread over March-May.
    # Upload order (ids ascending) is deliberately the REVERSE of match order.
    _add(conn, 1, "2026-05-09", "2026-06-11 18:00:00")
    _add(conn, 2, "2026-04-26", "2026-06-11 18:01:00")
    _add(conn, 3, "2026-03-21", "2026-06-11 18:02:00")
    assert _ordered_ids(conn) == [1, 2, 3]

    # Same rows, upload order shuffled: the result must follow match date alone.
    conn2 = _conn()
    _add(conn2, 1, "2026-03-21", "2026-06-11 18:00:00")
    _add(conn2, 2, "2026-05-09", "2026-06-11 17:00:00")
    _add(conn2, 3, "2026-04-26", "2026-06-11 19:00:00")
    assert _ordered_ids(conn2) == [2, 3, 1]


def test_missing_match_date_falls_back_to_upload_date_without_dropping_the_game():
    """SHARED FIXTURE with ProjectManager.gameGrouping.test.jsx ("agrees with the
    list_games server order") -- same rows, same expected order. The frontend grouping
    and this clause are two halves of one contract; change one side and both go red."""
    conn = _conn()
    _add(conn, 1, "2026-05-09", "2026-06-11 18:00:00")
    _add(conn, 2, None, "2026-04-02 09:00:00")        # pre-requirement / shared row
    _add(conn, 3, "", "2026-02-14 09:00:00")          # empty string, same treatment
    _add(conn, 4, "2026-03-21", "2026-06-11 18:00:00")

    ordered = _ordered_ids(conn)
    assert ordered == [1, 2, 4, 3]
    assert len(ordered) == 4  # nothing filtered out by a missing date


def test_same_match_day_breaks_the_tie_on_upload_time_newest_first():
    conn = _conn()
    # A tournament day: game_date carries no time, so upload time orders them.
    _add(conn, 1, "2026-04-18", "2026-06-11 10:00:00")
    _add(conn, 2, "2026-04-18", "2026-06-11 18:00:00")
    _add(conn, 3, "2026-04-18", "2026-06-11 14:00:00")
    assert _ordered_ids(conn) == [2, 3, 1]


def test_a_dated_game_and_a_dateless_upload_on_the_same_day_tie_on_the_day():
    """SHARED FIXTURE with ProjectManager.gameGrouping.test.jsx ("...land on the SAME
    day"). The fallback compares the upload CALENDAR DAY, not the timestamp: game 2's
    upload time never outranks game 1's match date, it only ties with it -- and the
    tie then goes to the newer upload. Keying the frontend off the full timestamp made
    the two orders disagree here, which is what this pair of tests pins down."""
    conn = _conn()
    _add(conn, 1, "2026-05-09", "2026-06-11 18:00:00")   # old footage, uploaded in June
    _add(conn, 2, None, "2026-05-09 08:00:00")           # dateless row, uploaded May 9
    assert _ordered_ids(conn) == [1, 2]


def test_upload_time_does_not_outrank_a_later_match_date():
    conn = _conn()
    # A dateless row uploaded TODAY still sorts below a match played later than its
    # upload day -- the fallback is a placement, never a promotion to "most recent".
    _add(conn, 1, "2026-05-10", "2026-06-11 18:00:00")
    _add(conn, 2, None, "2026-05-09 23:00:00")
    assert _ordered_ids(conn) == [1, 2]
