"""
Pin the semantics of sqlite3.Row membership testing.

sqlite3.Row does NOT implement __contains__, so `key in row` falls back to
iterating over row VALUES -- it checks values, not column names.
Correct column-name membership test is `key in row.keys()`.

This test exists because ruff SIM118 incorrectly flags `x in row.keys()` as
equivalent to `x in row` for sqlite3.Row objects. The fixes were reverted in
T5020; this test proves why.
"""

import sqlite3


def _make_row(columns: str, values: tuple) -> sqlite3.Row:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(f"CREATE TABLE t ({columns})")
    conn.execute(f"INSERT INTO t VALUES ({', '.join('?' for _ in values)})", values)
    return conn.execute("SELECT * FROM t").fetchone()


def test_keys_checks_column_names():
    row = _make_row("width INTEGER, height INTEGER", (1920, 1080))

    assert "width" in row.keys()
    assert "height" in row.keys()
    assert "depth" not in row.keys()


def test_in_row_checks_values_not_keys():
    row = _make_row("width INTEGER, height INTEGER", (1920, 1080))

    # 'width' is a column NAME, not a value -- so 'in row' returns False
    assert "width" not in row
    # 1920 IS a value
    assert 1920 in row


def test_sim118_false_positive_nullable_column():
    """
    Demonstrates the bug our revert fixes.

    highlight_color is a real column selected in the query. With ruff's
    suggested rewrite:
      - row.keys() form correctly returns True (column exists)
      - 'in row' form returns False ('highlight_color' string is not a value)
    """
    row = _make_row("highlight_color TEXT, name TEXT", ("red", "proj"))

    # Correct: column-name check
    assert "highlight_color" in row.keys()

    # Bug: value check silently returns False even though the column exists
    assert "highlight_color" not in row  # 'highlight_color' is not a VALUE

    # Consequence: ruff's rewrite breaks the conditional
    correct = row["highlight_color"] if "highlight_color" in row.keys() else None
    buggy = row["highlight_color"] if "highlight_color" in row else None

    assert correct == "red"   # column exists, value returned
    assert buggy is None      # ruff's form silently drops the value


def test_sim118_safe_for_dicts():
    """
    Confirm SIM118 is correct for plain dicts (the rule's intended target).
    """
    d = {"highlight_color": "blue", "name": "proj"}

    assert "highlight_color" in d.keys()
    assert "highlight_color" in d  # both forms equivalent for dict
    assert d["highlight_color"] if "highlight_color" in d else None == "blue"
