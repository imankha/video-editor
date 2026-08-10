"""
T6700 -- owner in-app playback intro: two new thin per-PLAY GET endpoints
(design §5.1, §7):

  - GET /api/downloads/{id}/intro-playback   -- single reel's OWN resolved
    intro, LIVE, via resolve_intro_for_reel(mode="playback") over the
    AMBIENT connection (never open_profile_db_readonly -- §2.2, owner path
    is same-account).
  - GET /api/collections/intro-playback      -- the COLLECTION's OWN
    resolved intro (not any member reel's), against LIVE total duration,
    serialized via the SAME build_intro_playback_payload (§5.1 row 2).

Both are non-fatal: HTTP 200 ALWAYS, `{"intro": null}` for every "nothing to
show" case (opted out via 0, NULL with no default, forced resolve failure,
no stored/inherited collection card, duration gate blocks it) -- NEVER a
4xx/5xx for "no intro" (§5.1's "Non-fatal contract").

Neither route exists yet as of this session (Stage 3, pre-implementation) --
`routers/downloads.py` has no `/{download_id}/intro-playback` GET and
`routers/collections.py` has no `/intro-playback` GET. FastAPI's router
returns a genuine 404 for an unmatched path, so every test in this file is
RED because the route doesn't exist, not because of a broken fixture/import
-- confirmed by running this file before Stage 4 implementation.

Mirrors `test_t5220_share_download.py`'s TestClient-over-real-app pattern
(a real 404-until-implemented route) and `test_t5215_collection_intro.py` /
`test_t5215_intro_attachment.py`'s tmp_path SQLite seeding (no Postgres
needed here -- these are same-account owner reads, no sharing/auth-db
involvement).
"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t6700-owner"
PROFILE_ID = "t6700prof"


@pytest.fixture()
def client(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()

        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers() -> dict:
    return {"X-User-ID": USER_ID}


def _db_path(tmp_path):
    # Mirrors test_t5215_intro_attachment.py's get_database_path() usage,
    # but tests here just need the same tmp_path root the fixture patched.
    from app.database import get_database_path
    return get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_card(db_path, name="Hero Card", is_default=0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
        "VALUES (?, '[]', 'gold', ?)",
        (name, is_default),
    )
    card_id = cur.lastrowid
    conn.commit()
    conn.close()
    return card_id


def _seed_published_final(db_path, intro_card_id=None, duration=30.0, aspect_ratio="9:16"):
    """A minimal published final_videos row (project + final, pointers wired) --
    same shape as test_t5215_intro_attachment.py's helper."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', ?)", (aspect_ratio,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, intro_card_id) "
        "VALUES (?, 'f.mp4', 1, 'custom_project', 'Reel', ?, ?, CURRENT_TIMESTAMP, ?)",
        (project_id, duration, aspect_ratio, intro_card_id),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id


def _seed_published_final_for_collection(db_path, *, game_ids=None, duration=30.0,
                                          aspect_ratio="9:16", clip_count=1, tags=None):
    """Mirrors test_t5215_collection_intro.py's helper -- a member reel for the
    COLLECTION resolver (game_ids/tags scoping), distinct from the single-reel
    helper above (which never sets game_ids/tags)."""
    from app.utils.encoding import encode_data
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', ?)", (aspect_ratio,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, clip_count, game_ids, tags) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)",
        (project_id, f"f{project_id}.mp4", duration, aspect_ratio, clip_count,
         encode_data(game_ids) if game_ids is not None else None,
         encode_data(tags) if tags else None),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id


# ===========================================================================
# 1. Single reel: GET /api/downloads/{id}/intro-playback
# ===========================================================================

class TestSingleReelIntroPlayback:
    def test_happy_path_returns_full_playback_payload(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        card_id = _seed_card(db_path, "Hero Card")
        fv_id = _seed_published_final(db_path, intro_card_id=card_id, duration=30.0)

        resp = client.get(f"/api/downloads/{fv_id}/intro-playback", headers=_auth_headers())

        assert resp.status_code == 200
        body = resp.json()
        assert body["intro"] is not None
        intro = body["intro"]
        assert set(intro.keys()) >= {"card", "previewUrl", "field_values", "profile"}
        # Proves the _card_payload path (decoded), not a raw SELECT * --
        # shown_fields must be a real list, not a JSON string.
        assert isinstance(intro["card"]["shown_fields"], list)
        assert isinstance(intro["card"]["text_elements"], dict)
        assert intro["card"]["id"] == card_id

    def test_opted_out_zero_returns_null_intro_200(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        _seed_card(db_path, "Hero Card", is_default=1)
        fv_id = _seed_published_final(db_path, intro_card_id=0, duration=999.0)

        resp = client.get(f"/api/downloads/{fv_id}/intro-playback", headers=_auth_headers())

        assert resp.status_code == 200
        assert resp.json() == {"intro": None}

    def test_null_with_no_default_returns_null_intro_200(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        # No default card seeded at all -- NULL/inherit resolves to nothing.
        fv_id = _seed_published_final(db_path, intro_card_id=None, duration=30.0)

        resp = client.get(f"/api/downloads/{fv_id}/intro-playback", headers=_auth_headers())

        assert resp.status_code == 200
        assert resp.json() == {"intro": None}

    def test_forced_resolve_failure_returns_null_intro_200_never_5xx(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        card_id = _seed_card(db_path, "Hero Card")
        fv_id = _seed_published_final(db_path, intro_card_id=card_id, duration=30.0)

        with patch(
            "app.services.intro_egress.resolve_intro_card",
            side_effect=RuntimeError("forced failure"),
        ):
            resp = client.get(f"/api/downloads/{fv_id}/intro-playback", headers=_auth_headers())

        assert resp.status_code == 200, "must never surface a 4xx/5xx for 'no intro'"
        assert resp.json() == {"intro": None}

    def test_ambient_connection_used_not_open_profile_db_readonly(self, client, tmp_path):
        """Owner path is same-account (§2.2) -- the single-reel endpoint must
        resolve via the ambient request connection, never the cross-profile
        `open_profile_db_readonly` the SHARE paths need."""
        db_path = _db_path(tmp_path)
        card_id = _seed_card(db_path, "Hero Card")
        fv_id = _seed_published_final(db_path, intro_card_id=card_id, duration=30.0)

        with patch(
            "app.services.materialization.open_profile_db_readonly",
        ) as mock_readonly:
            resp = client.get(f"/api/downloads/{fv_id}/intro-playback", headers=_auth_headers())

        assert resp.status_code == 200
        mock_readonly.assert_not_called()


# ===========================================================================
# 2. Collection: GET /api/collections/intro-playback
# ===========================================================================

class TestCollectionIntroPlayback:
    def test_happy_path_resolves_collections_own_card_against_live_duration(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        card_id = _seed_card(db_path, "Collection Card")
        # Two members long enough to clear the default duration gate --
        # proves LIVE total duration drives resolution, not a member's own.
        _seed_published_final_for_collection(db_path, game_ids=[9], duration=15.0, clip_count=1)
        _seed_published_final_for_collection(db_path, game_ids=[9], duration=15.0, clip_count=1)

        from app.services.intro_cards import (
            collection_intro_settings_key,
            set_collection_intro_card_id,
        )
        conn = _connect(db_path)
        key = collection_intro_settings_key("game", game_id=9, aspect_ratio="9:16")
        cur = conn.cursor()
        set_collection_intro_card_id(cur, key, card_id)
        conn.commit()
        conn.close()

        resp = client.get(
            "/api/collections/intro-playback",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["intro"] is not None
        intro = body["intro"]
        assert intro["card"]["id"] == card_id, "must resolve the COLLECTION's own card"
        assert set(intro.keys()) >= {"card", "previewUrl", "field_values", "profile"}

    def test_no_stored_or_inherited_card_returns_null_intro_200(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        # No card attached to this scope at all, no default card seeded.
        _seed_published_final_for_collection(db_path, game_ids=[11], duration=30.0, clip_count=1)

        resp = client.get(
            "/api/collections/intro-playback",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 11},
            headers=_auth_headers(),
        )

        assert resp.status_code == 200
        assert resp.json() == {"intro": None}

    def test_duration_gate_blocks_inherited_default_returns_null_intro_200(self, client, tmp_path):
        db_path = _db_path(tmp_path)
        _seed_card(db_path, "Default Card", is_default=1)
        # Single short member well under the default threshold -- inherit
        # path must NOT resolve.
        _seed_published_final_for_collection(db_path, game_ids=[12], duration=5.0, clip_count=1)

        resp = client.get(
            "/api/collections/intro-playback",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 12},
            headers=_auth_headers(),
        )

        assert resp.status_code == 200
        assert resp.json() == {"intro": None}
