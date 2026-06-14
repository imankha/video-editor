"""
T3620: Collection share links + public viewer.

Two layers:
  1. Pure-logic (no Postgres): evaluate_collection_members / select_within_budget
     / _canonical_definition against a real profile SQLite (the `db` fixture).
     Proves live membership, scope routing, budget greedy-fit, count parity with
     list_downloads, and title/definition freezing.
  2. Endpoint (Postgres via pg_conn + TestClient): create round-trip, dedup,
     live evaluation through the resolver, revoke->410, private->403, empty->200,
     and the R2 download fallback for an evicted sharer DB.
"""

import asyncio
import sqlite3
import shutil
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.utils.encoding import encode_data
from app.services.collection_metadata import encode_game_ids

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

_next_project = [500]


def _insert_game(cur, game_id, opponent="Carlsbad", date="2025-12-06"):
    cur.execute(
        "INSERT INTO games (id, name, game_date, opponent_name, game_type) "
        "VALUES (?, ?, ?, ?, 'home')",
        (game_id, f"Game {game_id}", date, opponent),
    )


def _insert_reel(cur, *, game_ids=None, ratio="9:16", duration=10.0, tags=None,
                 name="Reel", published_at="2026-01-01 00:00:00",
                 created_at="2026-01-01 00:00:00", quality_score=5.0, clip_count=1):
    # clip_count defaults to 1 (T3630: collections are single-clip only); pass
    # clip_count=2 to seed a multi-clip (Mixes-only) reel.
    _next_project[0] += 1
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, "
        "source_type, name, aspect_ratio, tags, game_ids, quality_score, clip_count, published_at, created_at) "
        "VALUES (?, ?, 1, ?, 'custom_project', ?, ?, ?, ?, ?, ?, ?, ?)",
        (_next_project[0], f"reel{_next_project[0]}.mp4", duration, name, ratio,
         encode_data(tags) if tags else None,
         encode_game_ids(game_ids) if game_ids is not None else None,
         quality_score, clip_count, published_at, created_at),
    )
    return cur.lastrowid


# ===========================================================================
# Layer 1 -- pure logic (no Postgres)
# ===========================================================================

@pytest.fixture()
def profile_db(tmp_path):
    """A real profile SQLite (canonical schema) with context set to the sharer."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(SHARER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _conn(path):
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    return c


def _downloads(**kwargs):
    from app.routers.downloads import list_downloads
    return asyncio.run(list_downloads(**kwargs))


class TestSelectWithinBudget:
    def setup_method(self):
        from app.routers.collections import select_within_budget
        self.fn = select_within_budget

    def test_greedy_with_skip_fits_shorter_later_reel(self):
        members = [{"duration": 20.0, "id": 1}, {"duration": 50.0, "id": 2},
                   {"duration": 5.0, "id": 3}]
        out = self.fn(members, 30.0)
        # 20 fits (used 20); 50 skipped; 5 fits (used 25).
        assert [m["id"] for m in out] == [1, 3]

    def test_null_durations_excluded(self):
        members = [{"duration": None, "id": 1}, {"duration": 10.0, "id": 2}]
        out = self.fn(members, 30.0)
        assert [m["id"] for m in out] == [2]

    def test_guarantees_at_least_one_when_first_exceeds_budget(self):
        members = [{"duration": 90.0, "id": 1}, {"duration": 80.0, "id": 2}]
        out = self.fn(members, 30.0)
        assert [m["id"] for m in out] == [1]

    def test_empty_when_all_null(self):
        assert self.fn([{"duration": None, "id": 1}], 30.0) == []


class TestEvaluateMembers:
    def test_game_scope_matches_downloads_count(self, profile_db):
        with _conn(profile_db) as c:
            cur = c.cursor()
            _insert_game(cur, 12)
            _insert_reel(cur, game_ids=[12], ratio="9:16", duration=20.0)
            _insert_reel(cur, game_ids=[12], ratio="9:16", duration=15.0)
            _insert_reel(cur, game_ids=[12], ratio="16:9", duration=12.0)  # other ratio
            _insert_reel(cur, game_ids=[3, 12], ratio="9:16", duration=8.0)  # multi -> mixes
            c.commit()

        from app.routers.collections import evaluate_collection_members
        definition = {"scope": {"type": "game", "game_id": 12},
                      "filter": {}, "aspect_ratio": "9:16"}
        with _conn(profile_db) as c:
            members = evaluate_collection_members(c, definition)
        assert len(members) == 2  # two 9:16 single-game-12 reels

        dl = _downloads(game_id=12, aspect_ratio="9:16")
        assert dl.total_count == 2  # parity with list_downloads

    def test_mixes_scope(self, profile_db):
        with _conn(profile_db) as c:
            cur = c.cursor()
            _insert_reel(cur, game_ids=[1, 2], ratio="9:16", duration=10.0)  # multi
            _insert_reel(cur, game_ids=None, ratio="9:16", duration=10.0)    # game-less
            _insert_reel(cur, game_ids=[5], ratio="9:16", duration=10.0)     # single
            c.commit()
        from app.routers.collections import evaluate_collection_members
        with _conn(profile_db) as c:
            members = evaluate_collection_members(
                c, {"scope": {"type": "mixes"}, "filter": {}, "aspect_ratio": "9:16"})
        assert len(members) == 2

    def test_all_scope_with_tags_or_semantics(self, profile_db):
        with _conn(profile_db) as c:
            cur = c.cursor()
            _insert_reel(cur, game_ids=[1], ratio="9:16", tags=["Goal"])
            _insert_reel(cur, game_ids=[2], ratio="9:16", tags=["Assist"])
            _insert_reel(cur, game_ids=[3], ratio="9:16", tags=["Dribble"])
            _insert_reel(cur, game_ids=[4], ratio="16:9", tags=["Goal"])  # other ratio
            c.commit()
        from app.routers.collections import evaluate_collection_members
        with _conn(profile_db) as c:
            members = evaluate_collection_members(
                c, {"scope": {"type": "all"}, "filter": {"tags": ["Goal", "Assist"]},
                    "aspect_ratio": "9:16"})
        assert len(members) == 2  # Goal + Assist, 9:16 only

    def test_ordered_by_recency(self, profile_db):
        with _conn(profile_db) as c:
            cur = c.cursor()
            _insert_reel(cur, game_ids=[1], ratio="9:16", name="old",
                         created_at="2026-01-01 00:00:00")
            _insert_reel(cur, game_ids=[1], ratio="9:16", name="new",
                         created_at="2026-02-01 00:00:00")
            c.commit()
        from app.routers.collections import evaluate_collection_members
        with _conn(profile_db) as c:
            members = evaluate_collection_members(
                c, {"scope": {"type": "all"}, "filter": {}, "aspect_ratio": "9:16"})
        assert [m["name"] for m in members] == ["new", "old"]


class TestCanonicalDefinition:
    def test_tags_sorted_budget_and_title_folded(self):
        from app.routers.collections import _canonical_definition, CollectionDefinition
        d = CollectionDefinition(
            scope={"type": "all"}, filter={"tags": ["Goal", "Assist", "Goal"]},
            aspect_ratio="9:16", budget_sec=90.0)
        out = _canonical_definition(d, "Top Goals & Assists - Portrait (1:30)")
        assert out["filter"]["tags"] == ["Assist", "Goal"]
        assert out["budget_sec"] == 90.0
        assert out["title"] == "Top Goals & Assists - Portrait (1:30)"
        assert "game_id" not in out["scope"]

    def test_game_scope_keeps_game_id_only(self):
        from app.routers.collections import _canonical_definition, CollectionDefinition
        d = CollectionDefinition(scope={"type": "game", "game_id": 7},
                                 aspect_ratio="16:9")
        out = _canonical_definition(d, "Game 7 - Landscape")
        assert out["scope"] == {"type": "game", "game_id": 7}
        assert out["filter"] == {}
        assert "budget_sec" not in out


# ===========================================================================
# Layer 2 -- endpoints (Postgres + sharer profile DB)
# ===========================================================================

@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    """TestClient with the sharer's profile DB on disk and R2 disabled, so the
    resolver reads the local seeded DB (no real R2)."""
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False), \
         patch("app.routers.collections.generate_presigned_url_global",
               side_effect=lambda key, **kw: f"https://r2.example/{key}"), \
         patch("app.services.email.send_collection_share_email",
               new_callable=AsyncMock, return_value=True):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth(user_id):
    return {"X-User-ID": user_id}


def _seed_sharer_reels(reels):
    """Seed final_videos into the sharer's (current-context) profile DB via a raw
    connection (FK enforcement off, like the summary tests, so fake project_ids
    are allowed) and checkpoint the WAL so the read-only resolver reads a clean,
    self-contained file. `reels`: list of kwargs for _insert_reel. Returns ids."""
    from app.database import ensure_database, get_database_path
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(SHARER_ID)
    set_current_profile_id(PROFILE_ID)
    ensure_database()
    conn = sqlite3.connect(str(get_database_path()))
    conn.row_factory = sqlite3.Row
    ids = []
    try:
        cur = conn.cursor()
        for r in reels:
            ids.append(_insert_reel(cur, **r))
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    return ids


def _create(client, definition, is_public=True, emails=None):
    body = {"definition": definition, "is_public": is_public,
            "recipient_emails": emails or []}
    return client.post("/api/collections/share", json=body, headers=_auth(SHARER_ID))


GAME_DEF = {"scope": {"type": "game", "game_id": 12}, "filter": {}, "aspect_ratio": "9:16"}


class TestCreateCollectionShare:
    def test_round_trip_freezes_title_and_definition(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        resp = _create(client, GAME_DEF, is_public=True)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        token = data["shares"][0]["share_token"]
        assert "Portrait" in data["title"]

        from app.services.sharing_db import get_collection_share_by_token
        row = get_collection_share_by_token(token)
        assert row["collection_is_public"] is True
        defn = row["collection_definition"]
        assert defn["scope"] == {"type": "game", "game_id": 12}
        assert defn["aspect_ratio"] == "9:16"
        assert defn["title"] == data["title"]

    def test_dedup_same_definition_returns_existing(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        t1 = _create(client, GAME_DEF, is_public=True).json()["shares"][0]
        t2 = _create(client, GAME_DEF, is_public=True).json()["shares"][0]
        assert t1["share_token"] == t2["share_token"]
        assert t2["is_existing_link"] is True

    def test_different_budget_is_different_link(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        base = dict(GAME_DEF)
        t1 = _create(client, base, is_public=True).json()["shares"][0]["share_token"]
        t2 = _create(client, {**base, "budget_sec": 30.0},
                     is_public=True).json()["shares"][0]["share_token"]
        assert t1 != t2

    def test_empty_emails_requires_public(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        resp = _create(client, GAME_DEF, is_public=False, emails=[])
        assert resp.status_code == 400

    def test_game_scope_requires_game_id(self, client):
        resp = _create(client, {"scope": {"type": "game"}, "filter": {},
                                "aspect_ratio": "9:16"}, is_public=True)
        assert resp.status_code == 400

    def test_smart_definition_title(self, client):
        _seed_sharer_reels([{"game_ids": [1], "ratio": "9:16", "tags": ["Goal"]}])
        resp = _create(client, {"scope": {"type": "all"},
                                "filter": {"tags": ["Goal", "Assist"]},
                                "aspect_ratio": "9:16"}, is_public=True)
        assert resp.status_code == 200
        assert resp.json()["title"].startswith("Top Goals & Assists")


class TestResolveCollectionShare:
    def _public_token(self, client, definition=GAME_DEF):
        return _create(client, definition, is_public=True).json()["shares"][0]["share_token"]

    def test_public_resolve_returns_presigned_members(self, client):
        _seed_sharer_reels([
            {"game_ids": [12], "ratio": "9:16", "duration": 20.0, "name": "A"},
            {"game_ids": [12], "ratio": "9:16", "duration": 15.0, "name": "B"},
        ])
        token = self._public_token(client)
        resp = client.get(f"/api/shared/collection/{token}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["members"]) == 2
        assert all(m["presigned_url"].startswith("https://r2.example/") for m in data["members"])
        assert "Portrait" in data["title"]

    def test_live_membership_new_reel_appears(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        token = self._public_token(client)
        assert len(client.get(f"/api/shared/collection/{token}").json()["members"]) == 1
        # publish another reel for the same game+ratio AFTER the share was created
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 12.0}])
        assert len(client.get(f"/api/shared/collection/{token}").json()["members"]) == 2

    def test_budget_in_link_trims_membership(self, client):
        _seed_sharer_reels([
            {"game_ids": [12], "ratio": "9:16", "duration": 20.0,
             "created_at": "2026-02-01 00:00:00"},
            {"game_ids": [12], "ratio": "9:16", "duration": 20.0,
             "created_at": "2026-01-01 00:00:00"},
        ])
        token = self._public_token(client, {**GAME_DEF, "budget_sec": 25.0})
        members = client.get(f"/api/shared/collection/{token}").json()["members"]
        assert len(members) == 1  # only the first (newest) fits 25s

    def test_empty_membership_returns_200(self, client):
        _seed_sharer_reels([{"game_ids": [99], "ratio": "9:16", "duration": 20.0}])
        token = self._public_token(client)  # game 12 has no reels
        resp = client.get(f"/api/shared/collection/{token}")
        assert resp.status_code == 200
        assert resp.json()["members"] == []

    def test_private_wrong_and_correct_email(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        token = _create(client, GAME_DEF, is_public=False,
                        emails=[RECIPIENT_EMAIL]).json()["shares"][0]["share_token"]
        assert client.get(f"/api/shared/collection/{token}").status_code == 403
        assert client.get(f"/api/shared/collection/{token}",
                          headers=_auth(SHARER_ID)).status_code == 403
        assert client.get(f"/api/shared/collection/{token}",
                          headers=_auth(RECIPIENT_ID)).status_code == 200

    def test_revoked_returns_410(self, client):
        _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        token = self._public_token(client)
        assert client.delete(f"/api/shared/{token}",
                             headers=_auth(SHARER_ID)).status_code == 200
        assert client.get(f"/api/shared/collection/{token}").status_code == 410

    def test_not_found(self, client):
        assert client.get("/api/shared/collection/nope").status_code == 404


class TestR2FallbackForEvictedDb:
    def test_resolver_downloads_sharer_db_when_local_evicted(self, client, tmp_path):
        # Seed the sharer DB, create the share, then EVICT the local copy.
        ids = _seed_sharer_reels([{"game_ids": [12], "ratio": "9:16", "duration": 20.0}])
        token = _create(client, GAME_DEF, is_public=True).json()["shares"][0]["share_token"]

        from app.database import get_database_path
        from app.user_context import set_current_user_id
        from app.profile_context import set_current_profile_id
        set_current_user_id(SHARER_ID)
        set_current_profile_id(PROFILE_ID)
        db_path = get_database_path()
        backup = tmp_path / "r2_copy.sqlite"
        shutil.copy(db_path, backup)        # stand-in for the R2 object
        db_path.unlink()                    # evict the local cache
        for sidecar in (str(db_path) + "-wal", str(db_path) + "-shm"):
            import os
            if os.path.exists(sidecar):
                os.unlink(sidecar)

        def fake_sync(user_id, local_db_path, local_version):
            shutil.copy(backup, local_db_path)   # "download" from R2
            return True, 5, False

        # The resolver should download, then serve members -- read-only (mode=ro).
        with patch("app.storage.sync_database_from_r2_if_newer",
                   side_effect=fake_sync):
            resp = client.get(f"/api/shared/collection/{token}")
        assert resp.status_code == 200
        assert len(resp.json()["members"]) == 1
        assert ids  # sanity
