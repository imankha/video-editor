"""Record the lines that run at IMPORT time (T13961). Run from src/backend:

    python ../../scripts/testmon_import_lines.py import_lines.json tests/test_*.py

testmon credits a module-level statement (`X = build()`, a decorator registry) to no test, so a
change there is invisible to a baseline. This imports every test module (pytest --collect-only)
and every module under app/ with coverage on, and saves {relative path: [executed lines]}.
Any collection or import error fails the run and writes nothing.
"""
import json
from pathlib import Path
import pkgutil
import sys


def record(root, test_files, out):
    import coverage
    import pytest
    root = Path(root).resolve()
    sys.path.insert(0, str(root))
    cov = coverage.Coverage(data_file=None, source=[str(root)], config_file=False)
    cov.start()
    try:
        code = pytest.main(['--collect-only', '-q', '-p', 'no:cacheprovider', *test_files])
        if code != 0:
            print(f'import-lines: pytest --collect-only exited {code}', file=sys.stderr)
            return 1
        failures = []
        import app
        for info in pkgutil.walk_packages(app.__path__, 'app.', onerror=lambda name: failures.append(name)):
            try:
                __import__(info.name)
            except BaseException as exc:  # SystemExit from a module counts too
                failures.append(f'{info.name}: {type(exc).__name__}: {exc}')
        if failures:
            print('import-lines: import failures:\n  ' + '\n  '.join(failures), file=sys.stderr)
            return 1
    finally:
        cov.stop()
    data = cov.get_data()
    lines = {}
    for filename in data.measured_files():
        try:
            relative = Path(filename).resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        lines[relative] = sorted(data.lines(filename) or [])
    Path(out).write_text(json.dumps(lines, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(record(Path.cwd(), sys.argv[2:], sys.argv[1]))
