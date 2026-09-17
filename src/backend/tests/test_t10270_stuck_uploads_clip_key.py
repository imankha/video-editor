"""T10270 class 9: GET /api/admin/users/{user_id}/stuck-uploads misreported
live CLIP uploads as dead (the T8370 "column list omitting `kind`" landmine,
again). The handler's SELECT omitted `kind` and hardcoded
`r2_key = f"games/{hash}.mp4"` even for a CLIP row, so `_pending_kind()`
always resolved to GAME and the R2 HEAD checked the wrong namespace
(raw_clips/ is where a clip source actually lives, per-profile).

Fix: SELECT * (kind present when the column exists), derive `kind` via the
existing `_pending_kind()` helper, build the key via `upload_object_key`, and
return `kind` in the response so an operator can see what they're looking at.
"""

import sys
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.auth_db import create_user

USER_ID_PREFIX = "u_t10270stuck_"
PROFILE_ID = "10270prof"


@pytest.fixture()
def clip_stuck_upload_setup(pg_conn, tmp_path):
    admin_id = f"admin_t10270_{uuid.uuid4().hex[:8]}"
    user_id = f"{USER_ID_PREFIX}{uuid.uuid4().hex[:8]}"
    create_user(admin_id, email=f"{admin_id}@test.local")
    create_user(user_id, email=f"{user_id}@test.local")

    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (f"{admin_id}@test.local",),
        )

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database, get_db_connection
        from app.profile_context import set_current_profile_id
        from app.services.user_db import create_profile
        from app.user_context import set_current_user_id

        set_current_user_id(user_id)
        set_current_profile_id(PROFILE_ID)
        ensure_database()  # head schema -- pending_uploads.kind exists (v050+)

        blake3_hash = "c" * 64
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO pending_uploads
                   (id, blake3_hash, file_size, original_filename, r2_upload_id, label, kind)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                ("sess-" + uuid.uuid4().hex[:8], blake3_hash, 5 * 1024 * 1024,
                 "clip.mp4", "fake-upload-id", None, "clip"),
            )
            conn.commit()

        create_profile(user_id, PROFILE_ID, "Test Profile", "#000000", is_default=True)

    yield {"admin_id": admin_id, "user_id": user_id, "blake3_hash": blake3_hash}


def _client():
    from fastapi.testclient import TestClient

    from app.main import app
    return TestClient(app, raise_server_exceptions=True)


def test_clip_row_reports_kind_and_checks_the_raw_clips_key(clip_stuck_upload_setup, tmp_path):
    ctx = clip_stuck_upload_setup
    captured_keys = []

    def _fake_valid(r2_key, upload_id):
        captured_keys.append(r2_key)
        return False

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.storage.r2_is_multipart_upload_valid", side_effect=_fake_valid), \
         _client() as client:
        resp = client.get(
            f"/api/admin/users/{ctx['user_id']}/stuck-uploads",
            headers={"X-User-ID": ctx["admin_id"]},
        )

    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert len(data["stuck_uploads"]) == 1
    row = data["stuck_uploads"][0]
    assert row["kind"] == "clip"
    assert row["blake3_hash"] == ctx["blake3_hash"]

    # The bug: this used to be f"games/{hash}.mp4" for every row regardless of
    # kind. A clip's real key lives under raw_clips/ (per-profile), never games/.
    assert len(captured_keys) == 1
    assert captured_keys[0].startswith("games/") is False
    assert f"raw_clips/{ctx['blake3_hash']}.mp4" in captured_keys[0]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
