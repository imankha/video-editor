"""List backend dead code (T15910): vulture at 80% confidence over app/, vendored RIFE excluded.

Run from src/backend: .venv/Scripts/python.exe scripts/deadcode.py (or python scripts/deadcode.py).
CI's ratchet (scripts/check_dead_code.py at the repo root) runs the same scan plus an import graph
that ignores tests/. False positives go in vulture_whitelist.py with a reason.
"""
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

if __name__ == '__main__':
    sys.exit(subprocess.run([sys.executable, '-m', 'vulture', 'app', 'vulture_whitelist.py',
                             '--min-confidence', '80', '--exclude', 'ai_upscaler/rife'], cwd=BACKEND).returncode)
