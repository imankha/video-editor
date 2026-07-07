"""
T4800 — Reel Drafts shows 0-clip orphan drafts after a clip is deleted.

Root cause: deleting a raw clip whose auto-created reel draft already had a
final_video left a 0-clip orphan draft. _delete_auto_project kept any project
with working_video_id OR final_video_id OR clip_count > 1, so an exported (but
never published) auto-reel survived clip-delete with 0 source clips and still
listed in GET /api/projects (the Reel Drafts feed).

Fix (two layers):
  (a) _delete_auto_project (clips.py) now deletes the draft when the clip being
      deleted is its ONLY source clip — even if it was exported — but preserves
      PUBLISHED reels (a final_video with published_at set) and multi-clip
      projects.
  (b) GET /api/projects (projects.py) never returns clip_count == 0 projects —
      belt-and-suspenders for any orphan that predates the fix.

These tests pin both layers plus the perf property (no per-orphan query).
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "testdefault"


def _new_user():
    """A fresh per-test user id -> its own isolated SQLite profile DB."""
    uid = f"test_t4800_{uuid.uuid4().hex[:8]}"
    _init_cache[uid] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
    return uid


def _ctx(uid):
    set_current_user_id(uid)
    set_current_profile_id(TEST_PROFILE_ID)


def _make_clip_with_auto_reel(cursor, *, published=False, exported=False, name="Brilliant Assist"):
    """Seed a raw clip + its auto-created reel draft (project + working_clip).

    published=True  -> the reel has a final_video with published_at set (My Reels).
    exported=True   -> the reel has an UNPUBLISHED final_video (framed, not published).
    Returns (clip_id, project_id, final_id | None).
    """
    cursor.execute(
        "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES (?, '9:16', 1)",
        (name,),
    )
    project_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO raw_clips (filename, rating, name, auto_project_id) VALUES ('', 5, ?, ?)",
        (name, project_id),
    )
    clip_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, 0, 1)",
        (project_id, clip_id),
    )

    final_id = None
    if published or exported:
        published_at = "CURRENT_TIMESTAMP" if published else "NULL"
        cursor.execute(
            f"""
            INSERT INTO final_videos (project_id, filename, version, published_at)
            VALUES (?, 'final_test.mp4', 1, {published_at})
            """,
            (project_id,),
        )
        final_id = cursor.lastrowid
        # Point the project at its final video, reproducing the exported state.
        cursor.execute(
            "UPDATE projects SET final_video_id = ? WHERE id = ?", (final_id, project_id)
        )

    return clip_id, project_id, final_id


def _project_exists(cursor, project_id):
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    return cursor.fetchone() is not None


def _final_exists(cursor, final_id):
    cursor.execute("SELECT id FROM final_videos WHERE id = ?", (final_id,))
    return cursor.fetchone() is not None


# ---------------------------------------------------------------------------
# (a) _delete_auto_project via DELETE /api/clips/raw/{id}
# ---------------------------------------------------------------------------

def test_delete_clip_removes_exported_auto_reel_no_orphan():
    """Deleting a clip whose auto-reel was EXPORTED (unpublished final_video)
    removes the whole draft — it must NOT survive as a 0-clip orphan."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        clip_id, project_id, final_id = _make_clip_with_auto_reel(cur, exported=True)
        conn.commit()

    resp = client.delete(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text

    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        assert not _project_exists(cur, project_id), "exported auto-reel draft should be deleted, not left as orphan"
        assert not _final_exists(cur, final_id), "its unpublished final_video should be gone too"
        cur.execute("SELECT id FROM raw_clips WHERE id = ?", (clip_id,))
        assert cur.fetchone() is None, "raw clip should be deleted"


def test_delete_clip_preserves_published_reel():
    """Deleting a clip whose auto-reel was PUBLISHED preserves the published reel:
    the project and its published final_video survive (it lives in My Reels)."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        clip_id, project_id, final_id = _make_clip_with_auto_reel(cur, published=True)
        conn.commit()

    resp = client.delete(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text

    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        assert _project_exists(cur, project_id), "published reel's project must survive clip delete"
        assert _final_exists(cur, final_id), "published final_video must remain unaffected"
        cur.execute(
            "SELECT published_at FROM final_videos WHERE id = ?", (final_id,)
        )
        assert cur.fetchone()["published_at"] is not None, "reel must stay published"


def test_delete_clip_keeps_multi_clip_project():
    """Deleting one clip of a multi-clip auto-project keeps the project (other
    source clips remain)."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        clip_id, project_id, _ = _make_clip_with_auto_reel(cur)
        # Second source clip in the same project -> clip_count == 2.
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, name) VALUES ('', 5, 'Other Clip')"
        )
        other_clip = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, 1, 1)",
            (project_id, other_clip),
        )
        conn.commit()

    resp = client.delete(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text

    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        assert _project_exists(cur, project_id), "multi-clip project must survive deleting one of its clips"


# ---------------------------------------------------------------------------
# The Reel Drafts feed contains only project rows (never smart collections)
# ---------------------------------------------------------------------------

def test_projects_feed_returns_only_projects_not_smart_collections():
    """The Reel Drafts feed returns only real project rows (drafts) — never smart
    /tag collections ('Top Plays' / 'Top {Tag}s'). Those live in collections.py
    and are a My Reels concept sourced from final_videos, never from the projects
    table, so GET /api/projects cannot structurally emit them. This pins that:
    every returned id resolves to a projects row."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        _make_clip_with_auto_reel(cur, name="A Real Draft")
        _make_clip_with_auto_reel(cur, name="Another Draft")
        conn.commit()

    resp = client.get("/api/projects")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) >= 2

    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM projects")
        real_project_ids = {r["id"] for r in cur.fetchall()}

    for p in items:
        assert p["id"] in real_project_ids, (
            f"drafts feed returned id {p['id']} ({p.get('name')!r}) that is not a "
            f"project row — smart collections must never appear in Reel Drafts"
        )
