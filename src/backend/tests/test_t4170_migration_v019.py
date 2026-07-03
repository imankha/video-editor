"""T4170 — v019 heal migration for sweep stream-copy reel metadata.

The expiry-sweep auto-export published raw 1920x1080 stream-copy reels tagged
`source_type='brilliant_clip'` with filenames `auto_{game}_{clip}_{hex}.mp4` but
the wrong stored metadata: `aspect_ratio='9:16'` (the files are 16:9 game footage)
and, when the source clip was unnamed, a `Clip N` fallback name.

v019 heals both, generically across all profile DBs:
  1. flip `aspect_ratio` 9:16 -> 16:9 on every `auto_*` brilliant_clip row
  2. derive a real name from the source raw_clip for rows still carrying the
     `Clip N` (or NULL/empty) fallback -- leaving user renames frozen.

These tests seed real rows (the empty-DB-only gap that shipped v017 broken).
"""

import sqlite3

import pytest

from app.migrations.profile_db.v019_heal_sweep_reel_metadata import (
    V019HealSweepReelMetadata,
)
from app.queries import derive_clip_name
from app.utils.encoding import encode_data


def _make_db(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute(
        """CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            filename TEXT NOT NULL,
            source_type TEXT,
            name TEXT,
            aspect_ratio TEXT,
            source_clip_id INTEGER
        )"""
    )
    conn.execute(
        """CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT
        )"""
    )
    conn.commit()
    return conn


def _add_final(conn, *, id, filename, source_type, name, aspect_ratio, source_clip_id):
    conn.execute(
        "INSERT INTO final_videos (id, filename, source_type, name, aspect_ratio, source_clip_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (id, filename, source_type, name, aspect_ratio, source_clip_id),
    )
    conn.commit()


def _add_raw_clip(conn, *, id, name, rating, tags, notes=""):
    conn.execute(
        "INSERT INTO raw_clips (id, filename, rating, tags, name, notes) VALUES (?, ?, ?, ?, ?, ?)",
        (id, f"raw_{id}.mp4", rating, encode_data(tags), name, notes),
    )
    conn.commit()


def _final(conn, fv_id):
    return conn.execute(
        "SELECT name, aspect_ratio FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()


def test_heals_fallback_named_sweep_row(tmp_path):
    """(a) auto_* 9:16 'Clip 5' row + source raw_clip -> ar=16:9 AND name derived."""
    conn = _make_db(tmp_path)
    tags = ["Dribble", "Control", "Goal"]
    _add_raw_clip(conn, id=5, name="", rating=5, tags=tags)
    _add_final(
        conn, id=20, filename="auto_3_5_762db662.mp4", source_type="brilliant_clip",
        name="Clip 5", aspect_ratio="9:16", source_clip_id=5,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 20)
    assert ar == "16:9"
    expected = derive_clip_name("", 5, tags, "")
    assert name == expected
    assert name and name != "Clip 5"
    assert name == "Brilliant Dribble, Control and Goal"


def test_user_renamed_sweep_row_keeps_name_but_flips_ar(tmp_path):
    """(b) auto_* row with a user-given name -> ar flipped, name UNTOUCHED."""
    conn = _make_db(tmp_path)
    _add_raw_clip(conn, id=6, name="", rating=5, tags=["Goal"])
    _add_final(
        conn, id=16, filename="auto_6_62_46244cd1.mp4", source_type="brilliant_clip",
        name="Amazing volley assist to LilaW", aspect_ratio="9:16", source_clip_id=6,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 16)
    assert ar == "16:9"
    assert name == "Amazing volley assist to LilaW"


def test_normal_framed_reel_untouched(tmp_path):
    """(c) a normal framed reel (final_*.mp4, legitimately 9:16) -> completely untouched."""
    conn = _make_db(tmp_path)
    _add_final(
        conn, id=5, filename="final_41_997d773b.mp4", source_type="project",
        name="My Highlight Reel", aspect_ratio="9:16", source_clip_id=None,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 5)
    assert ar == "9:16"
    assert name == "My Highlight Reel"


def test_automatic_prefix_not_matched(tmp_path):
    """The `_` in LIKE 'auto_%' is a wildcard -> 'automatic...' must NOT be flipped."""
    conn = _make_db(tmp_path)
    _add_final(
        conn, id=99, filename="automatic_thing.mp4", source_type="brilliant_clip",
        name="Clip 9", aspect_ratio="9:16", source_clip_id=None,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 99)
    assert ar == "9:16"
    assert name == "Clip 9"


def test_fallback_row_with_missing_source_clip_flips_ar_keeps_name(tmp_path):
    """(d) auto_* fallback-named row whose source raw_clip is gone -> ar flipped, name kept."""
    conn = _make_db(tmp_path)
    # source_clip_id points at a raw_clip that does not exist.
    _add_final(
        conn, id=21, filename="auto_4_26_4ed1a82b.mp4", source_type="brilliant_clip",
        name="Clip 7", aspect_ratio="9:16", source_clip_id=999,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 21)
    assert ar == "16:9"
    assert name == "Clip 7"


def test_underivable_name_kept(tmp_path):
    """A fallback name whose source clip yields no derivable name is left as-is (ar still flips)."""
    conn = _make_db(tmp_path)
    # No name, no tags, no notes -> derive_clip_name returns '' -> keep fallback.
    _add_raw_clip(conn, id=8, name="", rating=3, tags=[], notes="")
    _add_final(
        conn, id=30, filename="auto_1_8_deadbeef.mp4", source_type="brilliant_clip",
        name="Clip 8", aspect_ratio="9:16", source_clip_id=8,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 30)
    assert ar == "16:9"
    assert name == "Clip 8"


def test_null_name_gets_derived(tmp_path):
    """A NULL-named sweep row is eligible for derivation too."""
    conn = _make_db(tmp_path)
    _add_raw_clip(conn, id=9, name="", rating=4, tags=["Assist"])
    _add_final(
        conn, id=31, filename="auto_2_9_cafef00d.mp4", source_type="brilliant_clip",
        name=None, aspect_ratio="9:16", source_clip_id=9,
    )

    V019HealSweepReelMetadata().up(conn)

    name, ar = _final(conn, 31)
    assert ar == "16:9"
    assert name == derive_clip_name("", 4, ["Assist"], "")


def test_idempotent_rerun_is_noop(tmp_path):
    """(e) run the migration twice -> second run changes nothing."""
    conn = _make_db(tmp_path)
    tags = ["Dribble", "Control", "Goal"]
    _add_raw_clip(conn, id=5, name="", rating=5, tags=tags)
    _add_final(
        conn, id=20, filename="auto_3_5_762db662.mp4", source_type="brilliant_clip",
        name="Clip 5", aspect_ratio="9:16", source_clip_id=5,
    )

    V019HealSweepReelMetadata().up(conn)
    after_first = _final(conn, 20)
    V019HealSweepReelMetadata().up(conn)
    after_second = _final(conn, 20)

    assert after_first == after_second
    assert after_second[1] == "16:9"
    assert after_second[0] == "Brilliant Dribble, Control and Goal"


def test_noop_on_empty_db(tmp_path):
    """(f) empty/fresh DB (no tables) -> no-op, no crash."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables
    V019HealSweepReelMetadata().up(conn)  # must not raise


def test_noop_when_only_final_videos_table(tmp_path):
    """Missing raw_clips table alone -> guard returns early without raising."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute("CREATE TABLE final_videos (id INTEGER PRIMARY KEY)")
    conn.commit()
    V019HealSweepReelMetadata().up(conn)  # must not raise
