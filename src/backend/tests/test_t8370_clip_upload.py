"""T8370: Pre-cut clip upload support (design: docs/plans/tasks/T8370-design.md).

Phase 1 (Tester, pre-implementation) — these tests are written BEFORE any of the
feature exists, per the project's test-first rule. They are expected to FAIL right
now (404 / AttributeError / ImportError), not pass, and should turn green only once
the Implementor ships Slices A-D of the design.

Covers (design §5 "Test plan", §2.1 invariants INV-U1..INV-U5):
  - POST /api/clips/upload (Slice B): batch clip creation, idempotency, one-charge
    pricing, size cap
  - INV-U3 guard: no games row / quest step / game_created / game_upload_succeeded
  - INV-U2 guard: no game_storage / game_storage_refs row for a clip-source hash
  - D4 fix: finalize_upload(kind='clip') does not emit game_upload_succeeded
  - Guarded write: prepare_upload(kind='clip') on a below-v050 DB returns 503
  - D3 guard: two same-duration clips in one batch produce two distinct drafts

Run with: pytest src/backend/tests/test_t8370_clip_upload.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE, get_db_connection
from app.services.storage_credits import AUTO_EXPORT_SURCHARGE, calculate_storage_cost

TEST_USER_ID = f"test_t8370_{uuid.uuid4().hex[:8]}"
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
def _r2_guard_enabled(monkeypatch):
    """Mirror test_t7970's approach: flip the router's own R2_ENABLED copy True so
    kind='clip' validation branches are reachable without a real R2 round trip."""
    monkeypatch.setattr("app.routers.games_upload.R2_ENABLED", True, raising=False)
    yield


@pytest.fixture(autouse=True)
def _pg_user(pg_conn):
    """Register TEST_USER_ID + grant enough credits for batch-cost assertions."""
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
        grant_credits(TEST_USER_ID, 100, "admin_grant", reference_id=f"t8370-seed-{TEST_USER_ID}")
    yield


def _fake_head(size_bytes: int):
    return {"ContentLength": size_bytes}


def _fake_probe(duration: float, width: int = 1080, height: int = 1920, fps: float = 30.0):
    return {"duration": duration, "width": width, "height": height, "fps": fps}


# ---------------------------------------------------------------------------
# Slice B: POST /api/clips/upload — batch clip creation
# ---------------------------------------------------------------------------

class TestBatchClipUpload:
    def test_batch_upload_creates_raw_clip_with_full_range_and_auto_project(self, monkeypatch):
        """INV-U4/INV-U5, closes D1: a clip-source upload creates ONE raw_clips row
        with game_id NULL, start_time=0, end_time=probed duration, PLUS one
        auto-created 9:16 project — not the D1 NULL/NULL bug."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(20 * 1024 * 1024))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(14.5))

        with _client() as client:
            resp = client.post("/api/clips/upload", json={
                "items": [{
                    "blake3_hash": blake3_hash,
                    "file_size": 20 * 1024 * 1024,
                    "original_filename": "sideline_clip.mp4",
                }],
            })

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["results"]) == 1
        result = body["results"][0]
        assert result["ok"] is True
        raw_clip_id = result["raw_clip_id"]

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT game_id, start_time, end_time, auto_project_id FROM raw_clips WHERE id = ?",
                (raw_clip_id,),
            )
            row = cursor.fetchone()

        assert row is not None
        assert row["game_id"] is None
        assert row["start_time"] == 0
        assert row["end_time"] == pytest.approx(14.5)
        assert row["auto_project_id"] is not None

    def test_reposting_same_batch_is_idempotent_same_ids_charged_once(self, monkeypatch):
        """Re-posting the SAME batch (same accepted hash set) returns the same
        raw_clip/project ids and does not charge a second time."""
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(10 * 1024 * 1024))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(9.0))

        payload = {
            "items": [{
                "blake3_hash": blake3_hash,
                "file_size": 10 * 1024 * 1024,
                "original_filename": "clip.mp4",
            }],
        }

        with _client() as client:
            from app.services.credit_ledger import get_credit_balance
            balance_before = get_credit_balance(TEST_USER_ID)["balance"]

            first = client.post("/api/clips/upload", json=payload)
            assert first.status_code == 200, first.text
            first_body = first.json()

            balance_after_first = get_credit_balance(TEST_USER_ID)["balance"]
            assert balance_after_first < balance_before, "batch should charge exactly once"

            second = client.post("/api/clips/upload", json=payload)
            assert second.status_code == 200, second.text
            second_body = second.json()

            balance_after_second = get_credit_balance(TEST_USER_ID)["balance"]

        assert first_body["results"][0]["raw_clip_id"] == second_body["results"][0]["raw_clip_id"]
        assert first_body["results"][0]["project_id"] == second_body["results"][0]["project_id"]
        assert balance_after_second == balance_after_first, "re-post must not charge a second time"

    def test_partial_then_full_retry_never_recharges_the_already_landed_item(self, monkeypatch):
        """Reviewer-caught bug: batch [A,B] where A lands first (B fails
        source_missing on this call), then a LATER retry of [A,B] lands B too.
        A is now `already_existing` on the retry — it must NOT be folded into
        the retry's charge/reference_id (that would compute a NEW idempotency
        key covering A+B and re-charge the already-paid-for A)."""
        from app.services.credit_ledger import get_credit_balance

        hash_a = uuid.uuid4().hex + uuid.uuid4().hex
        hash_b = uuid.uuid4().hex + uuid.uuid4().hex
        size_a, size_b = 6 * 1024 * 1024, 7 * 1024 * 1024

        def _head_only_a(user_id, key):
            h = key.split("/")[-1].removesuffix(".mp4")
            return _fake_head(size_a) if h == hash_a else None

        def _head_both(user_id, key):
            h = key.split("/")[-1].removesuffix(".mp4")
            if h == hash_a:
                return _fake_head(size_a)
            if h == hash_b:
                return _fake_head(size_b)
            return None

        payload = {
            "items": [
                {"blake3_hash": hash_a, "file_size": size_a, "original_filename": "a.mp4"},
                {"blake3_hash": hash_b, "file_size": size_b, "original_filename": "b.mp4"},
            ],
        }

        with _client() as client:
            balance_before = get_credit_balance(TEST_USER_ID)["balance"]

            # First call: only A's bytes are durable in R2 yet -> B fails source_missing.
            monkeypatch.setattr("app.routers.clips.r2_head_object", _head_only_a)
            monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(5.0))
            first = client.post("/api/clips/upload", json=payload)
            assert first.status_code == 200, first.text
            first_results = {r["blake3_hash"]: r for r in first.json()["results"]}
            assert first_results[hash_a]["ok"] is True
            assert first_results[hash_b]["ok"] is False

            balance_after_first = get_credit_balance(TEST_USER_ID)["balance"]
            expected_a_cost = calculate_storage_cost(size_a)
            assert balance_before - balance_after_first == expected_a_cost

            # B's bytes land later; client retries the SAME batch. A is now
            # already_existing -- must be excluded from this call's charge.
            monkeypatch.setattr("app.routers.clips.r2_head_object", _head_both)
            second = client.post("/api/clips/upload", json=payload)
            assert second.status_code == 200, second.text
            second_results = {r["blake3_hash"]: r for r in second.json()["results"]}
            assert second_results[hash_a]["ok"] is True
            assert second_results[hash_b]["ok"] is True
            assert second_results[hash_a]["raw_clip_id"] == first_results[hash_a]["raw_clip_id"]

            balance_after_second = get_credit_balance(TEST_USER_ID)["balance"]
            expected_b_cost = calculate_storage_cost(size_b)

        assert second.json()["charged"] == expected_b_cost, (
            "the retry must charge for B ONLY, never re-including already-landed A"
        )
        assert balance_after_first - balance_after_second == expected_b_cost, (
            "A must not be charged a second time on the partial-then-full retry"
        )

    def test_batch_of_five_debits_summed_bytes_cost_once_no_surcharge(self, monkeypatch):
        """§4.2: one charge per gesture on SUMMED bytes, no AUTO_EXPORT_SURCHARGE
        (clip sources never expire, INV-U2 — nothing to prepay an auto-export for)."""
        sizes = [5 * 1024 * 1024] * 5
        hashes = [uuid.uuid4().hex + uuid.uuid4().hex for _ in sizes]

        monkeypatch.setattr(
            "app.routers.clips.r2_head_object",
            lambda user_id, key: _fake_head(sizes[hashes.index(key.split("/")[-1].removesuffix(".mp4"))])
            if key.split("/")[-1].removesuffix(".mp4") in hashes else None,
        )
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(10.0))

        expected_cost = calculate_storage_cost(sum(sizes))  # NO + AUTO_EXPORT_SURCHARGE

        with _client() as client:
            from app.services.credit_ledger import get_credit_balance
            balance_before = get_credit_balance(TEST_USER_ID)["balance"]

            resp = client.post("/api/clips/upload", json={
                "items": [
                    {"blake3_hash": h, "file_size": s, "original_filename": f"clip{i}.mp4"}
                    for i, (h, s) in enumerate(zip(hashes, sizes))
                ],
            })

            balance_after = get_credit_balance(TEST_USER_ID)["balance"]

        assert resp.status_code == 200, resp.text
        assert resp.json()["charged"] == expected_cost
        assert balance_before - balance_after == expected_cost
        # Sanity: the surcharged formula would have been strictly larger.
        assert expected_cost < expected_cost + AUTO_EXPORT_SURCHARGE

    def test_file_over_max_clip_upload_bytes_refused_at_prepare_with_400(self, monkeypatch):
        """§4.3: MAX_CLIP_UPLOAD_BYTES cap enforced at prepare-upload time for
        kind='clip', not silently truncated."""
        monkeypatch.setattr("app.storage.r2_head_object_global", lambda key: None)

        oversized = 500 * 1024 * 1024 + 1  # over the proposed 500MB cap

        with _client() as client:
            resp = client.post("/api/games/prepare-upload", json={
                "blake3_hash": uuid.uuid4().hex + uuid.uuid4().hex,
                "file_size": oversized,
                "original_filename": "huge_clip.mp4",
                "kind": "clip",
            })

        assert resp.status_code == 400, resp.text

    def test_d3_identical_duration_clips_in_one_batch_produce_distinct_drafts(self, monkeypatch):
        """D3 guard: two clips of IDENTICAL duration in one batch must not collapse
        under latest_working_clips_subquery's COALESCE(rc.end_time, wc.uploaded_filename)
        partition key — each upload gets its OWN auto-project/draft (INV-U5), so the
        same-end_time collision described in D3 is structurally unreachable here."""
        same_duration = 12.0
        hash_a = uuid.uuid4().hex + uuid.uuid4().hex
        hash_b = uuid.uuid4().hex + uuid.uuid4().hex
        sizes = {hash_a: 8 * 1024 * 1024, hash_b: 9 * 1024 * 1024}

        def _head(user_id, key):
            h = key.split("/")[-1].removesuffix(".mp4")
            return _fake_head(sizes[h]) if h in sizes else None

        monkeypatch.setattr("app.routers.clips.r2_head_object", _head)
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(same_duration))

        with _client() as client:
            resp = client.post("/api/clips/upload", json={
                "items": [
                    {"blake3_hash": hash_a, "file_size": sizes[hash_a], "original_filename": "a.mp4"},
                    {"blake3_hash": hash_b, "file_size": sizes[hash_b], "original_filename": "b.mp4"},
                ],
            })

        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        assert len(results) == 2
        assert results[0]["ok"] and results[1]["ok"]
        assert results[0]["raw_clip_id"] != results[1]["raw_clip_id"]
        assert results[0]["project_id"] != results[1]["project_id"], (
            "two same-duration clips must not collapse onto one draft (D3)"
        )


# ---------------------------------------------------------------------------
# INV-U3 guard: no games row, no quest step, no game_created/game_upload_succeeded
# ---------------------------------------------------------------------------

class TestInvU3NoGameSurface:
    def test_clip_upload_creates_no_games_row_and_leaves_upload_game_quest_incomplete(self, monkeypatch):
        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(6 * 1024 * 1024))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(8.0))

        with _client() as client:
            upload_resp = client.post("/api/clips/upload", json={
                "items": [{
                    "blake3_hash": blake3_hash,
                    "file_size": 6 * 1024 * 1024,
                    "original_filename": "clip.mp4",
                }],
            })
            assert upload_resp.status_code == 200, upload_resp.text

            games_resp = client.get("/api/games")
            assert games_resp.status_code == 200
            assert games_resp.json()["games"] == []

            quests_resp = client.get("/api/quests/progress")
            assert quests_resp.status_code == 200
            steps = quests_resp.json().get("steps", quests_resp.json())
            # Whatever shape /progress returns, upload_game must not read complete
            # off the back of a clip upload.
            assert steps.get("upload_game") is not True

    def test_clip_upload_records_no_game_created_or_game_upload_succeeded_milestones(self, monkeypatch, pg_conn):
        from app.services.pg import get_pg

        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(6 * 1024 * 1024))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(8.0))

        with _client() as client:
            resp = client.post("/api/clips/upload", json={
                "items": [{
                    "blake3_hash": blake3_hash,
                    "file_size": 6 * 1024 * 1024,
                    "original_filename": "clip.mp4",
                }],
            })
            assert resp.status_code == 200, resp.text

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action FROM user_actions WHERE user_id = %s AND action IN (%s, %s)",
                (TEST_USER_ID, "game_created", "game_upload_succeeded"),
            )
            rows = cur.fetchall()

        assert rows == [], f"clip upload must never emit game_created/game_upload_succeeded, got {rows}"


# ---------------------------------------------------------------------------
# INV-U2 guard: never enters game_storage / game_storage_refs
# ---------------------------------------------------------------------------

class TestInvU2NoStorageRef:
    def test_clip_upload_never_creates_game_storage_or_game_storage_refs_row(self, monkeypatch, pg_conn):
        from app.services.pg import get_pg

        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        monkeypatch.setattr("app.routers.clips.r2_head_object", lambda user_id, key: _fake_head(6 * 1024 * 1024))
        monkeypatch.setattr("app.routers.clips.probe_r2_video", lambda key: _fake_probe(8.0))

        with _client() as client:
            resp = client.post("/api/clips/upload", json={
                "items": [{
                    "blake3_hash": blake3_hash,
                    "file_size": 6 * 1024 * 1024,
                    "original_filename": "clip.mp4",
                }],
            })
            assert resp.status_code == 200, resp.text

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM game_storage WHERE blake3_hash = ?", (blake3_hash,))
            local_row = cursor.fetchone()
        assert local_row is None, "a clip-source hash must never enter game_storage (INV-U2)"

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM game_storage_refs WHERE blake3_hash = %s", (blake3_hash,))
            pg_row = cur.fetchone()
        assert pg_row is None, "a clip-source hash must never enter game_storage_refs (INV-U2)"


# ---------------------------------------------------------------------------
# D4: finalize_upload(kind='clip') emits no game_upload_succeeded
# ---------------------------------------------------------------------------

class TestFinalizeUploadKindRouting:
    def test_finalize_clip_upload_emits_no_game_upload_succeeded(self, monkeypatch, pg_conn):
        from app.services.pg import get_pg
        from app.utils.encoding import encode_data

        blake3_hash = uuid.uuid4().hex + uuid.uuid4().hex
        upload_id = f"upl_{uuid.uuid4().hex}"
        session_id = uuid.uuid4().hex

        with get_db_connection() as conn:
            cursor = conn.cursor()
            # kind='clip' — requires the v050 pending_uploads.kind column to exist.
            cursor.execute(
                """INSERT INTO pending_uploads
                   (id, blake3_hash, file_size, original_filename, r2_upload_id, parts_json, kind)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, blake3_hash, 6 * 1024 * 1024, "clip.mp4", upload_id, encode_data([]), "clip"),
            )
            conn.commit()

        monkeypatch.setattr("app.routers.games_upload.r2_complete_multipart_upload", lambda *a, **k: True)
        monkeypatch.setattr(
            "app.routers.games_upload.r2_head_object_global",
            lambda key: {"ContentLength": 6 * 1024 * 1024},
        )
        monkeypatch.setattr("app.routers.games_upload.r2_set_object_metadata_global", lambda *a, **k: True)

        before = None
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count(*) AS c FROM user_actions WHERE user_id = %s AND action = %s",
                (TEST_USER_ID, "game_upload_succeeded"),
            )
            before = cur.fetchone()["c"]

        with _client() as client:
            resp = client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id,
                "parts": [{"part_number": 1, "etag": "etag1"}],
            })

        assert resp.status_code == 200, resp.text

        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count(*) AS c FROM user_actions WHERE user_id = %s AND action = %s",
                (TEST_USER_ID, "game_upload_succeeded"),
            )
            after = cur.fetchone()["c"]

        assert after == before, "finalize_upload(kind='clip') must not emit game_upload_succeeded (D4)"

    def test_prepare_clip_upload_on_below_v050_db_returns_503_not_mis_namespaced_row(self, monkeypatch):
        """Guarded write (T6550/T6780 pattern): if pending_uploads.kind is absent
        (below-v050 profile DB in a rolling-deploy window), a kind='clip' prepare
        must REFUSE with a retryable 503, never insert a row that omits kind (which
        would default to 'game' and finalize into the wrong namespace/milestone)."""
        from app.database import column_exists

        with get_db_connection() as conn:
            has_kind_column = column_exists(conn.cursor(), "pending_uploads", "kind")
        if has_kind_column:
            with get_db_connection() as conn:
                conn.execute("ALTER TABLE pending_uploads RENAME TO pending_uploads_t8370_bak")
                conn.execute("""
                    CREATE TABLE pending_uploads (
                        id TEXT PRIMARY KEY,
                        blake3_hash TEXT NOT NULL,
                        file_size INTEGER NOT NULL,
                        original_filename TEXT NOT NULL,
                        r2_upload_id TEXT NOT NULL,
                        parts_json TEXT,
                        label TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.commit()

        try:
            with _client() as client:
                resp = client.post("/api/games/prepare-upload", json={
                    "blake3_hash": uuid.uuid4().hex + uuid.uuid4().hex,
                    "file_size": 5 * 1024 * 1024,
                    "original_filename": "clip.mp4",
                    "kind": "clip",
                })
            assert resp.status_code == 503, (
                f"expected 503 pending_migration on a below-v050 DB, got {resp.status_code}: {resp.text}"
            )
            body = resp.json()
            # The games_upload.py 503 nests the machine-readable code inside
            # "detail" (HTTPException(detail={"detail": ..., "code": ...})),
            # distinct from the app-level MigrationBlocked handler's flat shape.
            code = body.get("code") or (body.get("detail") or {}).get("code")
            assert code == "pending_migration", body
        finally:
            if has_kind_column:
                with get_db_connection() as conn:
                    conn.execute("DROP TABLE IF EXISTS pending_uploads")
                    conn.execute("ALTER TABLE pending_uploads_t8370_bak RENAME TO pending_uploads")
                    conn.commit()
