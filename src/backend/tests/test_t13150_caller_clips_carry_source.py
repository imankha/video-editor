"""T13150 follow-up: every caller of resolve_clip_source must hand it `source`.

resolve_clip_source skips the game-video step for source='upload' clips, but only
if the caller's clip dict carries `source`. A SELECT that drops `rc.source` would
make the resolver see no key and silently resolve a linked upload clip to the
GAME video again, with the resolver unit tests still green.

- poster: behavioral (real throwaway profile DB through _load_first_clip_for_poster,
  then the real resolver; only R2 is mocked).
- framing + multi-clip export: their SELECTs live inside large request handlers, so
  assert the source text of each working_clips query selects `rc.source`.
"""

import re
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.export_helpers import resolve_clip_source

USER_ID = "test-user-t13150"
PROFILE_ID = "t13150prof"

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def test_poster_loader_clip_carries_source_and_resolves_upload_to_own_file(db):
    conn = sqlite3.connect(str(db))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Draft', '9:16')")
    pid = cur.lastrowid
    cur.execute("INSERT INTO games (name, blake3_hash) VALUES ('G', 'gamehash123')")
    game_id = cur.lastrowid
    # A directly uploaded clip linked to a single-video game (T10300): game_id set,
    # video_sequence NULL, own file in raw_clips/.
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, source) "
        "VALUES ('own_clip.mp4', 5, 0.0, 20.0, ?, 'upload')",
        (game_id,),
    )
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) "
        "VALUES (?, ?, 0, 1)",
        (pid, rc),
    )
    conn.commit()
    conn.close()

    clip = poster_mod._load_first_clip_for_poster(pid)
    assert clip["source"] == "upload"
    # The loader's COALESCE still yields the game hash; only `source` keeps the
    # resolver off it.
    assert clip["game_blake3_hash"] == "gamehash123"

    def presign(user_id, key, *a, **kw):
        return f"URL::{key}"

    with patch("app.storage.generate_presigned_url", side_effect=presign),          patch("app.storage.generate_presigned_url_global") as game_presign,          patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}) as head,          patch("app.user_context.get_current_user_id", return_value=USER_ID):
        url, start, end, _flex = resolve_clip_source(clip)

    game_presign.assert_not_called()
    head.assert_not_called()
    assert "raw_clips/own_clip.mp4" in url
    assert "games/" not in url
    assert (start, end) == (0.0, 20.0)


def _working_clip_selects(path: Path) -> list[str]:
    """Every SELECT in `path` whose FROM clause starts at working_clips wc."""
    text = path.read_text(encoding="utf-8")
    return re.findall(r"SELECT.*?FROM working_clips wc", text, flags=re.DOTALL)


@pytest.mark.parametrize(
    "rel_path",
    ["routers/export/framing.py", "routers/export/multi_clip.py"],
)
def test_export_queries_select_rc_source(rel_path):
    selects = [
        s for s in _working_clip_selects(BACKEND_APP / rel_path)
        if "game_blake3_hash" in s  # the ones that feed resolve_clip_source
    ]
    assert selects, f"no resolver-feeding working_clips SELECT found in {rel_path}"
    for s in selects:
        assert "rc.source" in s, (
            f"{rel_path}: a SELECT feeding resolve_clip_source drops rc.source; a "
            "linked upload clip would resolve to the GAME video (T13150)"
        )
