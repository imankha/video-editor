"""
T1270: Verify all `rb_session` cookie operations include `path="/"` and
use `samesite="lax"`.

This test uses AST inspection over `app/routers/auth.py` because it is the
most reliable way to cover every `set_cookie`/`delete_cookie` call site
without having to drive each endpoint (Google OAuth, OTP, test-login, etc.)
through TestClient.

Failure modes guarded against:
- set_cookie() without `path="/"` — cookie gets scoped to the request path
  and may not be sent on other routes.
- samesite="strict" or "none" — "lax" is the correct default for our
  first-party auth flow in all environments.
"""
import ast
from pathlib import Path

import pytest

AUTH_PY = Path(__file__).resolve().parents[1] / "app" / "routers" / "auth.py"


def _kwargs(call: ast.Call) -> dict:
    return {kw.arg: kw.value for kw in call.keywords if kw.arg is not None}


def _is_rb_session_cookie_call(call: ast.Call) -> bool:
    """True if this is a response.{set,delete}_cookie for rb_session."""
    if not isinstance(call.func, ast.Attribute):
        return False
    if call.func.attr not in ("set_cookie", "delete_cookie"):
        return False
    # first positional arg OR `key=`
    candidate = None
    if call.args:
        candidate = call.args[0]
    else:
        candidate = _kwargs(call).get("key")
    if isinstance(candidate, ast.Constant) and candidate.value == "rb_session":
        return True
    return False


def _collect_rb_session_calls() -> list[ast.Call]:
    tree = ast.parse(AUTH_PY.read_text(encoding="utf-8"))
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _is_rb_session_cookie_call(node):
            calls.append(node)
    return calls


def _samesite_value(call: ast.Call, module_constants: dict) -> str | None:
    """Resolve the samesite kwarg — either a literal or a Name referring to
    a module-level constant whose value is a literal."""
    kw = _kwargs(call)
    val = kw.get("samesite")
    if val is None:
        return None
    if isinstance(val, ast.Constant):
        return val.value
    if isinstance(val, ast.Name):
        return module_constants.get(val.id)
    return None


def _module_string_constants() -> dict:
    """Collect top-level `NAME = "literal"` assignments from auth.py."""
    tree = ast.parse(AUTH_PY.read_text(encoding="utf-8"))
    constants: dict = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and isinstance(node.value, ast.Constant):
                constants[target.id] = node.value.value
    return constants


def test_rb_session_calls_found():
    calls = _collect_rb_session_calls()
    # 4 set_cookie + 1 delete_cookie = 5 call sites as of T1270.
    assert len(calls) >= 4, f"expected >=4 rb_session cookie calls, got {len(calls)}"


def test_every_rb_session_call_has_path_root():
    calls = _collect_rb_session_calls()
    offenders = []
    for call in calls:
        kw = _kwargs(call)
        path_val = kw.get("path")
        if not (isinstance(path_val, ast.Constant) and path_val.value == "/"):
            offenders.append(call.lineno)
    assert not offenders, (
        f"rb_session cookie call(s) missing path=\"/\" at auth.py lines: {offenders}"
    )


def test_every_rb_session_call_uses_samesite_lax():
    calls = _collect_rb_session_calls()
    constants = _module_string_constants()
    offenders = []
    for call in calls:
        val = _samesite_value(call, constants)
        if val != "lax":
            offenders.append((call.lineno, val))
    assert not offenders, (
        f"rb_session cookie call(s) not using samesite=\"lax\": {offenders}"
    )
