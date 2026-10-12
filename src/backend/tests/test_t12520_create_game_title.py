"""
T12520: create_game wiring for unnamed uploads. The pure helpers are covered in
test_t12520_unnamed_upload_title.py; this drives the endpoint so the
original_filename -> stored title path and the dedupe against existing names
are exercised end to end.

Imports only names that predate T12520 so the same test runs (and fails on an
assertion) against the pre-change revision.
"""

import shutil
import uuid
from datetime import datetime

import pytest

from app.profile_context import set_current_profile_id
from app.routers.games import upload_fallback_name
from app.user_context import set_current_user_id


@pytest.mark.asyncio
async def test_create_game_titles_unnamed_uploads_from_filename_and_dedupes(monkeypatch):
    import app.routers.games as games_mod
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection
    from app.routers.games import CreateGameRequest, VideoReference, create_game

    user_id = f"test_t12520_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()

    monkeypatch.setattr(games_mod, "_validate_video_in_r2", lambda h: None)
    monkeypatch.setattr(games_mod, "_probe_video_metadata", lambda h: None)
    monkeypatch.setattr(games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4")
    monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

    def unnamed(blake3_hash, original_filename=None):
        return CreateGameRequest(videos=[VideoReference(
            blake3_hash=blake3_hash, sequence=1, duration=100, file_size=10,
            original_filename=original_filename,
        )])

    def stored_name(game_id):
        with get_db_connection() as conn:
            return conn.execute("SELECT name FROM games WHERE id = ?", (game_id,)).fetchone()["name"]

    try:
        first = await create_game(unnamed("d" * 64, "wcfc-carlsbad-trimmed.mp4"))
        second = await create_game(unnamed("e" * 64, "wcfc-carlsbad-trimmed.mp4"))
        no_file = await create_game(unnamed("f" * 64))

        # Stored title comes from the file name; the repeat is distinguishable.
        assert stored_name(first["game_id"]) == "wcfc-carlsbad-trimmed"
        assert stored_name(second["game_id"]) == "wcfc-carlsbad-trimmed (2)"
        # Only with no file name does the dated title apply.
        today = datetime.now().strftime("%Y-%m-%d")
        assert stored_name(no_file["game_id"]) == upload_fallback_name(today)
        # The name handed back to the client is the stored one, so the title can't flip.
        assert first["name"] == stored_name(first["game_id"])
        assert second["name"] == stored_name(second["game_id"])
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
