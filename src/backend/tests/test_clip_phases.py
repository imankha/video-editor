"""T7860: clip/reel lifecycle-phase inventory derivation.

The derivation SQL is the risk surface, so these tests drive
``compute_profile_phase_inventory`` against a fixture profile DB whose rows cover
every clip phase, every reel phase, every reel flag, AND a multi-clip reel that
must count as ONE published reel (not N).
"""

import sqlite3

import pytest

from app.services.clip_phases import compute_profile_phase_inventory


# The exact column subset the derivation touches — a minimal, faithful stand-in
# for the real profile.sqlite schema (database.py). Kept minimal on purpose so
# the fixture is readable; the columns/types match the real ones.
def _make_profile_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            auto_project_id INTEGER
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            raw_clip_id INTEGER,
            exported_at TEXT DEFAULT NULL,
            crop_data BLOB,
            timing_data BLOB,
            segments_data BLOB
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            published_at TIMESTAMP,
            watched_at TIMESTAMP,
            intro_card_id INTEGER
        );
        """
    )
    return conn


def _raw_clip(conn) -> int:
    cur = conn.execute("INSERT INTO raw_clips DEFAULT VALUES")
    return cur.lastrowid


def _working_clip(conn, raw_clip_id, *, project_id=None, exported=False,
                  crop=False, segments=False, timing=False):
    conn.execute(
        "INSERT INTO working_clips "
        "(project_id, raw_clip_id, exported_at, crop_data, segments_data, timing_data) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            project_id,
            raw_clip_id,
            "2026-08-28T00:00:00" if exported else None,
            b"c" if crop else None,
            b"s" if segments else None,
            b"t" if timing else None,
        ),
    )


def _final_video(conn, *, project_id=None, published=False, watched=False,
                 intro_card_id=None):
    cur = conn.execute(
        "INSERT INTO final_videos (project_id, published_at, watched_at, intro_card_id) "
        "VALUES (?, ?, ?, ?)",
        (
            project_id,
            "2026-08-28T00:00:00" if published else None,
            "2026-08-28T00:00:00" if watched else None,
            intro_card_id,
        ),
    )
    return cur.lastrowid


class TestClipTierFurthestPhase:
    def test_bare_raw_clip_is_created(self):
        conn = _make_profile_db()
        _raw_clip(conn)  # no working_clip at all
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"] == {"created": 1, "focus_started": 0, "focused": 0}

    def test_working_clip_without_framing_is_created(self):
        conn = _make_profile_db()
        rc = _raw_clip(conn)
        _working_clip(conn, rc)  # working_clip exists but no framing data
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"]["created"] == 1
        assert inv["clips"]["focus_started"] == 0

    @pytest.mark.parametrize("field", ["crop", "segments", "timing"])
    def test_any_framing_field_is_focus_started(self, field):
        conn = _make_profile_db()
        rc = _raw_clip(conn)
        _working_clip(conn, rc, **{field: True})
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"] == {"created": 0, "focus_started": 1, "focused": 0}

    def test_exported_is_focused(self):
        conn = _make_profile_db()
        rc = _raw_clip(conn)
        _working_clip(conn, rc, exported=True, crop=True)
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"] == {"created": 0, "focus_started": 0, "focused": 1}

    def test_furthest_phase_wins_across_versions(self):
        # A raw clip with two working_clips: one frame-less, one exported -> focused.
        conn = _make_profile_db()
        rc = _raw_clip(conn)
        _working_clip(conn, rc)  # frame-less
        _working_clip(conn, rc, exported=True)  # exported
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"] == {"created": 0, "focus_started": 0, "focused": 1}

    def test_buckets_sum_to_clip_count_and_are_exclusive(self):
        conn = _make_profile_db()
        c1 = _raw_clip(conn)                       # created
        c2 = _raw_clip(conn); _working_clip(conn, c2, crop=True)      # focus_started
        c3 = _raw_clip(conn); _working_clip(conn, c3, exported=True)  # focused
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["clips"] == {"created": 1, "focus_started": 1, "focused": 1}
        total = sum(inv["clips"].values())
        assert total == 3  # each clip counted exactly once


class TestReelTierAndFlags:
    def test_completed_vs_published_exclusive(self):
        conn = _make_profile_db()
        _final_video(conn)                     # completed (not published)
        _final_video(conn, published=True)     # published
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["reels"] == {"completed": 1, "published": 1}

    def test_intro_semantics_explicit_inherited_optedout(self):
        conn = _make_profile_db()
        _final_video(conn, intro_card_id=42)   # explicit
        _final_video(conn, intro_card_id=None)  # inherit default
        _final_video(conn, intro_card_id=0)    # opted out -> neither
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["flags"]["intro_explicit"] == 1
        assert inv["flags"]["intro_inherited"] == 1

    def test_watched_flag(self):
        conn = _make_profile_db()
        _final_video(conn, watched=True)
        _final_video(conn)
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["flags"]["watched"] == 1

    def test_downloaded_flag_matches_video_id_set(self):
        conn = _make_profile_db()
        v1 = _final_video(conn)
        _final_video(conn)  # v2 not downloaded
        inv = compute_profile_phase_inventory(conn, {v1})
        assert inv["flags"]["downloaded"] == 1

    def test_multi_clip_reel_counts_as_one_published(self):
        """The core design decision: a 3-clip reel that publishes is 1 published,
        not 3 — while its 3 constituent clips still each count as focused."""
        conn = _make_profile_db()
        project_id = 100
        for _ in range(3):
            rc = _raw_clip(conn)
            _working_clip(conn, rc, project_id=project_id, exported=True)
        _final_video(conn, project_id=project_id, published=True)
        inv = compute_profile_phase_inventory(conn, set())
        assert inv["reels"] == {"completed": 0, "published": 1}
        assert inv["clips"]["focused"] == 3


class TestUserAggregation:
    """compute_user_clip_phases sums per-profile inventories and injects the
    Postgres-derived `shared` flag — verified without real R2/PG/profile DBs by
    patching the profile-open + gather seams."""

    def test_aggregates_across_profiles_and_injects_shared(self, monkeypatch):
        import app.services.clip_phases as cp

        # Two profiles, each with distinct content.
        db_a = _make_profile_db()
        a1 = _raw_clip(db_a); _working_clip(db_a, a1, exported=True)  # focused
        va = _final_video(db_a, published=True, intro_card_id=7)

        db_b = _make_profile_db()
        b1 = _raw_clip(db_b)  # created
        _final_video(db_b)    # completed

        conns = {"p_a": db_a, "p_b": db_b}

        monkeypatch.setattr(
            "app.services.user_db.get_profiles",
            lambda uid: [{"id": "p_a"}, {"id": "p_b"}],
        )
        monkeypatch.setattr(
            "app.services.materialization.open_profile_db_readonly",
            lambda uid, pid: conns[pid],
        )
        monkeypatch.setattr(cp, "gather_downloaded_video_ids", lambda uid: set())
        # p_a shared 1 reel, p_b shared none — the injected Postgres flag.
        monkeypatch.setattr(
            cp, "gather_shared_video_ids",
            lambda uid, pid: {va} if pid == "p_a" else set(),
        )

        result = cp.compute_user_clip_phases("user-x", "x@test.com")

        assert result["email"] == "x@test.com"
        assert result["clips"] == {"created": 1, "focus_started": 0, "focused": 1}
        assert result["reels"] == {"completed": 1, "published": 1}
        assert result["flags"]["intro_explicit"] == 1
        assert result["flags"]["shared"] == 1  # injected from p_a's PG set only
        assert len(result["profiles"]) == 2
        # per-profile shared is scoped, not summed onto the wrong profile
        by_id = {p["profile_id"]: p for p in result["profiles"]}
        assert by_id["p_a"]["flags"]["shared"] == 1
        assert by_id["p_b"]["flags"]["shared"] == 0

    def test_unopenable_profile_is_skipped_not_zeroed(self, monkeypatch):
        import app.services.clip_phases as cp

        db_ok = _make_profile_db()
        rc = _raw_clip(db_ok); _working_clip(db_ok, rc, exported=True)

        monkeypatch.setattr(
            "app.services.user_db.get_profiles",
            lambda uid: [{"id": "good"}, {"id": "bad"}],
        )
        # 'bad' cannot be opened -> None -> skipped
        monkeypatch.setattr(
            "app.services.materialization.open_profile_db_readonly",
            lambda uid, pid: db_ok if pid == "good" else None,
        )
        monkeypatch.setattr(cp, "gather_downloaded_video_ids", lambda uid: set())
        monkeypatch.setattr(cp, "gather_shared_video_ids", lambda uid, pid: set())

        result = cp.compute_user_clip_phases("user-y", None)
        assert result["clips"]["focused"] == 1
        assert len(result["profiles"]) == 1  # only the openable profile


def test_empty_profile_is_all_zero():
    conn = _make_profile_db()
    inv = compute_profile_phase_inventory(conn, set())
    assert inv["clips"] == {"created": 0, "focus_started": 0, "focused": 0}
    assert inv["reels"] == {"completed": 0, "published": 0}
    assert inv["flags"] == {
        "intro_explicit": 0, "intro_inherited": 0,
        "downloaded": 0, "shared": 0, "watched": 0,
    }
