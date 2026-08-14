"""T6920: the attached intro card was silently missing from every DOWNLOADED reel
on Fly (both owner `/downloads/{id}/file` and single-reel share download), while
in-app playback still showed it.

Root cause (verified live on staging): `intro_card_geometry.py` computed the
generated-JS-mirror target path at MODULE IMPORT TIME via
`Path(__file__).resolve().parents[4]`. In the repo checkout the module sits 5
levels below the repo root, so `parents[4]` resolves fine. In the deployed Fly
image (`Dockerfile`: `WORKDIR /app` + `COPY . .`) the module sits only 4 levels
below the image root, so `.parents` has just 4 entries (indices 0-3) and
`parents[4]` raised `IndexError: 4` -- on EVERY import, on EVERY Fly deploy, since
the line shipped (T5210). `player_intro.py` imports the geometry module at ITS
own import, and the burn egress (`serve_time_video._try_build_intro_card`)
imports `player_intro` lazily inside a non-fatal try/except (epic decision 9),
so the crash was swallowed per-request and the download silently degraded to
`[reel][outro]`. Nothing ever 500'd; nothing surfaced to the user. Playback never
imports the Python renderer (the pre-roll is DOM-rendered), which is why preview
showed the card correctly while every download dropped it.

Fix: the path computation moved out of module level into `_js_path()`, called
only by the dev-time JS-mirror generator (`write_js_mirror()` / `__main__`) --
never by any import or any serve-time code path. Import of the module now does
zero filesystem-layout derivation; `_js_path()` raises a clear `RuntimeError`
(not a bare `IndexError`) if invoked somewhere the repo layout doesn't exist.

These are structural guards, not reproductions of the live crash: we fake
`__file__` at Fly's image depth without touching the real filesystem. The mock
must be an ABSOLUTE path on the runtime OS, because `_js_path()` calls
`Path(__file__).resolve()` first: for a non-absolute string `.resolve()` prepends
the current working directory, so a Windows-style `C:\\...` path (not absolute on
Linux) would gain the CI runner's own deep CWD and defeat the depth check
(`parents[4]` would succeed -> "DID NOT RAISE"). The deployed image is Linux with
`WORKDIR /app` + `COPY . .`, so the real Fly layout is the POSIX-absolute path
below; `.parents` from there is then purely lexical (no I/O) on both Linux and
Windows (where `.resolve()` only supplies the drive letter, keeping the 4-deep
shape).
"""

from unittest.mock import patch

import pytest

from app.services import intro_card_geometry as g

# The real deployed Fly image: WORKDIR /app + COPY . . puts this module at
# /app/app/services/intro_card_geometry.py -- 4 levels below the image root, one
# short of the 5-level repo checkout depth `parents[4]` assumes. POSIX-absolute so
# `.resolve()` leaves it untouched on Linux (CI + Fly) instead of prepending CWD.
_FLY_IMAGE_DEPTH_FILE = "/app/app/services/intro_card_geometry.py"


def test_module_has_no_eager_module_level_js_path():
    """The bug was an eager `_JS_PATH = Path(__file__).resolve().parents[4]` at
    module level. Pin that the attribute is gone and replaced by a lazy callable
    -- this is what makes import layout-independent."""
    assert not hasattr(g, "_JS_PATH")
    assert callable(g._js_path)


def test_player_intro_imports_cleanly():
    """player_intro.py imports intro_card_geometry at ITS module level (the
    crash-propagation point in the original traceback). If the geometry module
    still did anything eager at import time, this import would raise."""
    import app.services.player_intro  # noqa: F401 -- import success is the assertion


def test_js_path_raises_clear_error_at_fly_image_depth():
    """At the deployed image's 4-levels-deep layout, `_js_path()` must fail
    LOUDLY with a clear message (no-silent-fallbacks rule) instead of the bare
    `IndexError: 4` that used to crash the import."""
    with (
        patch.object(g, "__file__", _FLY_IMAGE_DEPTH_FILE),
        pytest.raises(RuntimeError, match="repo checkout layout"),
    ):
        g._js_path()


def test_js_path_resolves_correctly_at_repo_depth():
    """Unchanged behavior at the real repo checkout depth: still targets the
    generated JS mirror in the frontend tree."""
    path = g._js_path()
    assert path.name == "introCardGeometry.js"
    assert str(path).replace("\\", "/").endswith(
        "src/frontend/src/utils/introCardGeometry.js"
    )
