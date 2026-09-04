"""
Regression test for T8680: env vars read at `app.*` module import time (e.g.
app.storage.R2_ENABLED) must see `load_dotenv()` results, never the bare OS
default. Reproduced live: app.migrations -> profile_db migration RUNNER ->
v023_repair_sourceless_active_games -> app.storage, all transitively imported
by `from app.migrations import ...` in main.py. When that import ran before
load_dotenv(), app.storage's module-level `os.getenv("R2_ENABLED", "false")`
froze to False for the process's whole life regardless of .env, and every R2
upload failed with "R2 storage not enabled" even with R2_ENABLED=true in .env.

A subprocess-based functional test would need .env to exist identically in
CI, which isn't guaranteed (it's environment-local). This test instead pins
the actual invariant that prevents the bug: load_dotenv() must run before any
`app.*` import in main.py, so no transitively-imported module can read
os.environ before the .env file has been loaded into it.
"""

import ast
from pathlib import Path

MAIN_PY = Path(__file__).parent.parent / "app" / "main.py"


def _line_of_first_match(tree, predicate):
    for node in ast.walk(tree):
        if predicate(node):
            return node.lineno
    return None


class TestLoadDotenvRunsBeforeAppImports:
    def test_load_dotenv_call_precedes_every_app_star_import(self):
        source = MAIN_PY.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(MAIN_PY))

        load_dotenv_line = _line_of_first_match(
            tree,
            lambda n: isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "load_dotenv",
        )
        assert load_dotenv_line is not None, "main.py must call load_dotenv()"

        app_import_lines = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            and node.module
            and (node.module == "app" or node.module.startswith("app."))
        ]
        assert app_import_lines, "expected at least one `from app...` import in main.py"

        earliest_app_import = min(app_import_lines)
        assert load_dotenv_line < earliest_app_import, (
            f"load_dotenv() (line {load_dotenv_line}) must run before the first "
            f"`from app...` import (line {earliest_app_import}) -- otherwise a "
            "transitively-imported module's module-level os.getenv() reads the "
            "pre-.env default and freezes it for the process's whole life "
            "(T8680: this exact chain froze R2_ENABLED to False)."
        )
