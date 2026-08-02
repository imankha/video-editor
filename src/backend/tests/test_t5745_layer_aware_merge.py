"""
T5745: Import merge must be layer-aware.

The clip merge in ``_materialize_clips`` predates the Share the Game epic (it
came from teammate shares) and merged an incoming clip with ANY existing clip
whose time range intersects, regardless of layer, hardcoding ``my_athlete = 0``
onto the surviving row. Once every claim imports Team clips into an account
whose owner tags their own athlete on the same plays (same play = same
timespan = guaranteed intersection), that swallowed the recipient's own My
Athlete clip: converting it to Team, stretching its bounds, and dropping the
distinct team clip.

The fix makes overlap merging layer-aware: an incoming (Team) clip merges only
with an existing Team clip; a cross-layer intersection becomes a plain insert
so both coexist; and a merge never rewrites an existing row's ``my_athlete``.

Fixture style mirrors ``tests/test_materialization.py`` /
``tests/test_t5740_share_scope.py`` (``_create_profile_db``; note
``raw_clips.filename`` is NOT NULL).
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

from app.utils.encoding import encode_data, decode_data
from app.services.materialization import (
    _materialize_clips,
    materialize_game_share,
)

# Reuse the canonical fixtures from the materialization test module.
from tests.test_materialization import (
    _create_profile_db, _insert_game, _insert_game_video, _insert_clip,
)


# ---------------------------------------------------------------------------
# Helper: insert an existing raw_clip with an explicit my_athlete value
# (including NULL) -- the shared _insert_clip helper hardcodes my_athlete=1.
# ---------------------------------------------------------------------------

def _insert_existing_clip(
    conn, game_id, start_time, end_time, my_athlete, *,
    name=None, notes=None, rating=3, video_sequence=0,
    tagged_teammates=None, shared_by=None,
):
    """Insert a raw_clip with an explicit my_athlete (0, 1, or None). Returns id."""
    tt_encoded = encode_data(tagged_teammates) if tagged_teammates else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips
           (filename, rating, name, notes, start_time, end_time, game_id,
            video_sequence, tagged_teammates, my_athlete, shared_by)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rating, name, notes, start_time, end_time, game_id, video_sequence,
         tt_encoded, my_athlete, shared_by),
    )
    conn.commit()
    return cur.lastrowid


def _incoming_team_clip(start_time, end_time, *, name="Team clip", notes=None,
                        rating=3, video_sequence=0, tagged_teammates=None):
    """Build an incoming (Team-layer) share clip dict."""
    clip = {
        "rating": rating, "name": name, "notes": notes,
        "start_time": start_time, "end_time": end_time,
        "video_sequence": video_sequence, "tags": None,
    }
    if tagged_teammates is not None:
        clip["tagged_teammates"] = tagged_teammates
    return clip


# ===========================================================================
# Case 1 -- the headline case: my_athlete=1 clip survives an intersecting import
# ===========================================================================

class TestHeadlineCase:
    def test_my_athlete_clip_survives_intersecting_team_import(self, tmp_path):
        """existing my_athlete=1 clip 10-20, incoming Team 15-25 -> TWO rows;
        the original keeps my_athlete=1 AND bounds 10-20; the new row is
        my_athlete=0 with non-null shared_by."""
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 10.0, 20.0, my_athlete=1,
                              name="My kid scores", video_sequence=0)

        incoming = [_incoming_team_clip(15.0, 25.0, name="Team play")]

        result = _materialize_clips(
            conn, game_id, incoming, shared_by="coach@test.com",
        )
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 0

        rows = conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ? ORDER BY my_athlete DESC",
            (game_id,),
        ).fetchall()
        assert len(rows) == 2, "both the My Athlete clip and the Team clip must exist"

        # The recipient's own clip: layer AND bounds untouched.
        own = conn.execute(
            "SELECT * FROM raw_clips WHERE name = 'My kid scores'").fetchone()
        assert own["my_athlete"] == 1, "recipient's My Athlete clip must NOT become Team"
        assert own["start_time"] == 10.0
        assert own["end_time"] == 20.0, "deliberately trimmed bounds must not be stretched"

        # The imported Team clip: distinct row, Team layer, attributed.
        team = conn.execute(
            "SELECT * FROM raw_clips WHERE name = 'Team play'").fetchone()
        assert team["my_athlete"] == 0
        assert team["start_time"] == 15.0
        assert team["end_time"] == 25.0
        assert team["shared_by"] == "coach@test.com", "T5330: imported clip needs non-null shared_by"

        conn.close()


# ===========================================================================
# Case 2 -- NULL my_athlete is My Athlete (identical outcome to case 1)
# ===========================================================================

class TestNullMyAthleteIsMyAthlete:
    def test_null_layer_treated_as_my_athlete(self, tmp_path):
        """existing my_athlete stored as NULL 10-20, incoming Team 15-25 ->
        TWO rows; the NULL clip's bounds are untouched and it is NOT converted
        to Team (NULL == My Athlete)."""
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        clip_id = _insert_existing_clip(conn, game_id, 10.0, 20.0, my_athlete=None,
                                        name="My kid scores", video_sequence=0)
        # Confirm it really is stored NULL, not defaulted.
        stored = conn.execute(
            "SELECT my_athlete FROM raw_clips WHERE id = ?", (clip_id,)).fetchone()
        assert stored["my_athlete"] is None

        incoming = [_incoming_team_clip(15.0, 25.0, name="Team play")]

        result = _materialize_clips(conn, game_id, incoming, shared_by="coach@test.com")
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 0

        rows = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        assert len(rows) == 2

        own = conn.execute(
            "SELECT * FROM raw_clips WHERE name = 'My kid scores'").fetchone()
        assert own["my_athlete"] is None, "a NULL (My Athlete) clip must stay NULL, never forced to 0"
        assert own["start_time"] == 10.0
        assert own["end_time"] == 20.0

        conn.close()


# ===========================================================================
# Case 3 -- same-layer (Team vs Team) overlap STILL merges (must not regress)
# ===========================================================================

class TestSameLayerStillMerges:
    def test_team_vs_team_overlap_merges(self, tmp_path):
        """existing my_athlete=0 clip 10-20, incoming Team 15-25 -> ONE row,
        bounds unioned to 10-25, my_athlete still 0. This is what keeps a
        re-claim idempotent and prevents duplicate reels."""
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 10.0, 20.0, my_athlete=0,
                              name="Existing team", notes="Note A", video_sequence=0,
                              shared_by="prior@test.com")

        incoming = [_incoming_team_clip(15.0, 25.0, name="Incoming team", notes="Note B")]

        result = _materialize_clips(conn, game_id, incoming, shared_by="coach@test.com")
        conn.commit()

        assert result["inserted"] == 0
        assert result["merged"] == 1

        rows = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        assert len(rows) == 1, "same-layer overlap must still dedupe to one row"
        assert rows[0]["my_athlete"] == 0
        assert rows[0]["start_time"] == 10.0
        assert rows[0]["end_time"] == 25.0, "bounds unioned"
        assert "Note A" in rows[0]["notes"]
        assert "Note B" in rows[0]["notes"]

        conn.close()

    def test_team_vs_team_merge_unions_tagged_teammates(self, tmp_path):
        """Same-layer merge still unions tagged_teammates (behavior unchanged)."""
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 10.0, 20.0, my_athlete=0,
                              name="Existing team", video_sequence=0,
                              tagged_teammates=["Player A"], shared_by="a@test.com")

        incoming = [_incoming_team_clip(15.0, 25.0, name="Incoming team",
                                        tagged_teammates=["Player C"])]

        result = _materialize_clips(
            conn, game_id, incoming,
            shared_by="b@test.com", sharer_profile_name="Player B",
        )
        conn.commit()

        assert result["merged"] == 1
        rows = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        assert len(rows) == 1
        athletes = decode_data(rows[0]["tagged_teammates"])
        assert sorted(athletes) == ["Player A", "Player B", "Player C"]
        conn.close()


# ===========================================================================
# Case 4 -- non-intersecting clips stay separate on any layer (unchanged)
# ===========================================================================

class TestNonIntersecting:
    def test_non_intersecting_my_athlete_stays_separate(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 0.0, 5.0, my_athlete=1,
                              name="My clip", video_sequence=0)

        incoming = [_incoming_team_clip(20.0, 25.0, name="Team clip")]

        result = _materialize_clips(conn, game_id, incoming, shared_by="coach@test.com")
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 0
        rows = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        assert len(rows) == 2
        conn.close()

    def test_non_intersecting_team_stays_separate(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 0.0, 5.0, my_athlete=0,
                              name="Team A", video_sequence=0, shared_by="x@test.com")

        incoming = [_incoming_team_clip(20.0, 25.0, name="Team B")]

        result = _materialize_clips(conn, game_id, incoming, shared_by="coach@test.com")
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 0
        assert len(conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()) == 2
        conn.close()


# ===========================================================================
# Case 5 -- exact-boundary touch is NOT an overlap (strict < semantics)
# ===========================================================================

class TestExactBoundaryTouch:
    def test_touching_boundary_team_vs_team_is_not_overlap(self, tmp_path):
        """existing Team 10-20, incoming Team 20-30 -> NOT an overlap, two rows.
        clips_overlap uses strict '<'; pin the current semantics."""
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_existing_clip(conn, game_id, 10.0, 20.0, my_athlete=0,
                              name="Team A", video_sequence=0, shared_by="x@test.com")

        incoming = [_incoming_team_clip(20.0, 30.0, name="Team B")]

        result = _materialize_clips(conn, game_id, incoming, shared_by="coach@test.com")
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 0
        assert len(conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()) == 2
        conn.close()


# ===========================================================================
# Case 6 -- full path: recipient's intersecting My Athlete clip survives a claim
# ===========================================================================

class TestFullClaimPath:
    def _setup_dbs(self, tmp_path):
        sharer_path = tmp_path / "sharer-user" / "profiles" / "sharer-profile" / "profile.sqlite"
        recipient_path = tmp_path / "recipient-user" / "profiles" / "recipient-profile" / "profile.sqlite"
        s_conn = _create_profile_db(sharer_path)
        r_conn = _create_profile_db(recipient_path)
        return s_conn, r_conn

    @patch("app.services.materialization.mark_game_share_materialized")
    @patch("app.services.materialization.insert_game_storage_ref")
    @patch("app.services.materialization.get_game_storage_ref")
    def test_recipient_my_athlete_clip_survives_real_claim(
        self, mock_get_ref, mock_insert_ref, mock_mark, tmp_path
    ):
        """A claim through materialize_game_share where the recipient already
        has an intersecting My Athlete clip: their clip survives with layer and
        bounds intact, and the imported Team clip is inserted alongside."""
        s_conn, r_conn = self._setup_dbs(tmp_path)

        # Sharer's clip on the same play, tagged for the recipient. Uses the
        # shared helper so clip_teammates rows exist for _filter_clips_for_tag.
        s_game_id = _insert_game(s_conn, name="Match", blake3_hash="shared_hash")
        _insert_clip(s_conn, s_game_id, 15.0, 25.0, tagged_teammates=["Jake"],
                     name="Team play", rating=4, video_sequence=0)

        # Recipient already has the same game (dedup by hash) with their own
        # deliberately-trimmed My Athlete clip covering the same play.
        r_game_id = _insert_game(r_conn, name="Match", blake3_hash="shared_hash")
        _insert_existing_clip(r_conn, r_game_id, 10.0, 20.0, my_athlete=1,
                              name="My kid scores", video_sequence=0)
        r_conn.close()

        mock_get_ref.return_value = {
            "game_size_bytes": 50000,
            "storage_expires_at": "2027-01-01T00:00:00+00:00",
        }

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path):
            result = materialize_game_share(
                sharer_user_id="sharer-user",
                sharer_profile_id="sharer-profile",
                recipient_user_id="recipient-user",
                recipient_profile_id="recipient-profile",
                game_id=s_game_id,
                tag_name="Jake",
                share_id=1,
            )

        assert result["game_id"] == r_game_id
        assert result["inserted"] == 1, "the Team clip is inserted, not swallowed"
        assert result["merged"] == 0, "cross-layer overlap must NOT merge"

        check = sqlite3.connect(
            str(tmp_path / "recipient-user" / "profiles" / "recipient-profile" / "profile.sqlite")
        )
        check.row_factory = sqlite3.Row
        rows = check.execute("SELECT * FROM raw_clips WHERE game_id = ?", (r_game_id,)).fetchall()
        assert len(rows) == 2

        own = check.execute(
            "SELECT * FROM raw_clips WHERE name = 'My kid scores'").fetchone()
        assert own["my_athlete"] == 1, "recipient's My Athlete clip must survive as My Athlete"
        assert own["start_time"] == 10.0
        assert own["end_time"] == 20.0, "bounds intact -- not stretched to the union"

        team = check.execute(
            "SELECT * FROM raw_clips WHERE name = 'Team play'").fetchone()
        assert team["my_athlete"] == 0
        assert team["shared_by"] is not None, "T5330: imported clip carries non-null shared_by"
        check.close()

        s_conn.close()
