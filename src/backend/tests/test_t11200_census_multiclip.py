"""T11200: tests for the read-only multi-clip census (scripts/census_multiclip_projects.py).

Covers the pure bucketing logic against a seeded SQLite fixture reproducing every
lifecycle bucket, the archive clip-identity proxy, and the two read-only
invariants the reviewer/proof gate cares about:

  - the script NEVER calls any R2 write/upload method (mock client, assert zero
    invocations of every verb in R2_WRITE_METHODS), and
  - EVERY sqlite3.connect the script issues passes ``mode=ro`` (recorded via a
    connect spy while driving the full R2 walk against a mock client).
"""
import importlib.util
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock

import msgpack
import pytest

# Import the standalone script as a module (it inserts src/backend on sys.path).
_SCRIPT = Path(__file__).parent.parent.parent.parent / "scripts" / "census_multiclip_projects.py"
_spec = importlib.util.spec_from_file_location("census_multiclip_projects", _SCRIPT)
census = importlib.util.module_from_spec(_spec)
sys.modules["census_multiclip_projects"] = census
_spec.loader.exec_module(census)


def _seed_profile_db(path: Path) -> None:
    """Build a minimal profile.sqlite reproducing each census bucket.

    Projects:
      1 -> published multi-clip     (final_video_id set, its final published_at set)
      2 -> rendered-not-published   (working_video_id set, no final)
      3 -> framing-only draft       (no working video, no final)
      4 -> archived multi-clip      (archived_at set)
      5 -> single-clip manual reel  (is_auto_created=0, exactly 1 latest clip)
      6 -> single-clip auto project (is_auto_created=1, 1 clip -> neither bucket)
    Finals:
      100 -> published, clip_count=2                 -> bucket 3
      101 -> published, clip_count=1, custom_project -> bucket 3
      102 -> published, clip_count=1, brilliant_clip -> NOT bucket 3
      103 -> clip_count=3 but published_at NULL      -> NOT bucket 3
    """
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, end_time REAL);
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY, name TEXT, is_auto_created INTEGER,
            working_video_id INTEGER, final_video_id INTEGER, archived_at TIMESTAMP
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY, project_id INTEGER, raw_clip_id INTEGER,
            uploaded_filename TEXT, version INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY, project_id INTEGER, game_id INTEGER,
            version INTEGER NOT NULL DEFAULT 1, published_at TIMESTAMP,
            clip_count INTEGER, source_type TEXT
        );
        """
    )
    cur.executemany("INSERT INTO raw_clips (id, end_time) VALUES (?, ?)",
                    [(i, float(i)) for i in range(1, 7)])
    cur.executemany(
        "INSERT INTO projects (id, name, is_auto_created, working_video_id, "
        "final_video_id, archived_at) VALUES (?,?,?,?,?,?)",
        [
            (1, "pub", 1, None, 100, None),
            (2, "rendered", 1, 200, None, None),
            (3, "draft", 1, None, None, None),
            (4, "archived", 1, None, None, "2026-01-01T00:00:00Z"),
            (5, "manual-single", 0, None, None, None),
            (6, "auto-single", 1, None, None, None),
        ],
    )
    # Multi-clip projects get 2 clips (distinct raw_clip -> distinct identity);
    # single-clip projects get 1.
    wc = [
        (1, 1, 1), (2, 1, 2),   # project 1
        (3, 2, 3), (4, 2, 4),   # project 2
        (5, 3, 5), (6, 3, 6),   # project 3
        (7, 4, 1), (8, 4, 2),   # project 4 (reuses raw ids; partition includes project_id)
        (9, 5, 3),              # project 5 (single)
        (10, 6, 4),             # project 6 (single, auto)
    ]
    cur.executemany(
        "INSERT INTO working_clips (id, project_id, raw_clip_id) VALUES (?,?,?)", wc
    )
    cur.executemany(
        "INSERT INTO final_videos (id, project_id, published_at, clip_count, source_type) "
        "VALUES (?,?,?,?,?)",
        [
            (100, 1, "2026-01-01T00:00:00Z", 2, "custom_project"),
            (101, 7, "2026-01-01T00:00:00Z", 1, "custom_project"),
            (102, 8, "2026-01-01T00:00:00Z", 1, "brilliant_clip"),
            (103, 9, None, 3, "custom_project"),
        ],
    )
    conn.commit()
    conn.close()


def test_bucketing_classifies_every_lifecycle(tmp_path):
    db = tmp_path / "profile.sqlite"
    _seed_profile_db(db)
    conn = census.open_ro(db)
    try:
        result = census.census_profile_db(conn)
    finally:
        conn.close()

    b1 = result["multiclip_projects"]
    assert b1["published"] == [1]
    assert b1["rendered_not_published"] == [2]
    assert b1["framing_only_draft"] == [3]
    assert b1["archived"] == [4]
    # Single-clip manual reel present; the single-clip AUTO project excluded.
    assert result["single_clip_manual_reels"] == [5]
    # Multi-clip published finals (latest version, published, multi-clip predicate).
    assert sorted(result["published_multiclip_finals"]) == [100, 101]


@pytest.mark.parametrize(
    "clips, expected",
    [
        ([{"raw_clip_id": 1}, {"raw_clip_id": 1}, {"raw_clip_id": 2}], 2),  # 2 identities
        ([{"raw_clip_id": 1}, {"raw_clip_id": 1}], 1),                      # re-framed, 1
        ([{"raw_clip_id": None, "uploaded_filename": "a.mp4"}], 1),
        ([{"raw_clip_id": None, "uploaded_filename": "a.mp4"},
          {"raw_clip_id": None, "uploaded_filename": "b.mp4"}], 2),
        ([], 0),
    ],
)
def test_archive_clip_identity_count(clips, expected):
    assert census.count_archive_clip_identities({"working_clips": clips}) == expected


def _fake_paginator(pages):
    paginator = MagicMock()
    paginator.paginate.return_value = pages
    return paginator


def _mock_r2_client(profile_db_bytes, archive_bytes):
    """Client that lists one profile + one multi-clip archive and 'downloads' by
    writing the seeded bytes to the requested destination path."""
    client = MagicMock()
    prefix = "dev/users/u-1/profiles/p-1"
    pages = [
        {"Contents": [
            {"Key": f"{prefix}/profile.sqlite"},
            {"Key": f"{prefix}/archive/4.msgpack"},
        ]},
    ]
    client.get_paginator.return_value = _fake_paginator(pages)

    def _download_file(bucket, key, dest):
        data = profile_db_bytes if key.endswith("profile.sqlite") else archive_bytes
        with open(dest, "wb") as fh:
            fh.write(data)

    client.download_file.side_effect = _download_file
    return client


def test_run_census_never_writes_r2_and_uses_readonly(tmp_path, monkeypatch):
    # Seed a profile DB and a multi-clip archive.
    db = tmp_path / "seed.sqlite"
    _seed_profile_db(db)
    profile_bytes = db.read_bytes()
    archive_bytes = msgpack.packb(
        {"working_clips": [{"raw_clip_id": 1}, {"raw_clip_id": 2}]}, use_bin_type=True
    )
    client = _mock_r2_client(profile_bytes, archive_bytes)

    # Spy on sqlite3.connect INSIDE the census module to prove every open is mode=ro.
    seen_uris = []
    real_connect = census.sqlite3.connect

    def _spy_connect(target, *args, **kwargs):
        seen_uris.append(target)
        return real_connect(target, *args, **kwargs)

    monkeypatch.setattr(census.sqlite3, "connect", _spy_connect)

    config = {"R2_BUCKET": "test-bucket"}
    report = census.run_census("dev", config, client)

    # Every sqlite connection the script opened was read-only.
    assert seen_uris, "expected at least one sqlite connection"
    for uri in seen_uris:
        assert "mode=ro" in uri, f"non-read-only connection opened: {uri}"

    # The R2 client was never asked to write/upload/delete anything.
    for method in census.R2_WRITE_METHODS:
        getattr(client, method).assert_not_called()

    # Bucket attribution rolled up to the single user.
    user = report["per_user"]["u-1"]
    assert user["b1_published"] == 1
    assert user["b1_rendered_not_published"] == 1
    assert user["b1_framing_only_draft"] == 1
    assert user["b1_archived"] == 1
    assert user["b2_single_clip_manual_reels"] == 1
    assert user["b3_published_multiclip_finals"] == 2
    assert user["b4_archived_multiclip_projects"] == 1  # archive had 2 identities
    # Postgres bucket skipped on dev.
    assert report["postgres"] is None
    assert report["profiles_read"] == 1
    assert report["archives_scanned"] == 1


def test_open_ro_refuses_writes(tmp_path):
    db = tmp_path / "profile.sqlite"
    _seed_profile_db(db)
    conn = census.open_ro(db)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("INSERT INTO raw_clips (id, end_time) VALUES (999, 9.0)")
    finally:
        conn.close()


def test_empty_walk_halts_loudly(tmp_path):
    client = MagicMock()
    client.get_paginator.return_value = _fake_paginator([{"Contents": []}])
    with pytest.raises(SystemExit):
        census.run_census("dev", {"R2_BUCKET": "b"}, client)
