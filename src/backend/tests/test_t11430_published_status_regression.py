"""
T11430 -- read-path regression test reproducing the ACTUAL reported bug: a
play (raw_clip) that already published a highlight still reads as
"Highlight Not Started" because publish archives the project and
`load_annotations_from_db` (games.py ~2506) force-NULLs `auto_project_id`
for any archived project.

This drives the REAL production code path end to end:
  1. seed a raw_clip (via the real create-clip DB insert, mirroring other
     test files' fixture convention)
  2. create a highlight project for it via the real
     `_create_auto_project_for_clip` creator
  3. publish it: insert a `final_videos` row with `published_at` set (the
     real "is_published" predicate `projects.py` already uses) and archive
     the project via the REAL `app.services.project_archive.archive_project`
     (same call publish_to_my_reels makes)
  4. call `load_annotations_from_db(game_id)` -- the real function under
     test, no mocking -- and assert the returned annotation for that clip:
       - exposes a `highlight_instances` list containing exactly one
         instance with `is_published=True` (key doesn't exist yet -- the
         correct red reason: KeyError / missing key, not a typo)
       - `auto_project_id` is no longer force-NULLed by the archived check
         (games.py's current CASE WHEN ... archived_at IS NULL ... ELSE NULL
         END) -- this assertion is expected to fail for the SAME reason
         (the dict won't even have `highlight_instances` to check first,
         and today `auto_project_id` is still NULL for the archived project)

Written test-first (Stage 3): expected RED against current production code.
Uses this repo's real DB fixture convention (app.database get_db_connection
against a per-test user/profile) -- no mocking of SQLite or of
load_annotations_from_db itself.
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11430_pubstatus_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


def test_published_play_exposes_highlight_instances_and_keeps_auto_project_id(client):
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip
    from app.routers.games import load_annotations_from_db
    from app.services.project_archive import archive_project

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T11430 Published Status Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id) "
            "VALUES ('', 5, 24.0, 28.0, ?)",
            (game_id,),
        )
        raw_clip_id = cursor.lastrowid
        conn.commit()

        project_id = _create_auto_project_for_clip(cursor, raw_clip_id, "Great Goal")
        conn.commit()

        # Publish: a final_videos row with published_at set -- the same
        # is_published predicate projects.py already uses.
        cursor.execute(
            "INSERT INTO final_videos (project_id, filename, version, name, published_at, source_clip_id, aspect_ratio) "
            "VALUES (?, 'great_goal.mp4', 1, 'Great Goal', CURRENT_TIMESTAMP, ?, '9:16')",
            (project_id, raw_clip_id),
        )
        conn.commit()

    # Archive the project the SAME way publish_to_my_reels does.
    archived_ok = archive_project(project_id, user_id=TEST_USER_ID)
    assert archived_ok, "archive_project must succeed in the test harness (R2 disabled -> archived_at-only branch)"

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT archived_at FROM projects WHERE id = ?", (project_id,))
        archived_row = cursor.fetchone()
    assert archived_row["archived_at"] is not None, "sanity check: project must actually be archived"

    annotations = load_annotations_from_db(game_id)
    by_id = {a["raw_clip_id"]: a for a in annotations}
    assert raw_clip_id in by_id
    annotation = by_id[raw_clip_id]

    # The bug: today `auto_project_id` is force-NULLed for an archived
    # project (games.py's CASE WHEN ... archived_at IS NULL ... ELSE NULL
    # END). This must no longer happen once the fix lands.
    assert annotation["auto_project_id"] == project_id, (
        "a published (archived) project's auto_project_id must not be force-"
        f"NULLed by the archived check; got {annotation.get('auto_project_id')!r}"
    )

    # The actual reported bug surface: the annotation must expose a
    # highlight_instances collection naming this published instance. The key
    # does not exist at all today -- KeyError is the correct red reason.
    assert "highlight_instances" in annotation, (
        "load_annotations_from_db must return a `highlight_instances` list per "
        "region (design doc §5.2) -- key is completely absent today"
    )
    instances = annotation["highlight_instances"]
    assert isinstance(instances, list)
    assert len(instances) == 1, f"expected exactly one highlight instance, got {instances!r}"
    assert instances[0]["is_published"] is True, (
        f"the single highlight instance for this published play must report is_published=True, got {instances[0]!r}"
    )
    assert instances[0]["project_id"] == project_id
