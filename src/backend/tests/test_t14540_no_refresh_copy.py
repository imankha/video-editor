"""T14540: no message the server sends tells the user to refresh or reload.

The UI updates on change events. test_t14540_server_error_copy.py checks detail and
dict values; a default inside .get("message", "...") slipped past it, so this scans
every string constant in app/ except docstrings, log calls, admin and migrations.
"""
import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
MULTI_CLIP = APP / "routers" / "export" / "multi_clip.py"
CONNECTION_LOST = (
    "We lost the connection. Your highlight may still be on its way; check Finished in a minute."
)
ASKS_TO_REFRESH = re.compile(r"\b(refresh|reload)(ing)?\b(?![_-])", re.IGNORECASE)
LOG_METHODS = {"debug", "info", "warning", "error", "critical", "exception"}
# Schema text and URL paths, never shown to a user.
NOT_COPY = re.compile(r"CREATE TABLE|^/\{")


def _shown_strings(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if isinstance(parents.get(node), ast.Expr):
            continue
        ancestor, in_log = parents.get(node), False
        while ancestor is not None:
            if (isinstance(ancestor, ast.Call) and isinstance(ancestor.func, ast.Attribute)
                    and ancestor.func.attr in LOG_METHODS):
                in_log = True
            ancestor = parents.get(ancestor)
        if not in_log:
            yield node


def test_multi_clip_connection_lost_message_has_no_refresh():
    strings = [node.value for node in _shown_strings(MULTI_CLIP)]
    assert not [s for s in strings if "Refresh" in s]
    assert CONNECTION_LOST in strings


def test_no_server_string_asks_the_user_to_refresh_or_reload():
    offenders = []
    for path in APP.rglob("*.py"):
        if "admin" in path.name or "migrations" in path.parts:
            continue
        for node in _shown_strings(path):
            if ASKS_TO_REFRESH.search(node.value) and not NOT_COPY.search(node.value):
                offenders.append(f"{path.relative_to(APP)}:{node.lineno}: {node.value}")
    assert offenders == []
