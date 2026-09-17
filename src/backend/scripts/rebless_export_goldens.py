#!/usr/bin/env python3
"""T4370: re-bless the export golden-output harness.

Regenerates every golden under tests/export_golden/goldens/ from the CURRENT
behavior of the 6 export triggers + render path, then prints a `git diff` over
that directory so the change is always reviewed -- never a silent overwrite
(task requirement: "a loud diff display -- refactor tasks will legitimately
need to inspect, never blind-re-bless, diffs").

Usage:
    cd src/backend
    python3 scripts/rebless_export_goldens.py

Exit code is the underlying pytest exit code (0 = harness ran clean while
reblessing; nonzero = a trigger errored even with BLESS_GOLDENS on, which
means the harness itself is broken, not just the golden content).
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
GOLDENS_DIR = BACKEND_DIR / "tests" / "export_golden" / "goldens"

GOLDEN_TEST_FILES = [
    "tests/test_export_golden_local_render.py",
    "tests/test_export_golden_overlay.py",
    "tests/test_export_golden_multiclip_modal.py",
    "tests/test_export_golden_worker.py",
    "tests/test_export_golden_sweep.py",
    "tests/test_export_golden_render.py",
]


def main() -> int:
    os.chdir(BACKEND_DIR)
    env = os.environ.copy()
    env["BLESS_GOLDENS"] = "1"

    print(f"[rebless] running {len(GOLDEN_TEST_FILES)} golden test files with BLESS_GOLDENS=1 ...")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", *GOLDEN_TEST_FILES, "-v", "--tb=short", "--capture=sys"],
        env=env,
    )

    print("\n[rebless] git diff over tests/export_golden/goldens/ (review before committing):\n")
    diff = subprocess.run(
        ["git", "diff", "--", str(GOLDENS_DIR)],
        cwd=BACKEND_DIR.parent.parent,  # repo root
        capture_output=True, text=True,
    )
    if diff.stdout.strip():
        print(diff.stdout)
    else:
        print("(no changes -- goldens already matched current behavior)")

    untracked = subprocess.run(
        ["git", "status", "--porcelain", "--", str(GOLDENS_DIR)],
        cwd=BACKEND_DIR.parent.parent,
        capture_output=True, text=True,
    )
    new_files = [line for line in untracked.stdout.splitlines() if line.startswith("??")]
    if new_files:
        print("[rebless] NEW golden files (not yet tracked -- review, then `git add`):")
        for line in new_files:
            print(f"  {line}")

    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
