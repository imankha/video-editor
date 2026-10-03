"""
T11430 -- create-path behavioral tests for `_create_auto_project_for_clip`
(app/routers/clips.py:1073), covering design doc section 5.3 / req #2:

  - A newly created project carries `source_raw_clip_id` == the raw_clip's id
    (the durable one-to-many link; column doesn't exist yet -- expected red).
  - Calling the creator twice for the SAME raw_clip (simulating "Make Another
    Highlight") produces TWO projects, each with highlight_ordinal 1 and 2
    respectively, and the FIRST project is left completely untouched (not
    archived/mutated/deleted) by the second call -- "never mutate an older
    one" (design req #2).

Written test-first (Stage 3): `source_raw_clip_id`/`highlight_ordinal` do not
exist on `projects` yet, so every assertion that reads them is expected to
fail (missing-key/KeyError via sqlite3.Row, or AttributeError/OperationalError
depending on where the production code is in its current, pre-fix state).

Uses this repo's real DB fixture convention (TestClient + app.database
get_db_connection against a per-test user/profile, mirroring
tests/test_t10700_nullable_rating_clips.py) -- no SQLite mocking.
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11430_create_{uuid.uuid4().hex[:8]}"
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


@pytest.fixture
def raw_clip_id(client):
    """A real raw_clip row via the production create path (no project)."""
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T11430 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id) "
            "VALUES ('', 5, 0.0, 5.0, ?)",
            (game_id,),
        )
        conn.commit()
        return cursor.lastrowid


def test_new_project_carries_source_raw_clip_id(raw_clip_id):
    """A freshly created project's source_raw_clip_id equals the raw_clip's
    own id -- the durable one-to-many link (design §4.1). The column does not
    exist yet, so this is expected to fail (KeyError / no such column)."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()
        project_id = _create_auto_project_for_clip(cursor, raw_clip_id, "Test Highlight")
        conn.commit()

        cursor.execute("SELECT source_raw_clip_id FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()

    assert row is not None
    assert row["source_raw_clip_id"] == raw_clip_id, (
        f"expected project {project_id}'s source_raw_clip_id to be raw_clip "
        f"{raw_clip_id}, got {row['source_raw_clip_id'] if row else None!r}"
    )


def test_make_another_highlight_creates_second_project_without_mutating_first(raw_clip_id):
    """Calling the creator twice for the same raw_clip produces TWO distinct
    projects, each carrying source_raw_clip_id == raw_clip_id, with
    highlight_ordinal 1 and 2 respectively -- and the FIRST project's own
    columns (id, source_raw_clip_id, highlight_ordinal, archived_at) are
    unchanged by the second call (design req #2: never mutate/archive/detach
    an older highlight when making another)."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()

        first_project_id = _create_auto_project_for_clip(cursor, raw_clip_id, "First Highlight")
        conn.commit()

        # Snapshot the first project's full row before the second creation.
        cursor.execute("SELECT * FROM projects WHERE id = ?", (first_project_id,))
        first_before = dict(cursor.fetchone())

        second_project_id = _create_auto_project_for_clip(cursor, raw_clip_id, "Second Highlight")
        conn.commit()

        assert second_project_id != first_project_id, "Make Another Highlight must INSERT a new project, not reuse the old one"

        cursor.execute("SELECT * FROM projects WHERE id = ?", (first_project_id,))
        first_after = dict(cursor.fetchone())

        cursor.execute("SELECT * FROM projects WHERE id = ?", (second_project_id,))
        second_after = dict(cursor.fetchone())

    # The first project must be byte-for-byte untouched by creating the second.
    assert first_after == first_before, (
        "creating a second highlight must never mutate the first project's row: "
        f"before={first_before!r} after={first_after!r}"
    )
    assert first_after["archived_at"] is None, "creating another highlight must not archive an older one"

    assert first_after["source_raw_clip_id"] == raw_clip_id
    assert second_after["source_raw_clip_id"] == raw_clip_id

    assert first_after["highlight_ordinal"] == 1, (
        f"first highlight for this raw_clip+orientation should be ordinal 1, got {first_after['highlight_ordinal']!r}"
    )
    assert second_after["highlight_ordinal"] == 2, (
        f"second highlight for this raw_clip+orientation should be ordinal 2, got {second_after['highlight_ordinal']!r}"
    )


def test_aspect_ratio_change_recomputes_own_ordinal_without_touching_others(raw_clip_id):
    """T11430 design §4.4: changing a project's aspect ratio moves it into the
    new orientation's ordinal bucket -- it joins the back of the queue there
    (next ordinal in the NEW bucket), and no OTHER project's ordinal is
    touched. Written test-first for this new behavior per the task's
    red-then-green instruction (not covered by the Tester's 3 files)."""
    import asyncio

    from app.database import get_db_connection
    from app.routers.clips import (
        AspectRatioChange,
        _create_auto_project_for_clip,
        set_project_aspect_ratio,
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Two 9:16 projects for the same raw_clip -> ordinals 1, 2.
        vertical_1 = _create_auto_project_for_clip(cursor, raw_clip_id, "Vertical One")
        vertical_2 = _create_auto_project_for_clip(cursor, raw_clip_id, "Vertical Two")
        conn.commit()

        cursor.execute("SELECT highlight_ordinal FROM projects WHERE id = ?", (vertical_1,))
        assert cursor.fetchone()["highlight_ordinal"] == 1
        cursor.execute("SELECT highlight_ordinal FROM projects WHERE id = ?", (vertical_2,))
        assert cursor.fetchone()["highlight_ordinal"] == 2

    # Change vertical_2 to 16:9 -- it should become ordinal 1 in the (empty)
    # horizontal bucket, and vertical_1 must be left completely untouched.
    asyncio.run(set_project_aspect_ratio(vertical_2, AspectRatioChange(aspect_ratio="16:9")))

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT aspect_ratio, highlight_ordinal FROM projects WHERE id = ?", (vertical_2,)
        )
        row2 = cursor.fetchone()
        assert row2["aspect_ratio"] == "16:9"
        assert row2["highlight_ordinal"] == 1, (
            f"project moved to a new orientation bucket should get ordinal 1 there, got {row2['highlight_ordinal']!r}"
        )

        cursor.execute("SELECT highlight_ordinal FROM projects WHERE id = ?", (vertical_1,))
        row1 = cursor.fetchone()
        assert row1["highlight_ordinal"] == 1, (
            "the untouched vertical project's own ordinal must not change"
        )


def test_force_new_aspect_override_creates_horizontal_in_its_own_bucket(raw_clip_id):
    """fixround1 MAJOR 2: _create_auto_project_for_clip honors an explicit
    aspect_ratio so the synthesized-counterpart "Make a horizontal highlight"
    actually makes a 16:9 project, ordinal 1 in the (independent) horizontal
    bucket -- not another vertical."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()
        v = _create_auto_project_for_clip(cursor, raw_clip_id, "Vert")  # default 9:16
        h = _create_auto_project_for_clip(cursor, raw_clip_id, "Horiz", aspect_ratio="16:9")
        conn.commit()

        cursor.execute("SELECT aspect_ratio, highlight_ordinal FROM projects WHERE id = ?", (v,))
        vr = cursor.fetchone()
        cursor.execute("SELECT aspect_ratio, highlight_ordinal FROM projects WHERE id = ?", (h,))
        hr = cursor.fetchone()

    assert vr["aspect_ratio"] == "9:16" and vr["highlight_ordinal"] == 1
    assert hr["aspect_ratio"] == "16:9", "explicit aspect_ratio must be honored, not defaulted to 9:16"
    assert hr["highlight_ordinal"] == 1, "first horizontal is ordinal 1 in its own independent bucket"


def test_per_project_reel_source_snapshot_is_independent(raw_clip_id):
    """fixround1 MAJOR 1: each highlight instance tracks staleness against its
    OWN creation-time producing-window snapshot (projects.reel_source_*), not the
    shared per-play raw_clips snapshot. Create V1, then edit the play's boundaries
    (as a real trim does, also re-seeding the SHARED raw_clips snapshot), then
    create V2. V1's frozen snapshot must still reflect its original boundaries;
    V2's must reflect the new ones. Both must come back distinctly from the read
    path."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip, _get_highlight_instances_by_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()
        # raw_clip starts at 0.0-5.0 (fixture). Create V1 -> freezes 0.0-5.0.
        v1 = _create_auto_project_for_clip(cursor, raw_clip_id, "V1")
        conn.commit()

        # Simulate a trim: move the play boundaries AND re-seed the shared
        # per-play snapshot (what every create path does to raw_clips today).
        cursor.execute(
            "UPDATE raw_clips SET start_time = 10.0, end_time = 15.0, "
            "reel_source_start_time = 10.0, reel_source_end_time = 15.0 WHERE id = ?",
            (raw_clip_id,),
        )
        conn.commit()

        # Create V2 -> freezes 10.0-15.0.
        v2 = _create_auto_project_for_clip(cursor, raw_clip_id, "V2")
        conn.commit()

        cursor.execute(
            "SELECT reel_source_start_time, reel_source_end_time FROM projects WHERE id = ?", (v1,)
        )
        v1_snap = cursor.fetchone()
        cursor.execute(
            "SELECT reel_source_start_time, reel_source_end_time FROM projects WHERE id = ?", (v2,)
        )
        v2_snap = cursor.fetchone()

        instances = _get_highlight_instances_by_clip(cursor, [raw_clip_id])[raw_clip_id]

    # V1 keeps its original producing window even though the play (and the shared
    # per-play snapshot) moved to 10-15 when V2 was created.
    assert (v1_snap["reel_source_start_time"], v1_snap["reel_source_end_time"]) == (0.0, 5.0), (
        f"V1's frozen snapshot must stay at its creation-time window, got {dict(v1_snap)!r}"
    )
    assert (v2_snap["reel_source_start_time"], v2_snap["reel_source_end_time"]) == (10.0, 15.0), (
        f"V2's frozen snapshot must reflect the boundaries at ITS creation, got {dict(v2_snap)!r}"
    )

    by_project = {i["project_id"]: i for i in instances}
    assert by_project[v1]["reel_source_start_time"] == 0.0
    assert by_project[v2]["reel_source_start_time"] == 10.0


def test_force_new_over_http_creates_second_project_with_optional_aspect(client, raw_clip_id):
    """fixround1 minor + MAJOR 2: PUT /api/clips/raw/{id} with force_new mints a
    second project for the same play (never reusing auto_project_id), and an
    explicit aspect_ratio creates the requested orientation."""
    from app.database import get_db_connection

    # First highlight (ordinary create).
    r1 = client.put(f"/api/clips/raw/{raw_clip_id}", json={"create_project": True})
    assert r1.status_code == 200, r1.text
    p1 = r1.json()["project_id"]

    # Make Another Highlight, horizontal, over HTTP.
    r2 = client.put(
        f"/api/clips/raw/{raw_clip_id}",
        json={"create_project": True, "force_new": True, "aspect_ratio": "16:9"},
    )
    assert r2.status_code == 200, r2.text
    p2 = r2.json()["project_id"]
    assert p2 != p1, "force_new must mint a NEW project, not reuse the pointer"

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, aspect_ratio, source_raw_clip_id FROM projects WHERE source_raw_clip_id = ? ORDER BY id",
            (raw_clip_id,),
        )
        rows = [dict(r) for r in cursor.fetchall()]

    ids = {r["id"] for r in rows}
    assert {p1, p2}.issubset(ids), f"both projects must link to the play, got {rows!r}"
    by_id = {r["id"]: r for r in rows}
    assert by_id[p2]["aspect_ratio"] == "16:9", "force_new honored the explicit horizontal aspect over HTTP"
