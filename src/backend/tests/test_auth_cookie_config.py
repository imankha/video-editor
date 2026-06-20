"""
T1270 / T1330: Verify all `rb_session` cookie operations include `path="/"` and
use `samesite="lax"` (or the cross-site `none` variant in secure mode).

Cookie writes were centralized into the `app.utils.cookies` helper
(`set_cookie` / `delete_cookie`), so every call site in `app/routers/auth.py`
goes through that wrapper as `_set_cookie(response, "rb_session", ...)` /
`_delete_cookie(response, "rb_session")` rather than `response.set_cookie(...)`.
The wrapper -- not the call site -- enforces `Path=/` and the SameSite value.

This module therefore:
- AST-inspects `auth.py` to confirm the rb_session wrapper call sites exist.
- AST-inspects `app/utils/cookies.py` to confirm the helper enforces Path=/
  and a samesite-lax (or none) value for every Set-Cookie it builds.

Failure modes guarded against:
- a cookie path other than "/" — cookie gets scoped to the request path and
  may not be sent on other routes.
- samesite="strict" — "lax" (or "none" cross-site) is the correct default for
  our first-party auth flow.
"""
import ast
from pathlib import Path

import pytest

AUTH_PY = Path(__file__).resolve().parents[1] / "app" / "routers" / "auth.py"
COOKIES_PY = Path(__file__).resolve().parents[1] / "app" / "utils" / "cookies.py"


def _kwargs(call: ast.Call) -> dict:
    return {kw.arg: kw.value for kw in call.keywords if kw.arg is not None}


def _is_rb_session_cookie_call(call: ast.Call) -> bool:
    """True if this is a {set,delete}_cookie call for rb_session.

    Matches both the legacy `response.set_cookie("rb_session", ...)` attribute
    form and the current wrapper form `_set_cookie(response, "rb_session", ...)`
    from app.utils.cookies.
    """
    if isinstance(call.func, ast.Attribute):
        if call.func.attr not in ("set_cookie", "delete_cookie"):
            return False
        # response.set_cookie(key, ...) -- key is first positional or key=
        candidate = call.args[0] if call.args else _kwargs(call).get("key")
    elif isinstance(call.func, ast.Name):
        if call.func.id not in (
            "set_cookie", "delete_cookie", "_set_cookie", "_delete_cookie",
        ):
            return False
        # _set_cookie(response, key, ...) -- key is the second positional arg
        candidate = call.args[1] if len(call.args) >= 2 else _kwargs(call).get("key")
    else:
        return False
    return isinstance(candidate, ast.Constant) and candidate.value == "rb_session"


def _collect_rb_session_calls() -> list[ast.Call]:
    tree = ast.parse(AUTH_PY.read_text(encoding="utf-8"))
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _is_rb_session_cookie_call(node):
            calls.append(node)
    return calls


def test_rb_session_calls_found():
    calls = _collect_rb_session_calls()
    # T1330: 1 set_cookie (shared `_issue_session_cookie` helper) +
    # 1 delete_cookie (logout) = 2 call sites.
    assert len(calls) >= 2, f"expected >=2 rb_session cookie calls, got {len(calls)}"


def _cookies_helper_func(name: str) -> ast.FunctionDef:
    """Return the AST FunctionDef for set_cookie/delete_cookie in cookies.py."""
    tree = ast.parse(COOKIES_PY.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found in {COOKIES_PY}")


def _helper_default(func: ast.FunctionDef, arg_name: str):
    """Resolve the default value of a keyword arg on a helper function."""
    args = func.args
    defaults = args.defaults
    # defaults align to the tail of args.args
    offset = len(args.args) - len(defaults)
    for idx, arg in enumerate(args.args):
        if arg.arg == arg_name and idx >= offset:
            default = defaults[idx - offset]
            if isinstance(default, ast.Constant):
                return default.value
    return None


def _helper_builds_setcookie_part(func: ast.FunctionDef, substring: str) -> bool:
    """True if the helper appends a Set-Cookie part containing `substring`
    (case-insensitive) as a string literal anywhere in its body."""
    for node in ast.walk(func):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if substring.lower() in node.value.lower():
                return True
        # f-string parts like f"Path={path}" -> JoinedStr with literal "Path="
        if isinstance(node, ast.JoinedStr):
            for v in node.values:
                if (isinstance(v, ast.Constant)
                        and isinstance(v.value, str)
                        and substring.lower() in v.value.lower()):
                    return True
    return False


def test_helper_enforces_path_root():
    """The centralized cookie helpers must default path to "/"."""
    for name in ("set_cookie", "delete_cookie"):
        func = _cookies_helper_func(name)
        assert _helper_default(func, "path") == "/", (
            f"app/utils/cookies.py::{name} must default path=\"/\""
        )
        assert _helper_builds_setcookie_part(func, "Path="), (
            f"app/utils/cookies.py::{name} must write a Path= attribute"
        )


def test_helper_uses_samesite_lax_or_none():
    """The centralized cookie helpers must use SameSite=Lax (first-party) or
    SameSite=None (cross-site secure mode) -- never Strict."""
    for name in ("set_cookie", "delete_cookie"):
        func = _cookies_helper_func(name)
        assert _helper_builds_setcookie_part(func, "SameSite=Lax") or \
            _helper_builds_setcookie_part(func, "SameSite=None"), (
            f"app/utils/cookies.py::{name} must use SameSite=Lax or None"
        )
        assert not _helper_builds_setcookie_part(func, "SameSite=Strict"), (
            f"app/utils/cookies.py::{name} must not use SameSite=Strict"
        )
