"""T10300: Link a directly uploaded clip to a game later (design:
docs/plans/tasks/T10300-design.md).

Phase 1 (Tester, pre-implementation) — written BEFORE the feature exists, per the
project's test-first rule. Expected to FAIL now (404 on the new link endpoint,
missing `source` column, idempotency keyed on game_id, cascade deletes the upload
clip) and to turn green once the Implementor lands the design.

Covers the four design decisions:
  - D1 `raw_clips.source` discriminator + attribution-only link (no timeline pos)
  - D2 idempotency keyed on `filename AND source='upload'` (survives link/unlink)
  - D3 game delete UNLINKS an upload clip (keeps it) while CASCADING game-cut clips
  - D4 POST /api/clips/raw/{id}/link {game_id|null} surgical gesture + guards
  - collection_metadata attributes a linked upload clip's project to the game

Run with: pytest src/backend/tests/test_t10300_link_uploaded_clip.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE, get_db_connection

TEST_USER_ID = f"test_t10300_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


@pytest.fixture(autouse=True)
def _pg_user(pg_conn):
    """Register TEST_USER_ID + grant enough credits for the upload debit."""
    from app.analytics import create_user_segment
    from app.services.auth_db import create_user
    from app.services.credit_ledger import grant_credits
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE user_id = %s", (TEST_USER_ID,))
        already_exists = cur.fetchone() is not None
    if not already_exists:
        create_user(TEST_USER_ID, email=f"{TEST_USER_ID}@test.com")
        create_user_segment(TEST_USER_ID, "organic", None, "otp")
        grant_credits(TEST_USER_ID, 100, "admin_grant", reference_id=f"t10300-seed-{TEST_USER_ID}")
    yield


def _fake_head(size_bytes: int):
    return {"ContentLength": size_bytes}


def _fake_probe(duration: float, width: int = 1080, height: int = 1920, fps: float = 30.0):
    return {"duration": duration, "width": width, "height": height, "fps": fps}


def _upload_one(client, monkeypatch, *, duration=9.0, size=10 * 1024 * 1024):
    """Drive POST /api/clips/upload for a single fresh clip; return its result dict."""
    blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
    monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(size))
    monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(duration))
    resp = client.post("/api/clips/upload", json={
        "items": [{"blake3_hash": blake3_hash, "file_size": size, "original_filename": "up.mp4"}],
    })
    assert resp.status_code == 200, resp.text
    result = resp.json()["results"][0]
    assert result["ok"] is True, result
    result["blake3_hash"] = blake3_hash
    return result


def _make_game(name="Linked Game"):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            (name, f"g_{uuid.uuid4().hex[:32]}"),
        )
        conn.commit()
        return cursor.lastrowid


# ---------------------------------------------------------------------------
# D1: source discriminator + attribution-only link
# ---------------------------------------------------------------------------

class TestSourceDiscriminator:
    def test_uploaded_clip_has_source_upload(self, monkeypatch):
        with _client() as client:
            r = _upload_one(client, monkeypatch)
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT source, game_id FROM raw_clips WHERE id = ?", (r["raw_clip_id"],))
            row = cur.fetchone()
        assert row["source"] == "upload"
        assert row["game_id"] is None

    def test_link_sets_game_id_but_keeps_own_source_span(self, monkeypatch):
        """Attribution only: game_id is set, but the clip keeps its OWN source span
        (start_time=0, end_time=duration, video_sequence NULL) — no fake timeline pos."""
        game_id = _make_game()
        with _client() as client:
            r = _upload_one(client, monkeypatch, duration=9.0)
            resp = client.post(f"/api/clips/raw/{r['raw_clip_id']}/link", json={"game_id": game_id})
            assert resp.status_code == 200, resp.text
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT game_id, source, start_time, end_time, video_sequence "
                "FROM raw_clips WHERE id = ?", (r["raw_clip_id"],))
            row = cur.fetchone()
        assert row["game_id"] == game_id
        assert row["source"] == "upload"
        assert row["start_time"] == 0
        assert row["end_time"] == 9.0
        assert row["video_sequence"] is None

    def test_response_exposes_source(self, monkeypatch):
        """RawClipResponse must carry `source` so the FE can gate link/unlink."""
        game_id = _make_game()
        with _client() as client:
            r = _upload_one(client, monkeypatch)
            client.post(f"/api/clips/raw/{r['raw_clip_id']}/link", json={"game_id": game_id})
            resp = client.get(f"/api/clips/raw/{r['raw_clip_id']}")
            assert resp.status_code == 200, resp.text
            clip = resp.json()
        assert clip.get("source") == "upload", clip


# ---------------------------------------------------------------------------
# D2: idempotency survives link / unlink
# ---------------------------------------------------------------------------

class TestIdempotencyAfterLink:
    def test_reupload_after_link_is_idempotent_no_new_row_no_recharge(self, monkeypatch):
        game_id = _make_game()
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        size = 10 * 1024 * 1024
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(size))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(9.0))
        payload = {"items": [{"blake3_hash": blake3_hash, "file_size": size, "original_filename": "up.mp4"}]}

        from app.services.credit_ledger import get_credit_balance
        with _client() as client:
            first = client.post("/api/clips/upload", json=payload)
            assert first.status_code == 200, first.text
            raw_clip_id = first.json()["results"][0]["raw_clip_id"]

            # Link it to a game — the mutable game_id predicate would now MISS it.
            link = client.post(f"/api/clips/raw/{raw_clip_id}/link", json={"game_id": game_id})
            assert link.status_code == 200, link.text

            balance_before_reupload = get_credit_balance(TEST_USER_ID)["balance"]
            second = client.post("/api/clips/upload", json=payload)
            assert second.status_code == 200, second.text
            balance_after = get_credit_balance(TEST_USER_ID)["balance"]

        assert second.json()["results"][0]["raw_clip_id"] == raw_clip_id, \
            "re-upload after linking must find the SAME row, not create a duplicate"
        assert balance_after == balance_before_reupload, "re-upload after link must not re-charge"

    def test_reupload_after_unlink_is_still_idempotent(self, monkeypatch):
        game_id = _make_game()
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        size = 8 * 1024 * 1024
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(size))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(7.0))
        payload = {"items": [{"blake3_hash": blake3_hash, "file_size": size, "original_filename": "up.mp4"}]}

        with _client() as client:
            raw_clip_id = client.post("/api/clips/upload", json=payload).json()["results"][0]["raw_clip_id"]
            client.post(f"/api/clips/raw/{raw_clip_id}/link", json={"game_id": game_id})
            unlink = client.post(f"/api/clips/raw/{raw_clip_id}/link", json={"game_id": None})
            assert unlink.status_code == 200, unlink.text
            second = client.post("/api/clips/upload", json=payload)

        assert second.json()["results"][0]["raw_clip_id"] == raw_clip_id
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT game_id FROM raw_clips WHERE id = ?", (raw_clip_id,))
            assert cur.fetchone()["game_id"] is None, "unlink must clear game_id"


# ---------------------------------------------------------------------------
# D3: game delete UNLINKS upload clips, CASCADES game-cut clips
# ---------------------------------------------------------------------------

class TestGameDeleteUnlinksUploadClip:
    def test_delete_game_keeps_upload_clip_unlinked_but_cascades_game_cut(self, monkeypatch):
        game_id = _make_game()
        with _client() as client:
            up = _upload_one(client, monkeypatch)
            up_id = up["raw_clip_id"]
            client.post(f"/api/clips/raw/{up_id}/link", json={"game_id": game_id})

            # A genuine game-cut clip (source='game') in the same game.
            with get_db_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time, source) "
                    "VALUES (?, ?, ?, ?, ?, 'game')",
                    (f"cut_{uuid.uuid4().hex[:8]}.mp4", 4, game_id, 10.0, 20.0),
                )
                cut_id = cur.lastrowid
                conn.commit()

            resp = client.delete(f"/api/games/{game_id}")
            assert resp.status_code == 200, resp.text

        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT game_id, source FROM raw_clips WHERE id = ?", (up_id,))
            up_row = cur.fetchone()
            cur.execute("SELECT 1 FROM raw_clips WHERE id = ?", (cut_id,))
            cut_row = cur.fetchone()

        assert up_row is not None, "upload clip must SURVIVE game deletion"
        assert up_row["game_id"] is None, "upload clip must be UNLINKED, not deleted"
        assert cut_row is None, "game-cut clip must still CASCADE-delete with the game"


# ---------------------------------------------------------------------------
# collection_metadata: a linked upload clip attributes its project to the game
# ---------------------------------------------------------------------------

class TestProjectAttribution:
    def test_linked_upload_clip_project_resolves_the_game(self, monkeypatch):
        from app.services.collection_metadata import compute_project_game_ids
        from app.utils.encoding import decode_data
        game_id = _make_game()
        with _client() as client:
            up = _upload_one(client, monkeypatch)
            client.post(f"/api/clips/raw/{up['raw_clip_id']}/link", json={"game_id": game_id})
        project_id = up["project_id"]
        with get_db_connection() as conn:
            cur = conn.cursor()
            blob = compute_project_game_ids(cur, project_id)
        assert game_id in (decode_data(blob) or []), \
            "linked upload clip's project must resolve to the game via game_ids[]"

    def test_projects_list_exposes_source_and_game_names(self, monkeypatch):
        """The Clips-tab tile gates the link/unlink affordance on
        `project.clips[0].source` and labels Unlink with `project.game_names[0]`.
        Verify the /api/projects JSON actually surfaces both (the contract the
        frontend reads), before and after a link."""
        game_id = _make_game("vs Rockets")
        with _client() as client:
            up = _upload_one(client, monkeypatch)
            project_id = up["project_id"]

            def _project(resp):
                assert resp.status_code == 200, resp.text
                return next(p for p in resp.json() if p["id"] == project_id)

            # Before link: source='upload' surfaced, no game attribution yet.
            proj = _project(client.get("/api/projects"))
            assert proj["clips"], "auto-project must carry its upload clip"
            assert proj["clips"][0]["source"] == "upload"
            assert proj["clips"][0]["id"] == up["raw_clip_id"], \
                "clips[0].id is the raw_clip_id the link gesture posts to"
            assert proj["game_ids"] == []

            # After link: game_ids + game_names populate for the Unlink label.
            client.post(f"/api/clips/raw/{up['raw_clip_id']}/link", json={"game_id": game_id})
            proj = _project(client.get("/api/projects"))
            assert game_id in proj["game_ids"]
            assert "vs Rockets" in proj["game_names"]
            assert proj["clips"][0]["source"] == "upload"


# ---------------------------------------------------------------------------
# D1/D2 corollary: game-cut natural key must not match a linked upload clip
# ---------------------------------------------------------------------------

class TestNaturalKeyIsolation:
    def test_annotate_cut_with_same_end_time_creates_new_row(self, monkeypatch):
        """An upload clip linked to a game has end_time=duration, video_sequence NULL.
        An annotate save whose cut ends at that same time (no video_sequence) must
        create a NEW row, not UPDATE the linked upload clip."""
        game_id = _make_game()
        with _client() as client:
            up = _upload_one(client, monkeypatch, duration=9.0)
            up_id = up["raw_clip_id"]
            client.post(f"/api/clips/raw/{up_id}/link", json={"game_id": game_id})

            # Annotate save into the same game, ending at the SAME time (9.0), no seq.
            resp = client.post("/api/clips/raw/save", json={
                "game_id": game_id,
                "start_time": 3.0,
                "end_time": 9.0,
                "name": "a play",
                "rating": 4,
            })
            assert resp.status_code == 200, resp.text
            new_id = resp.json()["raw_clip_id"]

        assert new_id != up_id, \
            "annotate cut must NOT be routed onto the linked upload clip's row"
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT source, game_id FROM raw_clips WHERE id = ?", (new_id,))
            row = cur.fetchone()
            # The upload clip must be untouched (still its own span).
            cur.execute("SELECT source, start_time, end_time FROM raw_clips WHERE id = ?", (up_id,))
            up_row = cur.fetchone()
        assert row["source"] == "game"
        assert up_row["source"] == "upload"
        assert up_row["start_time"] == 0 and up_row["end_time"] == 9.0


# ---------------------------------------------------------------------------
# D4: link endpoint guards
# ---------------------------------------------------------------------------

class TestLinkEndpointGuards:
    def test_link_to_nonexistent_game_404(self, monkeypatch):
        with _client() as client:
            up = _upload_one(client, monkeypatch)
            resp = client.post(f"/api/clips/raw/{up['raw_clip_id']}/link", json={"game_id": 99999999})
        assert resp.status_code == 404, resp.text

    def test_link_nonexistent_clip_404(self):
        game_id = _make_game()
        with _client() as client:
            resp = client.post("/api/clips/raw/88888888/link", json={"game_id": game_id})
        assert resp.status_code == 404, resp.text

    def test_cannot_relink_a_game_cut_clip(self):
        """source='game' clips are never re-attributed through this gesture."""
        game_a = _make_game("A")
        game_b = _make_game("B")
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time, source) "
                "VALUES (?, ?, ?, ?, ?, 'game')",
                (f"cut_{uuid.uuid4().hex[:8]}.mp4", 5, game_a, 0.0, 5.0),
            )
            cut_id = cur.lastrowid
            conn.commit()
        with _client() as client:
            resp = client.post(f"/api/clips/raw/{cut_id}/link", json={"game_id": game_b})
        assert resp.status_code in (400, 409), resp.text
