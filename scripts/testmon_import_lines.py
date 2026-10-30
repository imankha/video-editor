"""Record the lines that run at IMPORT time (T13961). Run from src/backend:

    python ../../scripts/testmon_import_lines.py import_lines.json tests/test_*.py

testmon credits a module-level statement (`X = build()`, a decorator registry) to no test, so a
change there is invisible to a baseline. This imports every test module (pytest --collect-only)
and every module under app/ with coverage on, and saves {relative path: [executed lines]}.
Any collection or import error fails the run and writes nothing, EXCEPT a ModuleNotFoundError for a
third-party package this environment lacks (CI has no torch): that module is recorded under
"unimportable" ({relative path: missing package}) and the Branch CI planner runs the full suite
for any change to it (T13963). Output: {"lines": {...}, "unimportable": {...}}.
"""
import json
from pathlib import Path
import pkgutil
import sys


def third_party_missing(exc, root):
    """The missing top-level package if exc is a ModuleNotFoundError for a non-local module, else None."""
    if not isinstance(exc, ModuleNotFoundError) or not exc.name:
        return None
    top = exc.name.split('.')[0]
    if top == 'app' or (root / top).is_dir() or (root / (top + '.py')).is_file():
        return None
    return top


def module_path(root, name):
    base = root / name.replace('.', '/')
    return (base / '__init__.py' if base.is_dir() else base.with_suffix('.py')).relative_to(root).as_posix()


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
        unimportable = {}

        def failed(name, exc):
            missing = third_party_missing(exc, root)
            if missing:
                unimportable[module_path(root, name)] = missing
            else:
                failures.append(f'{name}: {type(exc).__name__}: {exc}')

        import app
        # walk_packages imports each package itself; onerror runs inside its except block.
        for info in pkgutil.walk_packages(app.__path__, 'app.', onerror=lambda name: failed(name, sys.exc_info()[1])):
            try:
                __import__(info.name)
            except BaseException as exc:  # SystemExit from a module counts too
                failed(info.name, exc)
        if failures:
            print('import-lines: import failures:\n  ' + '\n  '.join(failures), file=sys.stderr)
            return 1
        for path, missing in sorted(unimportable.items()):
            print(f'import-lines: unimportable (third-party {missing} missing): {path}')
        if not unimportable:
            print('import-lines: every module under app/ imported')
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
    result = {'lines': lines, 'unimportable': unimportable}
    Path(out).write_text(json.dumps(result, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(record(Path.cwd(), sys.argv[2:], sys.argv[1]))
