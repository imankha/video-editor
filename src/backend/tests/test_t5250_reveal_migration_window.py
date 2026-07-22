"""T5250: the reveal_enabled column arrives with the v030 migration, which runs manually
(not on deploy/startup). The overlay read paths (get_overlay_data, render_overlay) must
tolerate the deploy->migrate window — SELECT reveal_enabled only when the column exists,
else default to 0/off — so a below-head DB never crashes and never loses ALL overlay
regions in the Overlay screen (regression: `no such column: reveal_enabled` 500'd
/overlay-data, wiping every draft reel's regions).

These pin the tolerant-SELECT pattern the read paths use (_has_reveal_enabled_column +
conditional projection), so a refactor can't silently reintroduce the hard SELECT.
"""

import sqlite3

from app.routers.export.overlay import _has_reveal_enabled_column


def _make_working_videos(with_reveal: bool) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cols = "id INTEGER PRIMARY KEY, project_id INTEGER, highlights_data TEXT"
    if with_reveal:
        cols += ", reveal_enabled INTEGER DEFAULT 0"
    conn.execute(f"CREATE TABLE working_videos ({cols})")
    if with_reveal:
        conn.execute("INSERT INTO working_videos (id, project_id, highlights_data, reveal_enabled) VALUES (1, 7, '[]', 1)")
    else:
        conn.execute("INSERT INTO working_videos (id, project_id, highlights_data) VALUES (1, 7, '[]')")
    conn.commit()
    return conn


def _reveal_select(cursor) -> str:
    # Mirrors the projection built in get_overlay_data / render_overlay.
    return "reveal_enabled" if _has_reveal_enabled_column(cursor) else "0 as reveal_enabled"


def test_has_reveal_enabled_column_detects_presence():
    assert _has_reveal_enabled_column(_make_working_videos(True).cursor()) is True
    assert _has_reveal_enabled_column(_make_working_videos(False).cursor()) is False


def test_overlay_read_defaults_reveal_when_column_absent():
    # Pre-migration window: no reveal_enabled column. The overlay data (incl. regions)
    # must still load, with reveal defaulting to off — NOT crash with "no such column".
    conn = _make_working_videos(with_reveal=False)
    cur = conn.cursor()
    rev = _reveal_select(cur)
    row = cur.execute(
        f"SELECT highlights_data, {rev} FROM working_videos WHERE project_id = 7"
    ).fetchone()
    assert row is not None  # regions are NOT lost
    assert bool(row["reveal_enabled"]) is False


def test_overlay_read_uses_real_reveal_when_column_present():
    conn = _make_working_videos(with_reveal=True)
    cur = conn.cursor()
    rev = _reveal_select(cur)
    row = cur.execute(
        f"SELECT highlights_data, {rev} FROM working_videos WHERE project_id = 7"
    ).fetchone()
    assert bool(row["reveal_enabled"]) is True
