"""
T5730: Claim & import flow for a public game link.

The single most important property (asserted directly, both paths): every copied
game AND clip carries a NON-NULL `shared_by` -- a claim path that regressed it
would silently skip onboarding for imported content (T5330 invariant).

Also covers: game-only vs with-annotations column-level differences, TEAM-layer
only import (my_athlete=1 never crosses), claim idempotency (twice -> same local
game), re-claim-with-annotations after a game-only claim (clips land in the SAME
game), the `share_claims` row, referral channel `game_link` attribution, and the
endpoint contract (401 unauth / 404 unknown / 410 revoked / 400 profile pick).
"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.services.materialization import (
    claim_game_link,
    team_layer_clips_for_game,
)
from app.utils.encoding import encode_data
from tests.test_materialization import _create_profile_db, _insert_game

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
SHARER_PROFILE = "sharerprof"
CLAIMER_ID = "claimer-user"
CLAIMER_EMAIL = "claimer@example.com"
CLAIMER_PROFILE = "claimrprof"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _insert_clip(conn, game_id, start, end, *, name, my_athlete, rating=3,
                 notes=None, tagged_teammates=None, video_sequence=0):
    tt = encode_data(tagged_teammates) if tagged_teammates else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips
           (filename, rating, name, notes, start_time, end_time, game_id,
            video_sequence, tagged_teammates, my_athlete)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rating, name, notes, start, end, game_id, video_sequence, tt, my_athlete),
    )
    conn.commit()
    return cur.lastrowid


def _profile_db_path(base, user_id, profile_id):
    return base / user_id / "profiles" / profile_id / "profile.sqlite"


def _seed_sharer_dbs(base, *, team_clips=True, athlete_clips=True, game_hash="claimhash"):
    """Sharer profile DB with a game + team-layer (and optionally athlete-layer)
    clips. Returns the sharer's local game_id."""
    s_path = _profile_db_path(base, SHARER_ID, SHARER_PROFILE)
    s_conn = _create_profile_db(s_path)
    game_id = _insert_game(s_conn, name="vs Riverside", blake3_hash=game_hash)
    if team_clips:
        _insert_clip(s_conn, game_id, 0, 5, name="Team goal", my_athlete=0,
                     rating=5, tagged_teammates=["#7"])
        _insert_clip(s_conn, game_id, 10, 15, name="Big save", my_athlete=0, rating=4)
    if athlete_clips:
        _insert_clip(s_conn, game_id, 20, 25, name="My kid scores", my_athlete=1,
                     rating=5)
    s_conn.close()
    # Recipient DB must exist locally (materialize's _open_profile_db is local-only).
    _create_profile_db(_profile_db_path(base, CLAIMER_ID, CLAIMER_PROFILE)).close()
    return game_id


def _make_game_link_share(game_id):
    from app.services.sharing_db import create_game_share, get_game_share_by_token
    share = create_game_share(
        game_id=game_id, tag_name=None,
        sharer_user_id=SHARER_ID, sharer_profile_id=SHARER_PROFILE,
        recipient_email=SHARER_EMAIL, game_name="vs Riverside",
        game_blake3="claimhash", share_type="game_link", game_date="2026-03-03",
    )
    return get_game_share_by_token(share["share_token"])


def _open(base, user_id, profile_id):
    conn = sqlite3.connect(str(_profile_db_path(base, user_id, profile_id)))
    conn.row_factory = sqlite3.Row
    return conn


# ===========================================================================
# Unit: TEAM-layer clip selection
# ===========================================================================

class TestTeamLayerClips:
    def test_returns_only_my_athlete_zero(self, tmp_path):
        conn = _create_profile_db(tmp_path / "s" / "profile.sqlite")
        game_id = _insert_game(conn, blake3_hash="h")
        _insert_clip(conn, game_id, 0, 5, name="Team A", my_athlete=0)
        _insert_clip(conn, game_id, 5, 10, name="Team B", my_athlete=0)
        _insert_clip(conn, game_id, 10, 15, name="Athlete", my_athlete=1)
        clips = team_layer_clips_for_game(conn, game_id)
        assert sorted(c["name"] for c in clips) == ["Team A", "Team B"]
        conn.close()

    def test_shape_matches_materialize_contract(self, tmp_path):
        conn = _create_profile_db(tmp_path / "s" / "profile.sqlite")
        game_id = _insert_game(conn, blake3_hash="h")
        _insert_clip(conn, game_id, 1.5, 3.5, name="Goal", my_athlete=0, rating=5,
                     notes="great", tagged_teammates=["#7"], video_sequence=2)
        c = team_layer_clips_for_game(conn, game_id)[0]
        assert c["start_time"] == 1.5 and c["end_time"] == 3.5
        assert c["name"] == "Goal" and c["rating"] == 5 and c["notes"] == "great"
        assert c["video_sequence"] == 2
        assert c["tagged_teammates"] == ["#7"]  # decoded, per _filter_clips_for_tag
        conn.close()


# ===========================================================================
# Service: claim_game_link (column-level shared_by, idempotency, re-claim)
# ===========================================================================

class TestClaimGameLink:
    @pytest.fixture()
    def env(self, pg_conn, tmp_path):
        # get_game_storage_ref / insert_game_storage_ref go through
        # get_db_connection (the CURRENT context's profile SQLite), so they are
        # mocked here exactly as the existing materialization tests do -- the
        # claim's provenance/clip behavior is what these tests assert, not the
        # storage-ref bookkeeping (which the head-object-guarded heal path owns,
        # T4820). get_ref defaults to None so a claim fabricates NO storage ref.
        import app.services.pg as pgmod
        from app.services.auth_db import create_user
        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(CLAIMER_ID, email=CLAIMER_EMAIL)
        with patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
             patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.materialization.get_pg", pgmod.get_pg), \
             patch("app.services.materialization.get_game_storage_ref",
                   return_value=None) as get_ref, \
             patch("app.services.materialization.insert_game_storage_ref") as insert_ref:
            self.get_ref = get_ref
            self.insert_ref = insert_ref
            yield tmp_path

    def test_game_only_claim_shared_by_non_null(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        result = claim_game_link(
            share, CLAIMER_ID, CLAIMER_PROFILE,
            include_annotations=False, sharer_email=SHARER_EMAIL,
        )
        assert result["already_claimed"] is False
        assert result["imported_annotations"] is False

        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        games = conn.execute("SELECT * FROM games").fetchall()
        clips = conn.execute("SELECT * FROM raw_clips").fetchall()
        conn.close()
        assert len(games) == 1
        # THE invariant: shared_by is NON-NULL on the copied game (game-only path).
        assert games[0]["shared_by"] == SHARER_EMAIL
        assert games[0]["id"] == result["game_id"]
        # Game only -> zero clips imported.
        assert len(clips) == 0

    def test_with_annotations_shared_by_non_null_on_game_and_every_clip(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        result = claim_game_link(
            share, CLAIMER_ID, CLAIMER_PROFILE,
            include_annotations=True, sharer_email=SHARER_EMAIL,
        )
        assert result["imported_annotations"] is True

        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        game = conn.execute("SELECT * FROM games").fetchone()
        clips = conn.execute("SELECT * FROM raw_clips ORDER BY start_time").fetchall()
        conn.close()
        # shared_by NON-NULL on the game AND every clip -- column-level assertion.
        assert game["shared_by"] == SHARER_EMAIL
        assert len(clips) == 2  # only the two TEAM-layer clips
        for c in clips:
            assert c["shared_by"] == SHARER_EMAIL, "every imported clip must be shared-in"
            assert c["my_athlete"] == 0, "imported clips land on the Team layer"
        assert {c["name"] for c in clips} == {"Team goal", "Big save"}

    def test_imports_team_layer_only_never_athlete(self, env):
        """The sharer has a my_athlete=1 clip; a claim must NEVER import it."""
        game_id = _seed_sharer_dbs(env, athlete_clips=True)
        share = _make_game_link_share(game_id)
        claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                        include_annotations=True, sharer_email=SHARER_EMAIL)
        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        names = [r["name"] for r in conn.execute("SELECT name FROM raw_clips").fetchall()]
        conn.close()
        assert "My kid scores" not in names
        assert sorted(names) == ["Big save", "Team goal"]

    def test_game_only_vs_annotations_column_diff(self, env):
        """Same source, two claimers: game-only has 0 clips, annotations has 2 --
        both games carry shared_by (column-level difference, not just a count)."""
        from app.services.auth_db import create_user
        create_user("claimer-b", email="b@example.com")
        game_id = _seed_sharer_dbs(env)
        _create_profile_db(_profile_db_path(env, "claimer-b", "bprof")).close()
        share = _make_game_link_share(game_id)

        claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                        include_annotations=False, sharer_email=SHARER_EMAIL)
        claim_game_link(share, "claimer-b", "bprof",
                        include_annotations=True, sharer_email=SHARER_EMAIL)

        a = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        b = _open(env, "claimer-b", "bprof")
        a_game = a.execute("SELECT * FROM games").fetchone()
        b_game = b.execute("SELECT * FROM games").fetchone()
        a_clips = a.execute("SELECT COUNT(*) c FROM raw_clips").fetchone()["c"]
        b_clips = b.execute("SELECT COUNT(*) c FROM raw_clips").fetchone()["c"]
        a.close(); b.close()
        assert a_clips == 0 and b_clips == 2
        assert a_game["shared_by"] == SHARER_EMAIL
        assert b_game["shared_by"] == SHARER_EMAIL

    def test_claim_idempotent_same_local_game(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        first = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                include_annotations=True, sharer_email=SHARER_EMAIL)
        second = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                 include_annotations=True, sharer_email=SHARER_EMAIL)
        assert second["already_claimed"] is True
        assert first["game_id"] == second["game_id"]

        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        assert conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"] == 1
        conn.close()
        # Exactly one share_claims row.
        from app.services.pg import get_pg
        with get_pg() as pg:
            cur = pg.cursor()
            cur.execute("SELECT COUNT(*) c FROM share_claims WHERE share_id=%s",
                        (share["id"],))
            assert cur.fetchone()["c"] == 1

    def test_reclaim_with_annotations_after_game_only(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        first = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                include_annotations=False, sharer_email=SHARER_EMAIL)
        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        assert conn.execute("SELECT COUNT(*) c FROM raw_clips").fetchone()["c"] == 0
        conn.close()

        second = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                 include_annotations=True, sharer_email=SHARER_EMAIL)
        # Clips land in the SAME game (hash dedup), not a second copy.
        assert second["game_id"] == first["game_id"]
        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        assert conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"] == 1
        clips = conn.execute("SELECT * FROM raw_clips").fetchall()
        conn.close()
        assert len(clips) == 2
        for c in clips:
            assert c["shared_by"] == SHARER_EMAIL

        # Claim row upgraded to include_annotations, still one row.
        from app.services.sharing_db import get_share_claim
        row = get_share_claim(share["id"], CLAIMER_ID)
        assert row["include_annotations"] is True
        assert row["local_game_id"] == first["game_id"]

    def test_reclaim_with_different_profile_pick_forced_to_original(self, env):
        """An annotations-upgrade re-claim that picks a DIFFERENT profile must land
        the clips in the SAME game (original profile) -- hash-dedup requires it --
        and the result must report that ORIGINAL profile, not the new pick, so the
        client lands on the right profile's recap."""
        game_id = _seed_sharer_dbs(env)
        # A second claimer profile the re-claim will (wrongly) try to target.
        _create_profile_db(_profile_db_path(env, CLAIMER_ID, "otherprof")).close()
        share = _make_game_link_share(game_id)

        first = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                include_annotations=False, sharer_email=SHARER_EMAIL)
        assert first["profile_id"] == CLAIMER_PROFILE

        second = claim_game_link(share, CLAIMER_ID, "otherprof",
                                 include_annotations=True, sharer_email=SHARER_EMAIL)
        # Forced back to the original profile (not the new "otherprof" pick).
        assert second["profile_id"] == CLAIMER_PROFILE
        assert second["game_id"] == first["game_id"]

        # Clips landed in the original profile; the other profile has no game.
        orig = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        other = _open(env, CLAIMER_ID, "otherprof")
        assert orig.execute("SELECT COUNT(*) c FROM raw_clips").fetchone()["c"] == 2
        assert other.execute("SELECT COUNT(*) c FROM games").fetchone()["c"] == 0
        orig.close(); other.close()

    def test_share_claim_row_recorded(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        result = claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                                 include_annotations=True, sharer_email=SHARER_EMAIL)
        from app.services.sharing_db import get_share_claim
        row = get_share_claim(share["id"], CLAIMER_ID)
        assert row is not None
        assert row["claimer_user_id"] == CLAIMER_ID
        assert row["claimer_profile_id"] == CLAIMER_PROFILE
        assert row["include_annotations"] is True
        assert row["local_game_id"] == result["game_id"]

    def test_referral_channel_game_link_attributed(self, env):
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                        include_annotations=True, sharer_email=SHARER_EMAIL)
        from app.services.pg import get_pg
        with get_pg() as pg:
            cur = pg.cursor()
            cur.execute(
                "SELECT referrer_id, channel FROM referrals WHERE referred_id=%s",
                (CLAIMER_ID,))
            row = cur.fetchone()
        assert row is not None, "a game-link claim must attribute a referral"
        assert row["referrer_id"] == SHARER_ID
        assert row["channel"] == "game_link_share"

    def test_expired_source_imports_annotations_no_fabricated_ref(self, env):
        """Source expired = the sharer has no live storage ref (get_game_storage_ref
        -> None). The claim still imports the game + annotations, but fabricates NO
        storage ref for the recipient -- source availability is resolved honestly by
        the head-object-guarded heal path (T4820), so the game shows the existing
        expired degradation rather than a faked live ref."""
        game_id = _seed_sharer_dbs(env)
        share = _make_game_link_share(game_id)
        # env's get_ref already returns None (source gone).
        claim_game_link(share, CLAIMER_ID, CLAIMER_PROFILE,
                        include_annotations=True, sharer_email=SHARER_EMAIL)
        conn = _open(env, CLAIMER_ID, CLAIMER_PROFILE)
        assert conn.execute("SELECT COUNT(*) c FROM raw_clips").fetchone()["c"] == 2
        conn.close()
        # No sharer ref -> no ref fabricated for the claimer.
        self.insert_ref.assert_not_called()


# ===========================================================================
# Endpoint contract: /api/shared/game/{token}/claim
# ===========================================================================

class TestClaimEndpoint:
    @pytest.fixture()
    def client(self, pg_conn, tmp_path):
        from app.services.auth_db import create_user
        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(CLAIMER_ID, email=CLAIMER_EMAIL)
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db._initialized_user_dbs", set()):
            from app.main import app
            yield TestClient(app, raise_server_exceptions=True)

    def _token(self, game_id=1):
        from app.services.sharing_db import create_game_share
        return create_game_share(
            game_id=game_id, tag_name=None, sharer_user_id=SHARER_ID,
            sharer_profile_id=SHARER_PROFILE, recipient_email=SHARER_EMAIL,
            game_name="vs Riverside", game_blake3="claimhash",
            share_type="game_link", game_date="2026-03-03",
        )["share_token"]

    def _headers(self):
        # X-Profile-ID present -> middleware skips session_init (no R2 for the claimer).
        return {"X-User-ID": CLAIMER_ID, "X-Profile-ID": "aaaaaaaa"}

    def test_unauthenticated_401(self, client):
        token = self._token(game_id=1)
        # No X-User-ID -> the public /api/shared prefix lets it through the
        # middleware, but the claim handler itself demands auth.
        resp = client.post(f"/api/shared/game/{token}/claim", json={})
        assert resp.status_code == 401

    def test_unknown_token_404(self, client):
        resp = client.post("/api/shared/game/nope/claim", json={},
                           headers=self._headers())
        assert resp.status_code == 404

    def test_revoked_410(self, client):
        from app.services.sharing_db import revoke_game_link_share
        token = self._token(game_id=2)
        revoke_game_link_share(2, SHARER_ID)
        resp = client.post(f"/api/shared/game/{token}/claim", json={},
                           headers=self._headers())
        assert resp.status_code == 410

    def test_multi_profile_requires_pick_400(self, client):
        token = self._token(game_id=3)
        with patch("app.services.user_db.get_profiles",
                   return_value=[{"id": "p1"}, {"id": "p2"}]):
            resp = client.post(f"/api/shared/game/{token}/claim", json={},
                               headers=self._headers())
        assert resp.status_code == 400

    def test_foreign_profile_rejected_400(self, client):
        token = self._token(game_id=4)
        with patch("app.services.user_db.get_profiles",
                   return_value=[{"id": "p1"}]):
            resp = client.post(
                f"/api/shared/game/{token}/claim",
                json={"target_profile_id": "not-mine"}, headers=self._headers())
        assert resp.status_code == 400

    def test_single_profile_happy_path(self, client):
        token = self._token(game_id=5)
        fake = {"game_id": 42, "already_claimed": False, "imported_annotations": True}
        with patch("app.services.user_db.get_profiles",
                   return_value=[{"id": "solo123"}]), \
             patch("app.services.materialization.claim_game_link",
                   return_value=fake) as mock_claim:
            resp = client.post(f"/api/shared/game/{token}/claim",
                               json={"import_annotations": True},
                               headers=self._headers())
        assert resp.status_code == 200
        body = resp.json()
        assert body["game_id"] == 42
        assert body["profile_id"] == "solo123"
        assert body["imported_annotations"] is True
        # The single profile was resolved and passed to the claim.
        _, kwargs = mock_claim.call_args
        assert kwargs["claimer_profile_id"] == "solo123"
        assert kwargs["include_annotations"] is True

    def test_explicit_profile_pick(self, client):
        token = self._token(game_id=6)
        fake = {"game_id": 7, "already_claimed": False, "imported_annotations": False}
        with patch("app.services.user_db.get_profiles",
                   return_value=[{"id": "p1"}, {"id": "p2"}]), \
             patch("app.services.materialization.claim_game_link",
                   return_value=fake) as mock_claim:
            resp = client.post(
                f"/api/shared/game/{token}/claim",
                json={"target_profile_id": "p2", "import_annotations": False},
                headers=self._headers())
        assert resp.status_code == 200
        assert resp.json()["profile_id"] == "p2"
        _, kwargs = mock_claim.call_args
        assert kwargs["claimer_profile_id"] == "p2"
