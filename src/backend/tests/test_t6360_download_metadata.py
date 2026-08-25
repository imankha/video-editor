"""T6360: serve-time metadata + cover-art stamping for downloaded reels.

Covers the `download_metadata` service in isolation (the router wiring is exercised
by the existing downloads/shares/collections suites, which now pass `coll_meta`/
`dl_meta` through the same compose path). The invariants pinned here:

  - Every tag is written and reads back correctly via ffprobe.
  - The cover art lands as an `attached_pic` stream, disposition set, and it does
    NOT add a second SELECTABLE video stream (still exactly one real video).
  - `+faststart` is preserved (moov before mdat).
  - The real video stream is BYTE-IDENTICAL (stream copy proven by hashing the
    video packets, not the container).
  - Poster-absent path: tags stamped, no cover, clean skip.
  - ffmpeg-failure path: `stamp_download_metadata` returns False and the caller
    ships the unstamped input (never a broken/missing file).
  - The input object is never mutated (serve-time only).
  - `build_download_metadata` omits absent fields (no guessed date).
"""

import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import download_metadata as dm

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for metadata-stamping tests",
)


# --------------------------------------------------------------------------- #
# fixtures / helpers
# --------------------------------------------------------------------------- #

def _make_clip(path: Path, w: int = 480, h: int = 852, duration: float = 1.0):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"testsrc=size={w}x{h}:rate=30:duration={duration}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
            "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", str(path),
        ],
        capture_output=True, check=True,
    )


def _make_poster(path: Path, w: int = 480, h: int = 852):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=red:s={w}x{h}:d=1",
            "-frames:v", "1", "-q:v", "3", str(path),
        ],
        capture_output=True, check=True,
    )


def _ffprobe_json(path: Path, *entries: str) -> dict:
    import json
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def _video_stream_md5(path: Path) -> str:
    """MD5 of the DECODED-COPY video packets ONLY (not the container), so a
    metadata/cover change that leaves the video stream copied byte-for-byte
    produces an identical hash."""
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(path),
            "-map", "0:v:0", "-c", "copy", "-f", "md5", "-",
        ],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


@pytest.fixture
def reel(tmp_path):
    p = tmp_path / "reel.mp4"
    _make_clip(p)
    return p


@pytest.fixture
def poster(tmp_path):
    p = tmp_path / "poster.jpg"
    _make_poster(p)
    return p


FULL_META = {
    "tags": {
        "title": "Vs Sharks Dec 6",
        "artist": "Marcus Johnson",
        "album_artist": "Marcus Johnson",
        "album": "Vs Sharks Dec 6",
        "date": "2025-12-06",
        "creation_time": "2025-12-06T12:00:00Z",
        "comment": "Vs Sharks Dec 6 - dribble, goal",
        "copyright": dm.BRAND_ATTRIBUTION,
        "genre": "Sports",
    },
    "cover_path": None,
}


# --------------------------------------------------------------------------- #
# 1. Full stamp: tags + cover art
# --------------------------------------------------------------------------- #

def test_stamp_writes_every_tag_and_cover_art(tmp_path, reel, poster):
    out = tmp_path / "stamped.mp4"
    meta = {**FULL_META, "cover_path": str(poster)}

    assert dm.stamp_download_metadata(str(reel), str(out), meta) is True
    assert out.exists() and out.stat().st_size > 0

    probe = _ffprobe_json(out)
    tags = {k.lower(): v for k, v in (probe["format"].get("tags") or {}).items()}
    assert tags.get("title") == "Vs Sharks Dec 6"
    assert tags.get("artist") == "Marcus Johnson"
    assert tags.get("album") == "Vs Sharks Dec 6"
    assert tags.get("date", "").startswith("2025-12-06")
    assert tags.get("genre") == "Sports"
    assert "ReelBallers" in tags.get("copyright", "")

    video_streams = [s for s in probe["streams"] if s["codec_type"] == "video"]
    real_video = [s for s in video_streams
                  if s.get("disposition", {}).get("attached_pic", 0) == 0]
    cover = [s for s in video_streams
             if s.get("disposition", {}).get("attached_pic", 0) == 1]
    assert len(real_video) == 1, "must remain exactly one real (selectable) video stream"
    assert len(cover) == 1, "cover art must be present as an attached_pic stream"


def test_stamp_preserves_faststart(tmp_path, reel, poster):
    """moov atom must precede mdat (instant playback/scrub) after stamping."""
    out = tmp_path / "stamped.mp4"
    meta = {**FULL_META, "cover_path": str(poster)}
    assert dm.stamp_download_metadata(str(reel), str(out), meta) is True

    data = out.read_bytes()
    assert data.find(b"moov") < data.find(b"mdat"), "faststart (+movflags) not preserved"


def test_stamp_video_stream_byte_identical(tmp_path, reel, poster):
    """The stream copy must leave the real video packets untouched."""
    before = _video_stream_md5(reel)
    out = tmp_path / "stamped.mp4"
    meta = {**FULL_META, "cover_path": str(poster)}
    assert dm.stamp_download_metadata(str(reel), str(out), meta) is True
    after = _video_stream_md5(out)
    assert before == after, "video stream must be byte-identical (stream copy)"


# --------------------------------------------------------------------------- #
# 2. Poster-absent path
# --------------------------------------------------------------------------- #

def test_stamp_without_cover_writes_tags_only(tmp_path, reel):
    out = tmp_path / "stamped.mp4"
    assert dm.stamp_download_metadata(str(reel), str(out), FULL_META) is True

    probe = _ffprobe_json(out)
    tags = {k.lower(): v for k, v in (probe["format"].get("tags") or {}).items()}
    assert tags.get("title") == "Vs Sharks Dec 6"

    cover = [s for s in probe["streams"]
             if s["codec_type"] == "video"
             and s.get("disposition", {}).get("attached_pic", 0) == 1]
    assert cover == [], "no cover art when poster absent (never fabricated)"


def test_stamp_with_missing_cover_file_still_stamps_tags(tmp_path, reel):
    """A cover_path that doesn't exist on disk is treated as absent, not fatal."""
    out = tmp_path / "stamped.mp4"
    meta = {**FULL_META, "cover_path": str(tmp_path / "does-not-exist.jpg")}
    assert dm.stamp_download_metadata(str(reel), str(out), meta) is True
    probe = _ffprobe_json(out)
    assert (probe["format"].get("tags") or {}).get("title") == "Vs Sharks Dec 6"


# --------------------------------------------------------------------------- #
# 3. Failure path: ships the unstamped file
# --------------------------------------------------------------------------- #

def test_stamp_failure_returns_false_and_leaves_input_untouched(tmp_path):
    """An unreadable input makes ffmpeg fail; stamp returns False so the caller
    ships the (unchanged) input rather than a broken/missing file."""
    bogus = tmp_path / "not-a-video.mp4"
    bogus.write_bytes(b"this is not an mp4")
    before = bogus.read_bytes()
    out = tmp_path / "stamped.mp4"

    assert dm.stamp_download_metadata(str(bogus), str(out), FULL_META) is False
    assert bogus.read_bytes() == before, "input object must never be mutated"


def test_apply_download_metadata_falls_back_to_input_on_failure(tmp_path):
    bogus = tmp_path / "not-a-video.mp4"
    bogus.write_bytes(b"nope")
    result = dm.apply_download_metadata(str(bogus), str(tmp_path), FULL_META)
    assert result == str(bogus), "on failure, stream the unstamped input path"


def test_apply_download_metadata_returns_stamped_path_on_success(tmp_path, reel):
    result = dm.apply_download_metadata(str(reel), str(tmp_path), FULL_META)
    assert result != str(reel)
    assert Path(result).exists()


def test_stamp_leaves_source_object_untouched(tmp_path, reel, poster):
    """Serve-time only: stamping reads the reel and writes a NEW file; the source
    reel bytes are unchanged (no stored-object mutation)."""
    before = reel.read_bytes()
    out = tmp_path / "stamped.mp4"
    meta = {**FULL_META, "cover_path": str(poster)}
    assert dm.stamp_download_metadata(str(reel), str(out), meta) is True
    assert reel.read_bytes() == before


def test_stamp_noop_when_no_tags_and_no_cover(tmp_path, reel):
    out = tmp_path / "stamped.mp4"
    assert dm.stamp_download_metadata(str(reel), str(out), {"tags": {}, "cover_path": None}) is False
    assert not out.exists()


# --------------------------------------------------------------------------- #
# 4. build_download_metadata field assembly (no DB — a fake conn)
# --------------------------------------------------------------------------- #

class _FakeCursor:
    def __init__(self, fv_row, game_row):
        self._fv_row = fv_row
        self._game_row = game_row
        self._last = None

    def execute(self, sql, params=None):
        self._last = "games" if "FROM games" in sql else "final_videos"
        return self

    def fetchone(self):
        return self._game_row if self._last == "games" else self._fv_row


class _FakeConn:
    def __init__(self, fv_row, game_row):
        self._cur = _FakeCursor(fv_row, game_row)

    def cursor(self):
        return self._cur


def _row(d):
    """dict that also supports row['col'] AND is truthy like a sqlite3.Row."""
    return d


def test_build_metadata_omits_date_when_game_date_absent(monkeypatch):
    # column_exists -> True; athlete name -> known; game has NO date.
    monkeypatch.setattr(dm, "_athlete_name", lambda u, p: "Marcus Johnson")
    import app.database as database
    monkeypatch.setattr(database, "column_exists", lambda *a, **k: True)
    monkeypatch.setattr(
        "app.routers.downloads._generate_game_display_name",
        lambda *a, **k: "Vs Sharks",
    )
    fv_row = _row({
        "name": "My Reel", "filename": "reel_final_abc.mp4",
        "game_id": 7, "tags": None, "poster_filename": "reel_final_abc.mp4.jpg",
    })
    game_row = _row({
        "name": "g", "game_date": None, "opponent_name": "Sharks",
        "game_type": "home", "tournament_name": None,
    })
    conn = _FakeConn(fv_row, game_row)

    meta = dm.build_download_metadata(conn, 42, "user-1", "prof-1")
    tags = meta["tags"]
    assert tags["title"] == "My Reel"
    assert tags["artist"] == "Marcus Johnson"
    assert tags["album"] == "Vs Sharks"
    assert "date" not in tags, "absent game date must be omitted, never guessed"
    assert "creation_time" not in tags
    assert meta["poster_basename"] == "reel_final_abc.mp4.jpg"
    # constant attribution always present
    assert tags["copyright"] == dm.BRAND_ATTRIBUTION
    assert tags["genre"] == "Sports"


def test_build_metadata_writes_date_when_present(monkeypatch):
    monkeypatch.setattr(dm, "_athlete_name", lambda u, p: None)
    import app.database as database
    monkeypatch.setattr(database, "column_exists", lambda *a, **k: True)
    monkeypatch.setattr(
        "app.routers.downloads._generate_game_display_name",
        lambda *a, **k: "Vs Sharks Dec 6",
    )
    fv_row = _row({
        "name": "My Reel", "filename": "r.mp4", "game_id": 7,
        "tags": None, "poster_filename": None,
    })
    game_row = _row({
        "name": "g", "game_date": "2025-12-06", "opponent_name": "Sharks",
        "game_type": "home", "tournament_name": None,
    })
    meta = dm.build_download_metadata(_FakeConn(fv_row, game_row), 1, "u", "p")
    tags = meta["tags"]
    assert tags["date"] == "2025-12-06"
    assert tags["creation_time"] == "2025-12-06T12:00:00Z"
    assert "artist" not in tags, "no athlete name -> artist omitted"
    assert meta["poster_basename"] is None


def test_build_collection_metadata_scope_and_attribution(monkeypatch):
    monkeypatch.setattr(dm, "_athlete_name", lambda u, p: "Marcus Johnson")
    meta = dm.build_collection_metadata("game", None, "u", "p")
    tags = meta["tags"]
    assert tags["title"] == "Game Highlights"
    assert tags["album"] == "Game Highlights"
    assert tags["artist"] == "Marcus Johnson"
    assert tags["genre"] == "Sports"
    assert meta["cover_path"] is None
    assert meta["poster_basename"] is None

    tag_meta = dm.build_collection_metadata("tags", ["Dig"], "u", "p")
    assert tag_meta["tags"]["title"] == "Dig Highlights"
