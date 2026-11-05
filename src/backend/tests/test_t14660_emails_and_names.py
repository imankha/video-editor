"""T14660: emails, server-made names and download file names follow the glossary.

Emails are driven through the real send functions down to the Resend HTTP call (only the
network transport is faked), so the assertions read the subject and rendered HTML a
recipient would get. Nothing is sent.
"""
import asyncio
import re
import sqlite3
from unittest.mock import patch

import pytest

from app import queries
from app.routers import clips as clips_router
from app.routers.collections import (
    TOP_PLAYS,
    CollectionDefinition,
    _build_collection_title,
    _collection_download_filename,
)
from app.routers.downloads import generate_download_filename
from app.services import download_metadata, email

NAME = "Sam Lee"
GAME = "Vs Rangers Mar 3"
RETIRED = re.compile(
    r"\bannotat\w*|\bfootage\b|\bfilm\b|\bcollection\b|\bclips?\b|\brecap\b|\bsoccer parents\b"
    r"|\btagged\b|(?-i:View Game|Watch Highlight|Start Making)| -- ",
    re.IGNORECASE,
)


class _Response:
    status_code = 200
    text = "{}"

    def raise_for_status(self):
        return None

    def json(self):
        return {"id": "email-1"}


class _Client:
    """Stands in for httpx.AsyncClient and records the Resend payload."""

    sent: list[dict] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        _Client.sent.append(kwargs["json"])
        return _Response()


def _render(send, *args, **kwargs) -> dict:
    """Run one send function and return the payload Resend would have received."""
    _Client.sent = []
    with patch.object(email.httpx, "AsyncClient", _Client), \
         patch.dict("os.environ", {"RESEND_API_KEY": "test-key"}):
        assert asyncio.run(send(*args, **kwargs)) is True
    assert len(_Client.sent) == 1
    return _Client.sent[0]


def _visible(html: str) -> str:
    """The words a reader sees: tags and the style block removed, entities decoded."""
    text = re.sub(r"<[^>]+>", " ", html).replace("&#x27;", "'").replace("&#39;", "'")
    return re.sub(r"\s+", " ", text)


def _share_email(kind: str, first_touch: bool) -> dict:
    common = {"sender_name": NAME, "is_first_touch": first_touch}
    if kind == "highlight":
        return _render(email.send_share_email, "to@x.com", "s@x.com", "tok", "Top goal", **common)
    if kind == "reel":
        return _render(email.send_collection_share_email, "to@x.com", "s@x.com", "tok",
                       "Spring goals", **common)
    if kind == "game":
        return _render(email.send_game_share_email, "to@x.com", "s@x.com", GAME, "tok", **common)
    if kind == "plays":
        return _render(email.send_playback_share_email, "to@x.com", "s@x.com", GAME, "tok", **common)
    return _render(email.send_teammate_share_email, "to@x.com", "s@x.com", "Maya", GAME, 3, "tok",
                   **common)


# kind -> (first-touch subject, sentence in the heading and footer, CTA)
SCHEME = {
    "highlight": (f"{NAME} shared a highlight with you",
                  f"{NAME} shared a highlight with you", "Watch highlight"),
    "reel": (f"{NAME} shared a highlight reel with you",
             f"{NAME} shared a highlight reel with you", "Watch highlight reel"),
    "game": (f"{NAME} shared a game with you", f"{NAME} shared a game with you", "Watch game"),
    "plays": (f"{NAME} shared the plays they marked from {GAME}",
              f"{NAME} shared the plays they marked from", "Watch plays"),
    "teammate": (f"{NAME} shared 3 plays of Maya from {GAME}",
                 f"{NAME} shared 3 plays of Maya from", "Watch plays"),
}


class TestShareEmails:
    @pytest.mark.parametrize("kind", SCHEME)
    def test_first_touch_subject_heading_and_cta_use_one_noun(self, kind):
        subject, sentence, cta = SCHEME[kind]
        sent = _share_email(kind, first_touch=True)
        text = _visible(sent["html"])
        assert sent["subject"] == subject
        assert sentence in text
        assert f">{cta}</a>" in sent["html"]

    @pytest.mark.parametrize("kind", SCHEME)
    @pytest.mark.parametrize("first_touch", [True, False])
    def test_no_retired_word_reaches_the_reader(self, kind, first_touch):
        sent = _share_email(kind, first_touch)
        assert not RETIRED.search(sent["subject"]), sent["subject"]
        found = RETIRED.findall(_visible(sent["html"]))
        assert not found, found

    @pytest.mark.parametrize("kind,noun", [
        ("highlight", "a highlight"), ("reel", "a highlight reel"), ("game", "a game"),
        ("plays", "plays"), ("teammate", "plays"),
    ])
    def test_footer_repeats_the_noun(self, kind, noun):
        text = _visible(_share_email(kind, first_touch=True)["html"])
        assert f"{NAME} shared {noun} with you" in text

    def test_later_shares_read_as_a_person_not_a_machine(self):
        assert _share_email("highlight", False)["subject"] == f"{NAME} shared another highlight: Top goal"
        assert _share_email("reel", False)["subject"] == f"{NAME} shared another highlight reel: Spring goals"

    def test_one_shared_play_is_singular(self):
        sent = _render(email.send_teammate_share_email, "to@x.com", "s@x.com", "Maya", GAME, 1, "tok",
                       sender_name=NAME, is_first_touch=True)
        assert sent["subject"] == f"{NAME} shared 1 play of Maya from {GAME}"

    def test_first_touch_footer_names_every_sport(self):
        assert "helps sports parents" in _visible(_share_email("highlight", True)["html"])


class TestGameReadyAndWelcome:
    def test_game_ready_points_at_marking_plays(self):
        sent = _render(email.send_game_ready_email, "to@x.com", GAME, 7, "p1")
        assert sent["subject"] == "Your game is ready: start marking plays"
        assert ">Mark plays</a>" in sent["html"]
        assert "making highlights" not in _visible(sent["html"]).lower()
        assert " - " not in _visible(sent["html"]).split("Sent via")[0]

    def test_welcome_says_game_video(self):
        body = email.welcome_email_body()
        assert "game video" in body
        assert "game film" not in body


class TestDefaultNames:
    def test_unnamed_game_reads_its_date_not_its_id(self):
        assert queries.default_game_name("2026-03-06") == "Game on Mar 6"

    def test_unnamed_game_without_a_date(self):
        assert queries.default_game_name(None) == "Untitled game"

    def test_unnamed_shared_play_reads_its_time(self):
        clip = {"name": None, "tags": None, "notes": None, "start_time": 125.4}
        assert clips_router._shared_play_name(clip) == "Play at 2:05"

    def test_named_shared_play_keeps_its_name(self):
        clip = {"name": "Top bin", "tags": None, "notes": None, "start_time": 125.4}
        assert clips_router._shared_play_name(clip) == "Top bin"

    def test_smart_collection_is_my_highlights(self):
        assert TOP_PLAYS["name"] == "My highlights"
        assert TOP_PLAYS["key"] == "top_plays"


class _Cursor:
    def __init__(self, row):
        self.row = row

    def execute(self, *args):
        return self

    def fetchone(self):
        return self.row


class _Conn:
    def __init__(self, row=None):
        self.row = row

    def cursor(self):
        return _Cursor(self.row)


def _title(scope: dict, row=None, tags=None, budget=None) -> str:
    definition = CollectionDefinition(
        scope=scope, filter={"tags": tags}, aspect_ratio="9:16", budget_sec=budget,
    )
    return _build_collection_title(_Conn(row), definition)


GAME_ROW = {"name": "Rangers", "game_date": "2026-03-06", "opponent_name": "Rangers",
            "game_type": "home", "tournament_name": None}


class TestCollectionTitles:
    def test_game_title(self):
        assert _title({"type": "game", "game_id": 4}, GAME_ROW) == "Vs Rangers Mar 6: highlights (Portrait)"

    def test_budget_sits_inside_the_brackets(self):
        got = _title({"type": "game", "game_id": 4}, GAME_ROW, budget=150)
        assert got == "Vs Rangers Mar 6: highlights (Portrait, 2:30)"

    def test_missing_game_does_not_expose_its_id(self):
        assert _title({"type": "game", "game_id": 4}, None) == "Untitled game: highlights (Portrait)"

    @pytest.mark.parametrize("scope", [{"type": "mixes"}, {"type": "all"}])
    def test_mixes_and_top_plays_are_my_highlights(self, scope):
        assert _title(scope) == "My highlights (Portrait)"

    def test_tag_title_keeps_its_name(self):
        assert _title({"type": "all"}, tags=["Goal"]) == "Top Goals (Portrait)"


class TestDownloadNames:
    @pytest.mark.parametrize("name", [None, "", "!!!"])
    def test_fallback_is_highlight(self, name):
        assert generate_download_filename(name) == "highlight_ReelBallers.mp4"

    @pytest.mark.parametrize("scope,tags,expected", [
        ("game", None, "Game_highlights_ReelBallers.mp4"),
        ("mixes", None, "My_highlights_ReelBallers.mp4"),
        ("all", None, "My_highlights_ReelBallers.mp4"),
        ("all", ["Goal", "Assist"], "Goal_Assist_highlights_ReelBallers.mp4"),
    ])
    def test_collection_file_uses_the_one_format(self, scope, tags, expected):
        assert _collection_download_filename(scope, tags) == expected

    def test_many_tags_stay_a_reasonable_length(self):
        name = _collection_download_filename("all", ["Tag"] * 60)
        assert len(name) <= 60 + len("_ReelBallers.mp4")

    @pytest.mark.parametrize("scope,tags,expected", [
        ("game", None, "Game highlights"),
        ("mixes", None, "My highlights"),
        ("all", None, "My highlights"),
        ("all", ["Dig"], "Dig highlights"),
    ])
    def test_embedded_title_matches(self, scope, tags, expected):
        assert download_metadata._collection_title(scope, tags) == expected


@pytest.fixture()
def profile_db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id("test-user-t14660")
    set_current_profile_id("testdefault")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


class TestProjectNameForUnnamedPlay:
    """A play with no tags, notes or time (start_time is nullable) has nothing to name it."""

    def _project_name(self, db_path, start_time):
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES ('p.mp4', 3, ?, 10)",
            (start_time,),
        )
        raw_clip_id = cur.lastrowid
        project_id = clips_router._create_auto_project_for_clip(cur, raw_clip_id, "")
        cur.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
        name = cur.fetchone()["name"]
        conn.close()
        return raw_clip_id, name

    def test_no_time_never_exposes_the_id(self, profile_db):
        raw_clip_id, name = self._project_name(profile_db, None)
        assert name == "Play"
        assert str(raw_clip_id) not in name

    def test_with_a_time_reads_the_time(self, profile_db):
        assert self._project_name(profile_db, 65.0)[1] == "Play at 1:05"
