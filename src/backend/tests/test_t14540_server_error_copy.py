"""T14540: server text a parent can read must use plain words.

The frontend shows `detail`, `detail.message`, `message` and progress `message`
strings verbatim (utils/userError.js plainServerDetail, exportProgressLabel's last
resort), so a backend string naming R2, BLAKE3, a "project" or an exception reaches a
parent as written. The scan below walks the AST rather than grepping `detail=`: error
text also leaves through positional HTTPException args, JSONResponse bodies and plain
progress dicts.

Out of scope: operator-only routers, dev/test seams and the Stripe webhook, none of
which a parent's browser ever reads.
"""
import ast
import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from tests import test_t8180_ghost_clip_save as ghost_harness
from tests.test_t8180_ghost_clip_save import _client

ghost_env = ghost_harness.ghost_env

APP = Path(__file__).resolve().parent.parent / "app"

# Admin/dev-only surfaces (task file: "Admin-only endpoints are out of scope").
SKIP_FILES = {"admin.py", "_debug.py", "dev_accounts.py", "qa.py", "test_seams.py"}

SCANNED = sorted(
    p for p in (
        *(APP / "routers").rglob("*.py"),
        APP / "main.py",
        APP / "middleware" / "db_sync.py",
        APP / "services" / "export_helpers.py",
        APP / "services" / "progress_reporter.py",
    ) if p.name not in SKIP_FILES
)

# Functions whose raises exist only for dev/test tooling or Stripe, never a parent.
SKIP_FUNCTIONS = {
    "stripe_webhook",  # read by Stripe
    "test_login", "dev_login", "invalidate_sessions",  # dev/test seams
    "global_exception_handler",  # the exception text sits behind IS_DEV
    "debug_modal_tasks",  # operator debug endpoint
}

BANNED = re.compile(
    r"\b(R2|BLAKE3|moov|Modal|GPU|CUDA|JSON|migrations?|projects?|raw clips?|working clips?"
    r"|working video|(?<!highlight )reels?|clips?|exports?|generation|presigned|multipart"
    r"|metadata|refresh|upgrad\w+|footage|moment|poster|draft|recap|backfill"
    r"|Failed to|Could not|Cannot|[a-z]+_[a-z_]+)\b"
    r"|\u2014| -- ",
    re.IGNORECASE,
)
# Names that hold a caught exception or its text; interpolating one leaks it verbatim.
EXCEPTION_NAMES = {"e", "exc", "err", "error", "error_msg", "error_str", "failure_message"}

TEXT_KEYS = {"detail", "message", "error"}
# `user_error` holds the text multi_clip sends as both `message` and an HTTP detail.
TEXT_VARIABLES = {"user_error"}
MACHINE_CODE = re.compile(r"^[a-z0-9_]+$")


def _literal_parts(node):
    """Static text of a str/f-string node, or None for any other node."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(
            v.value if isinstance(v, ast.Constant) else "{}" for v in node.values
        )
    return None


def _interpolates_exception(node):
    if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "str":
        return any(getattr(a, "id", "") in EXCEPTION_NAMES for a in node.args)
    # detail=result.get("error", ...) forwards whatever a worker reported.
    if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "get":
        return any(getattr(a, "value", None) == "error" for a in node.args)
    if not isinstance(node, ast.JoinedStr):
        return False
    return any(
        isinstance(v, ast.FormattedValue) and getattr(v.value, "id", "") in EXCEPTION_NAMES
        for v in node.values
    )


def _text_nodes(tree):
    """Yield (node) for every expression that can reach a parent as text."""
    skip = set()
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and fn.name in SKIP_FUNCTIONS:
            skip.update(id(n) for n in ast.walk(fn))

    for node in ast.walk(tree):
        if id(node) in skip:
            continue
        if isinstance(node, ast.Call):
            name = getattr(node.func, "id", getattr(node.func, "attr", ""))
            if name == "HTTPException":
                if len(node.args) > 1:
                    yield node.args[1]
                yield from (k.value for k in node.keywords if k.arg == "detail")
            elif name == "make_progress_data":
                yield from (k.value for k in node.keywords if k.arg == "message")
        elif isinstance(node, ast.Assign):
            if any(getattr(t, "id", "") in TEXT_VARIABLES for t in node.targets):
                yield node.value
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=True):
                # A dict forwarding job.get("error") is the stored failure, which the
                # frontend never shows (exportFailureCopy); only HTTP details are read.
                forwarded = isinstance(value, ast.Call) and getattr(value.func, "attr", "") == "get"
                if isinstance(key, ast.Constant) and key.value in TEXT_KEYS and not forwarded:
                    yield value


def _violations():
    found = []
    for path in SCANNED:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in _text_nodes(tree):
            where = f"{path.relative_to(APP)}:{node.lineno}"
            if _interpolates_exception(node):
                found.append(f"{where} interpolates an exception")
                continue
            text = _literal_parts(node)
            if text is None or MACHINE_CODE.match(text):
                continue
            hit = BANNED.search(text)
            if hit:
                found.append(f"{where} [{hit.group(0)}] {text!r}")
    return found


def test_no_server_text_names_internals_or_exceptions():
    found = _violations()
    assert not found, f"{len(found)} strings a parent can read:\n" + "\n".join(found)


# ---------------------------------------------------------------------------
# Through the real routes and handlers: what the response body actually says.
# ---------------------------------------------------------------------------

def _seed_project_with_working_video():
    from app.database import get_db_connection
    from tests.test_t8180_ghost_clip_save import _ctx

    _ctx()
    with get_db_connection() as conn:
        project_id = conn.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('Goal', '9:16')"
        ).lastrowid
        video_id = conn.execute(
            "INSERT INTO working_videos (project_id, filename, version) VALUES (?, 'w.mp4', 1)",
            (project_id,),
        ).lastrowid
        conn.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (video_id, project_id))
        conn.commit()
    return project_id


@pytest.mark.asyncio
async def test_storage_failure_reads_plainly(ghost_env):
    """A storage URL failure used to reach the parent as 'Failed to generate R2 URL'."""
    app, _base, _game_id = ghost_env
    project_id = _seed_project_with_working_video()

    with patch("app.routers.projects.R2_ENABLED", True), \
         patch("app.routers.projects._generate_working_video_presigned_url", return_value=None):
        async with _client(app) as c:
            resp = await c.get(f"/api/projects/{project_id}/working-video")

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "We couldn't load this video. Try again."


@pytest.mark.asyncio
async def test_missing_project_reads_as_a_highlight(ghost_env):
    app, _base, _game_id = ghost_env
    async with _client(app) as c:
        resp = await c.get("/api/projects/999999/working-video")

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "We couldn't find that highlight."


@pytest.mark.asyncio
async def test_missing_game_reads_plainly(ghost_env):
    app, _base, _game_id = ghost_env
    async with _client(app) as c:
        resp = await c.post("/api/clips/raw/save", json={
            "game_id": 999999, "start_time": 2.0, "end_time": 5.0,
            "name": "Ghost", "rating": 5, "video_sequence": 1,
        })

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "We couldn't find that game."


@pytest.mark.asyncio
async def test_pending_migration_says_one_phrase_and_keeps_its_code():
    """The frontend retries on the code, so the code must survive the rewording."""
    from app.main import migration_blocked_handler
    from app.migrations import MigrationBlocked

    resp = await migration_blocked_handler(None, MigrationBlocked("u", "p", "wal_busy"))

    assert resp.status_code == 503
    assert json.loads(resp.body) == {
        "detail": "We're updating your account. Try again in a minute.",
        "code": "pending_migration",
    }
