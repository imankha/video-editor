"""T14290: no backend Python source mixes CRLF and LF line endings.

A mixed file gets normalized wholesale by editors and scripts on save, turning a
small change into a whole-file diff, and the preland whitespace check flags the
CR on added lines.
"""

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIRS = ("app", "tests")


def _mixed_files():
    mixed = []
    for source_dir in SOURCE_DIRS:
        for path in sorted((BACKEND_ROOT / source_dir).rglob("*.py")):
            data = path.read_bytes()
            crlf = data.count(b"\r\n")
            bare_lf = data.count(b"\n") - crlf
            if crlf and bare_lf:
                mixed.append(f"{path.relative_to(BACKEND_ROOT)} ({crlf} CRLF, {bare_lf} LF)")
    return mixed


def test_no_backend_python_file_mixes_line_endings():
    assert _mixed_files() == []
