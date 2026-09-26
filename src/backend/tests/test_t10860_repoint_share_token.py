"""
Tests for T10860 -- "Update shared version": re-point an existing share token
to a moved final_video_id after a private re-export.

Covers (design doc §8, items 1-4 -- the backend curated set):
1. sharing_db.repoint_share_video moves video_id+video_filename+name+duration
   TOGETHER in one call; a subsequent get_share_by_token reflects the new
   snapshot.
2. repoint_share_video refuses (False) on: revoked share; wrong
   sharer_user_id; non-'video' share_type. The CAS-refusal cases.
3. GET /api/projects surfaces `stale_share` on the affected ProjectListItem
   after a simulated re-export (new final_videos row + moved
   projects.final_video_id, old share row's video_filename unchanged), and
   `stale_share: null` when already current.
4. POST /api/gallery/{video_id}/share/repoint: 409 video_not_current, 409
   target_missing, 200 idempotent no-op, 200 + unchanged share_url on
   success, 403 non-sharer, 410 revoked.

None of `repoint_share_video`, the `/share/repoint` route, or the
`stale_share` field exist yet -- every test below is expected to fail via
ImportError/AttributeError/404/missing-key, not a syntax error in this file.

Design doc: docs/plans/tasks/T10860-design.md
"""

from unittest.mock import patch

import pytest

# Reuse the existing pg_conn-cleaned test user ids (conftest.py's
# _TEST_USER_IDS teardown DELETEs `shares` keyed on these ids -- inventing a
# new id here would leak share rows across test runs).
SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"


@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    from unittest.mock import AsyncMock

    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.email.send_share_email", new_callable=AsyncMock, return_value=True):
        from fastapi.testclient import TestClient

        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _seed_project_with_final_video(
    user_id=SHARER_ID, filename="v1.mp4", name="Test Video", duration=12.5,
    published=True,
):
    """Insert a project + one final_videos row into the sharer's SQLite,
    return (project_id, final_video_id)."""
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')",
            ("T10860 Project",),
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """INSERT INTO final_videos
               (project_id, filename, name, duration, version, published_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (project_id, filename, name, duration, "2026-09-26T00:00:00" if published else None),
        )
        final_video_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET final_video_id = ? WHERE id = ?",
            (final_video_id, project_id),
        )
        conn.commit()
    return project_id, final_video_id


def _reexport(project_id, new_filename="v2.mp4", new_name="Test Video V2", new_duration=20.0):
    """Simulate a private re-export: INSERT a new final_videos row for the
    SAME project and repoint projects.final_video_id -- mirrors
    publish_final_video.py:284-296. Returns the new final_video_id."""
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO final_videos
               (project_id, filename, name, duration, version, published_at)
               VALUES (?, ?, ?, ?, 2, ?)""",
            (project_id, new_filename, new_name, new_duration, "2026-09-26T00:10:00"),
        )
        new_final_video_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET final_video_id = ? WHERE id = ?",
            (new_final_video_id, project_id),
        )
        conn.commit()
    return new_final_video_id


# ---------------------------------------------------------------------------
# 1 & 2. sharing_db.repoint_share_video
# ---------------------------------------------------------------------------

class TestRepointShareVideoDb:
    def test_repoint_moves_all_snapshot_columns_together(self, isolated_auth_db):
        """Happy path: video_id + video_filename + video_name + video_duration
        all move in ONE call; get_share_by_token reflects the new snapshot."""
        from app.services.sharing_db import create_shares, get_share_by_token, repoint_share_video

        shares = create_shares(
            video_id=1, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename="old.mp4", video_name="Old Name", video_duration=10.0,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token = shares[0]["share_token"]

        ok = repoint_share_video(
            token=token, sharer_user_id=SHARER_ID, new_video_id=2,
            new_video_filename="new.mp4", new_video_name="New Name",
            new_video_duration=25.0,
        )
        assert ok is True

        share = get_share_by_token(token)
        assert share["video_id"] == 2
        assert share["video_filename"] == "new.mp4"
        assert share["video_name"] == "New Name"
        assert share["video_duration"] == 25.0

    def test_repoint_refuses_on_revoked_share(self, isolated_auth_db):
        from app.services.sharing_db import create_shares, repoint_share_video, revoke_share

        shares = create_shares(
            video_id=1, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename="old.mp4", video_name="Old", video_duration=10.0,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token = shares[0]["share_token"]
        assert revoke_share(token, SHARER_ID) is True

        ok = repoint_share_video(
            token=token, sharer_user_id=SHARER_ID, new_video_id=2,
            new_video_filename="new.mp4", new_video_name="New", new_video_duration=25.0,
        )
        assert ok is False

    def test_repoint_refuses_on_wrong_sharer(self, isolated_auth_db):
        from app.services.sharing_db import create_shares, repoint_share_video

        shares = create_shares(
            video_id=1, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename="old.mp4", video_name="Old", video_duration=10.0,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token = shares[0]["share_token"]

        ok = repoint_share_video(
            token=token, sharer_user_id=RECIPIENT_ID, new_video_id=2,
            new_video_filename="new.mp4", new_video_name="New", new_video_duration=25.0,
        )
        assert ok is False

    def test_repoint_refuses_on_non_video_share_type(self, isolated_auth_db):
        """A collection share (share_type != 'video') must not be re-pointable
        via this video-snapshot mechanism."""
        from app.services.sharing_db import create_collection_share, repoint_share_video

        token = create_collection_share(
            sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            recipient_email="somebody@example.com",
            definition={"scope": "all", "aspect_ratio": "9:16"},
            is_public=True,
        )

        ok = repoint_share_video(
            token=token, sharer_user_id=SHARER_ID, new_video_id=2,
            new_video_filename="new.mp4", new_video_name="New", new_video_duration=25.0,
        )
        assert ok is False


# ---------------------------------------------------------------------------
# 3. GET /api/projects -> stale_share
# ---------------------------------------------------------------------------

class TestProjectsListStaleShare:
    def test_stale_share_populated_after_reexport(self, client):
        """A project whose final_video is re-exported (new final_videos row,
        moved projects.final_video_id) while an active share still points at
        the OLD filename surfaces that share as stale_share on the
        ProjectListItem."""
        from app.services.sharing_db import create_shares

        project_id, final_video_id = _seed_project_with_final_video(filename="v1.mp4")
        shares = create_shares(
            video_id=final_video_id, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename="v1.mp4", video_name="Test Video", video_duration=12.5,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token = shares[0]["share_token"]

        _reexport(project_id, new_filename="v2.mp4")

        resp = client.get("/api/projects", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        project = next(p for p in resp.json() if p["id"] == project_id)

        assert project["stale_share"] is not None
        assert project["stale_share"]["share_token"] == token
        assert project["stale_share"]["old_filename"] == "v1.mp4"

    def test_stale_share_null_when_already_current(self, client):
        """A share whose video_filename already matches the project's current
        final_videos filename is NOT stale."""
        from app.services.sharing_db import create_shares

        project_id, final_video_id = _seed_project_with_final_video(filename="v1.mp4")
        create_shares(
            video_id=final_video_id, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename="v1.mp4", video_name="Test Video", video_duration=12.5,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )

        resp = client.get("/api/projects", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        project = next(p for p in resp.json() if p["id"] == project_id)
        assert project["stale_share"] is None

    def test_stale_share_null_when_never_shared(self, client):
        project_id, _ = _seed_project_with_final_video(filename="v1.mp4")
        resp = client.get("/api/projects", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        project = next(p for p in resp.json() if p["id"] == project_id)
        assert project["stale_share"] is None


# ---------------------------------------------------------------------------
# 4. POST /api/gallery/{video_id}/share/repoint
# ---------------------------------------------------------------------------

class TestRepointEndpoint:
    def _publish_and_share(self, client, filename="v1.mp4"):
        project_id, final_video_id = _seed_project_with_final_video(filename=filename)
        from app.services.sharing_db import create_shares
        shares = create_shares(
            video_id=final_video_id, sharer_user_id=SHARER_ID, sharer_profile_id="testdefault",
            video_filename=filename, video_name="Test Video", video_duration=12.5,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token = shares[0]["share_token"]
        return project_id, final_video_id, token

    def test_video_not_current_refused_409(self, client):
        """Path id isn't the project's CURRENT final video (another re-export
        raced) -> 409 video_not_current."""
        project_id, old_final_video_id, token = self._publish_and_share(client)
        _reexport(project_id, new_filename="v2.mp4")  # moves final_video_id away from old_final_video_id

        resp = client.post(
            f"/api/gallery/{old_final_video_id}/share/repoint",
            json={"share_token": token},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 409
        assert resp.json().get("code") == "video_not_current"

    def test_target_missing_refused_409(self, client):
        """R2 HEAD of the new object returns None -> 409 target_missing.

        R2_ENABLED=True patched: the endpoint only HEADs R2 when R2 is enabled
        (local dev with R2 disabled checks local disk instead, see
        test_target_missing_refused_409_local_disk below)."""
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        with patch("app.routers.shares.r2_head_object", return_value=None), \
             patch("app.routers.shares.R2_ENABLED", True):
            resp = client.post(
                f"/api/gallery/{new_final_video_id}/share/repoint",
                json={"share_token": token},
                headers=_auth_headers(SHARER_ID),
            )
        assert resp.status_code == 409
        assert resp.json().get("code") == "target_missing"

    def test_target_missing_refused_409_local_disk(self, client):
        """R2_ENABLED=False (this container's actual dev posture, discovered
        during the T10860 live-drive attempt): the target-existence check
        falls back to a LOCAL disk .exists() check (mirrors downloads.py's own
        R2_ENABLED-gated existence convention) instead of unconditionally
        HEADing R2 (which always returns None when R2 is disabled --
        storage.py's get_r2_client() short-circuits -- and would otherwise
        refuse EVERY re-point in local/no-R2 dev). No local file was ever
        written for the re-exported filename here, so this refuses exactly
        like the R2-enabled case above."""
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        resp = client.post(
            f"/api/gallery/{new_final_video_id}/share/repoint",
            json={"share_token": token},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 409
        assert resp.json().get("code") == "target_missing"

    def test_idempotent_noop_when_already_current(self, client):
        """Share already points at the current video+filename -> 200 no-op."""
        _project_id, final_video_id, token = self._publish_and_share(client)

        with patch("app.routers.shares.r2_head_object", return_value={"ETag": "x"}):
            resp = client.post(
                f"/api/gallery/{final_video_id}/share/repoint",
                json={"share_token": token},
                headers=_auth_headers(SHARER_ID),
            )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_success_returns_unchanged_share_url(self, client):
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        with patch("app.routers.shares.r2_head_object", return_value={"ETag": "x"}), \
             patch("app.routers.shares.R2_ENABLED", True):
            resp = client.post(
                f"/api/gallery/{new_final_video_id}/share/repoint",
                json={"share_token": token},
                headers=_auth_headers(SHARER_ID),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["share_url"].endswith(f"/shared/{token}")

        from app.services.sharing_db import get_share_by_token
        share = get_share_by_token(token)
        assert share["video_filename"] == "v2.mp4"
        assert share["video_id"] == new_final_video_id

    def test_success_local_disk_when_r2_disabled(self, client, tmp_path):
        """R2_ENABLED=False (this container's actual posture) + the re-exported
        file genuinely present on local disk -> 200 success, proving the local-
        disk existence branch's happy path (not just its refusal path above)."""
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        from app.database import get_final_videos_path
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        set_current_user_id(SHARER_ID)
        set_current_profile_id("testdefault")
        final_videos_dir = get_final_videos_path()
        final_videos_dir.mkdir(parents=True, exist_ok=True)
        (final_videos_dir / "v2.mp4").write_bytes(b"fake mp4 bytes")

        resp = client.post(
            f"/api/gallery/{new_final_video_id}/share/repoint",
            json={"share_token": token},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_non_sharer_forbidden_403(self, client):
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        resp = client.post(
            f"/api/gallery/{new_final_video_id}/share/repoint",
            json={"share_token": token},
            headers=_auth_headers(RECIPIENT_ID),
        )
        assert resp.status_code == 403

    def test_revoked_share_returns_410(self, client):
        project_id, _final_video_id, token = self._publish_and_share(client)
        new_final_video_id = _reexport(project_id, new_filename="v2.mp4")

        client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))

        resp = client.post(
            f"/api/gallery/{new_final_video_id}/share/repoint",
            json={"share_token": token},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 410


# ---------------------------------------------------------------------------
# Cross-profile isolation (post-ship reviewer finding): final_videos.id is a
# PER-PROFILE SQLite autoincrement, so the SAME id (e.g. 1) exists
# independently in every profile of one user. Concrete repro: profile A's
# final_video id=1 is "a1.mp4" (shared publicly); profile B's final_video
# id=1 is an UNRELATED "b1.mp4". Before the fix:
#   (1) projects.py's staleness query filtered ONLY on sharer_user_id, so
#       viewing profile B's project list surfaced profile A's share as
#       stale_share (matched by the colliding id=1, ignoring profile).
#   (2) POST /api/gallery/1/share/repoint (called while profile B is
#       current) had no sharer_profile_id check, so it happily rewrote
#       profile A's share row to point at profile B's video -- while
#       sharer_profile_id stayed "profile A". Playback then looks up
#       users/{uid}/profiles/A/final_videos/b1.mp4, which never existed
#       there -- profile A's already-distributed link breaks for everyone
#       holding it.
#   (3) Separately, even within ONE profile, a share_token for project X
#       could be used to repoint an unrelated project Y's video (no check
#       that the share's video and the path video_id share a project).
# ---------------------------------------------------------------------------

class TestCrossProfileShareIsolation:
    PROFILE_A = "aaaaaaaa"
    PROFILE_B = "bbbbbbbb"

    def _seed_two_colliding_profiles(self):
        """Seeds a project+final_video in EACH of two profiles of the SAME
        user, independently, so each profile's own SQLite autoincrement lands
        both final_videos rows on id=1 -- reproducing the collision. Shares
        profile A's video publicly; profile B's video is never shared.
        Returns (project_a_id, project_b_id, token_a)."""
        from app.database import get_db_connection
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(SHARER_ID)
        set_current_profile_id(self.PROFILE_A)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')",
                ("ProfA Project",),
            )
            project_a_id = cursor.lastrowid
            cursor.execute(
                """INSERT INTO final_videos
                   (project_id, filename, name, duration, version, published_at)
                   VALUES (?, ?, ?, ?, 1, ?)""",
                (project_a_id, "a1.mp4", "ProfA Video", 10.0, "2026-09-26T00:00:00"),
            )
            final_video_a_id = cursor.lastrowid
            cursor.execute(
                "UPDATE projects SET final_video_id = ? WHERE id = ?",
                (final_video_a_id, project_a_id),
            )
            conn.commit()

        set_current_profile_id(self.PROFILE_B)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')",
                ("ProfB Project",),
            )
            project_b_id = cursor.lastrowid
            cursor.execute(
                """INSERT INTO final_videos
                   (project_id, filename, name, duration, version, published_at)
                   VALUES (?, ?, ?, ?, 1, ?)""",
                (project_b_id, "b1.mp4", "ProfB Video", 8.0, "2026-09-26T00:05:00"),
            )
            final_video_b_id = cursor.lastrowid
            cursor.execute(
                "UPDATE projects SET final_video_id = ? WHERE id = ?",
                (final_video_b_id, project_b_id),
            )
            conn.commit()

        # Write the actual local file so the target-existence check (an
        # UNRELATED guard) does not accidentally mask the profile check under
        # test with its own 409 target_missing -- this test must isolate the
        # profile-ownership guard specifically, reproducing a genuine
        # 200-success-and-corrupt outcome pre-fix, not an incidental refusal.
        from app.database import get_final_videos_path
        final_videos_dir = get_final_videos_path()
        final_videos_dir.mkdir(parents=True, exist_ok=True)
        (final_videos_dir / "b1.mp4").write_bytes(b"fake mp4 bytes - profile B")

        assert final_video_a_id == final_video_b_id == 1, (
            "test setup requires colliding final_video ids across profiles "
            "to reproduce the cross-profile bug -- got "
            f"a={final_video_a_id} b={final_video_b_id}"
        )

        from app.services.sharing_db import create_shares
        shares = create_shares(
            video_id=final_video_a_id, sharer_user_id=SHARER_ID,
            sharer_profile_id=self.PROFILE_A, video_filename="a1.mp4",
            video_name="ProfA Video", video_duration=10.0,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token_a = shares[0]["share_token"]
        return project_a_id, project_b_id, token_a

    def test_stale_share_not_leaked_across_profiles(self, client):
        """FIX 1: viewing profile B's project list must NOT surface profile
        A's share as stale_share just because the final_video ids collide."""
        from app.session_init import _init_cache

        _project_a_id, project_b_id, _token_a = self._seed_two_colliding_profiles()

        _init_cache[SHARER_ID] = {"profile_id": self.PROFILE_B, "is_new_user": False}
        resp = client.get("/api/projects", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        project_b = next(p for p in resp.json() if p["id"] == project_b_id)
        assert project_b["stale_share"] is None

    def test_repoint_refuses_cross_profile_collision(self, client):
        """FIX 2: repointing profile A's share while profile B is the current
        session profile (video_id=1 resolves to profile B's OWN video) must
        be REFUSED -- never silently rewritten onto profile B's video while
        sharer_profile_id stays profile A (the exact corruption the reviewer
        reproduced)."""
        from app.session_init import _init_cache

        _project_a_id, _project_b_id, token_a = self._seed_two_colliding_profiles()

        _init_cache[SHARER_ID] = {"profile_id": self.PROFILE_B, "is_new_user": False}
        resp = client.post(
            "/api/gallery/1/share/repoint",
            json={"share_token": token_a},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 403

        # Confirm profile A's share row is UNTOUCHED -- still points at its
        # own a1.mp4 under its own profile, never at profile B's b1.mp4.
        from app.services.sharing_db import get_share_by_token
        share = get_share_by_token(token_a)
        assert share["video_filename"] == "a1.mp4"
        assert share["sharer_profile_id"] == self.PROFILE_A

    def test_repoint_refuses_share_from_different_project_same_profile(self, client):
        """FIX 3: a share_token minted for project X cannot be used to
        repoint an UNRELATED project Y's video, even within the SAME
        profile."""
        _project_x_id, final_video_x_id = _seed_project_with_final_video(filename="x1.mp4")
        from app.services.sharing_db import create_shares
        shares = create_shares(
            video_id=final_video_x_id, sharer_user_id=SHARER_ID,
            sharer_profile_id="testdefault", video_filename="x1.mp4",
            video_name="X Video", video_duration=5.0,
            recipient_emails=[SHARER_EMAIL], is_public=True,
        )
        token_x = shares[0]["share_token"]

        _project_y_id, final_video_y_id = _seed_project_with_final_video(
            filename="y1.mp4", name="Y Video",
        )
        # Write the actual local file so target-existence (an UNRELATED
        # guard) does not mask the project-mismatch check under test.
        from app.database import get_final_videos_path
        final_videos_dir = get_final_videos_path()
        final_videos_dir.mkdir(parents=True, exist_ok=True)
        (final_videos_dir / "y1.mp4").write_bytes(b"fake mp4 bytes - project Y")

        resp = client.post(
            f"/api/gallery/{final_video_y_id}/share/repoint",
            json={"share_token": token_x},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 409
        assert resp.json().get("code") == "share_project_mismatch"

        from app.services.sharing_db import get_share_by_token
        share = get_share_by_token(token_x)
        assert share["video_filename"] == "x1.mp4"
        assert share["video_id"] == final_video_x_id
