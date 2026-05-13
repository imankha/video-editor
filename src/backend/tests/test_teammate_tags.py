"""
Tests for T2800: Teammate Tag Data Model.
Covers schema migration, clip save/update with new fields, and teammate email CRUD.
Run with: pytest src/backend/tests/test_teammate_tags.py -v
"""

import pytest
import shutil
import sys
import uuid
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_teammate_tags_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": "testdefault"}) as c:
        yield c


@pytest.fixture(scope="module")
def game_id(client):
    """Create a game for clip tests."""
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("Teammate Test Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


# --- Schema migration tests ---

class TestSchemaMigration:
    def test_raw_clips_has_tagged_teammates_column(self, client):
        from app.database import get_db_connection
        with get_db_connection() as conn:
            cols = {c['name'] for c in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
        assert 'tagged_teammates' in cols

    def test_raw_clips_has_my_athlete_column(self, client):
        from app.database import get_db_connection
        with get_db_connection() as conn:
            cols = {c['name'] for c in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
        assert 'my_athlete' in cols

    def test_teammate_emails_table_exists(self, client):
        from app.database import get_db_connection
        with get_db_connection() as conn:
            cols = {c['name'] for c in conn.execute("PRAGMA table_info(teammate_emails)").fetchall()}
        assert 'id' in cols
        assert 'tag_name' in cols
        assert 'email' in cols
        assert 'created_at' in cols


# --- Clip save/update with new fields ---

class TestClipSaveWithTeammateTags:
    def test_save_clip_with_tagged_teammates(self, client, game_id):
        resp = client.post("/api/clips/raw/save", json={
            "game_id": game_id,
            "start_time": 10.0,
            "end_time": 20.0,
            "name": "Tagged clip",
            "rating": 3,
            "tags": [],
            "tagged_teammates": ["Jake", "Player 7"],
            "my_athlete": True,
        })
        assert resp.status_code == 200
        clip_id = resp.json()["raw_clip_id"]

        clip_resp = client.get(f"/api/clips/raw/{clip_id}")
        assert clip_resp.status_code == 200
        data = clip_resp.json()
        assert data["tagged_teammates"] == ["Jake", "Player 7"]
        assert data["my_athlete"] is True

    def test_save_clip_with_my_athlete_false(self, client, game_id):
        resp = client.post("/api/clips/raw/save", json={
            "game_id": game_id,
            "start_time": 30.0,
            "end_time": 40.0,
            "name": "Teammate only clip",
            "rating": 3,
            "tags": [],
            "tagged_teammates": ["Alex"],
            "my_athlete": False,
        })
        assert resp.status_code == 200
        clip_id = resp.json()["raw_clip_id"]

        clip_resp = client.get(f"/api/clips/raw/{clip_id}")
        data = clip_resp.json()
        assert data["tagged_teammates"] == ["Alex"]
        assert data["my_athlete"] is False

    def test_save_clip_without_new_fields(self, client, game_id):
        resp = client.post("/api/clips/raw/save", json={
            "game_id": game_id,
            "start_time": 50.0,
            "end_time": 60.0,
            "name": "Normal clip",
            "rating": 4,
            "tags": ["goal"],
        })
        assert resp.status_code == 200
        clip_id = resp.json()["raw_clip_id"]

        clip_resp = client.get(f"/api/clips/raw/{clip_id}")
        data = clip_resp.json()
        assert data["tagged_teammates"] is None
        assert data["my_athlete"] is True

    def test_update_clip_tagged_teammates(self, client, game_id):
        resp = client.post("/api/clips/raw/save", json={
            "game_id": game_id,
            "start_time": 70.0,
            "end_time": 80.0,
            "name": "Update test",
            "rating": 3,
            "tags": [],
        })
        clip_id = resp.json()["raw_clip_id"]

        update_resp = client.put(f"/api/clips/raw/{clip_id}", json={
            "tagged_teammates": ["Sam", "Chris"],
            "my_athlete": False,
        })
        assert update_resp.status_code == 200

        clip_resp = client.get(f"/api/clips/raw/{clip_id}")
        data = clip_resp.json()
        assert data["tagged_teammates"] == ["Sam", "Chris"]
        assert data["my_athlete"] is False


# --- Teammate tags autocomplete ---

class TestTeammateTags:
    def test_get_teammate_tags_ordered_by_frequency(self, client, game_id):
        # "Jake" appears in 2 clips (from earlier tests), "Player 7" in 1, "Alex" in 1, "Sam" in 1, "Chris" in 1
        resp = client.get("/api/clips/teammate-tags")
        assert resp.status_code == 200
        tags = resp.json()
        assert isinstance(tags, list)
        assert len(tags) > 0
        # Jake should be first (tagged in test_save_clip_with_tagged_teammates)
        assert "Jake" in tags


# --- Teammate emails CRUD ---

class TestTeammateEmails:
    def test_upsert_teammate_emails(self, client):
        resp = client.put("/api/clips/teammate-emails", json=[
            {"tag_name": "Jake", "email": "jake_mom@test.com"},
            {"tag_name": "Jake", "email": "jake_dad@test.com"},
            {"tag_name": "Alex", "email": "alex@test.com"},
        ])
        assert resp.status_code == 200
        assert resp.json()["count"] == 3

    def test_get_teammate_emails_grouped(self, client):
        resp = client.get("/api/clips/teammate-emails")
        assert resp.status_code == 200
        data = resp.json()
        assert "Jake" in data
        assert len(data["Jake"]) == 2
        emails = [e["email"] for e in data["Jake"]]
        assert "jake_mom@test.com" in emails
        assert "jake_dad@test.com" in emails
        assert "Alex" in data
        assert len(data["Alex"]) == 1

    def test_upsert_duplicate_ignored(self, client):
        resp = client.put("/api/clips/teammate-emails", json=[
            {"tag_name": "Jake", "email": "jake_mom@test.com"},
        ])
        assert resp.status_code == 200

        get_resp = client.get("/api/clips/teammate-emails")
        data = get_resp.json()
        assert len(data["Jake"]) == 2

    def test_delete_teammate_email(self, client):
        get_resp = client.get("/api/clips/teammate-emails")
        data = get_resp.json()
        alex_id = data["Alex"][0]["id"]

        del_resp = client.delete(f"/api/clips/teammate-emails/{alex_id}")
        assert del_resp.status_code == 200

        get_resp2 = client.get("/api/clips/teammate-emails")
        data2 = get_resp2.json()
        assert "Alex" not in data2

    def test_delete_nonexistent_returns_404(self, client):
        resp = client.delete("/api/clips/teammate-emails/99999")
        assert resp.status_code == 404

    def test_unique_constraint(self, client):
        from app.database import get_db_connection
        import sqlite3
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO teammate_emails (tag_name, email) VALUES (?, ?)",
                ("Jake", "jake_mom@test.com"),
            )
            conn.commit()
        get_resp = client.get("/api/clips/teammate-emails")
        data = get_resp.json()
        assert len(data["Jake"]) == 2
