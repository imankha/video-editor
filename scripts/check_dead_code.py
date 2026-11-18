"""Dead-code ratchet (T15910). Standard library only; shells out to knip and vulture.

Findings, one string each, line numbers left out so edits above a finding never churn the baseline:
  frontend:file:<path>       a module nothing reaches from the app, the *diag harnesses, the e2e
                             specs or the cross-tree consumers listed in src/frontend/knip.json
                             (knip --production: a test importing a module does not keep it alive)
  backend:vulture:<path>: <message>
                             vulture at 80% confidence over src/backend/app (vendored RIFE excluded)
  backend:orphan:<module>    an app module unreachable from the server's entry points; tests/ is
                             ignored, which vulture cannot do (T16500, T4410)

Total mode: every finding must be in scripts/dead_code_baseline.json, every baseline entry must
still be a finding (the baseline only shrinks) and must name the task that owns it.
Branch mode (--base): also fails on unused functions, methods and classes (vulture 60%) that the
branch adds; those are too noisy to baseline whole, so only new ones are refused. A false
positive goes in src/backend/vulture_whitelist.py with a reason.
"""
import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / 'scripts/dead_code_baseline.json'
OWNER = re.compile(r'^T\d+\b')
# The server's entry points: uvicorn loads app.main; Modal deploys the modal_functions modules.
BACKEND_ENTRIES = ('app.main', 'app.modal_functions.video_processing', 'app.modal_functions.deploy')
VULTURE_EXCLUDE = 'ai_upscaler/rife'  # vendored upstream code
# Framework-called definitions: route handlers, validators, Modal functions, middleware hooks.
VULTURE_IGNORE_DECORATORS = ','.join([
    '@router.*', '@app.*', '@*.get', '@*.post', '@*.put', '@*.delete', '@*.patch', '@*.websocket',
    '@*.on_event', '@*.middleware', '@*.exception_handler', '@*.validator', '@*.field_validator',
    '@*.model_validator', '@validator', '@field_validator', '@model_validator',
    '@*.function', '@*.method', '@*.enter', '@*.exit', '@*.cls',
    '@*.local_entrypoint', '@*.asgi_app', '@*.web_endpoint', '@property', '@*.setter',
])
# Names frameworks call by convention, and test seams (tests/ is not scanned).
VULTURE_IGNORE_NAMES = 'forward,dispatch,*_for_tests,reset_*,clear_*'
DEFINITION = re.compile(r": unused (function|method|class) '")
VULTURE_LINE = re.compile(r'^(?P<path>[^:]+):\d+: (?P<message>.+?) \(\d+% confidence[^)]*\)$')


def knip_files(frontend_dir):
    frontend_dir = Path(frontend_dir)
    npx = shutil.which('npx') or 'npx'
    proc = subprocess.run([npx, 'knip', '--production', '--no-progress', '--reporter', 'json'],
                          cwd=frontend_dir, capture_output=True, text=True)
    if proc.returncode not in (0, 1) or not proc.stdout.strip():
        raise RuntimeError(f'knip failed (exit {proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}')
    return {f'frontend:file:{path}' for path in json.loads(proc.stdout)['files']}


def _vulture(backend_dir, min_confidence, extra=()):
    backend_dir = Path(backend_dir)
    targets = ['app']
    if (backend_dir / 'vulture_whitelist.py').exists():
        targets.append('vulture_whitelist.py')
    proc = subprocess.run([sys.executable, '-m', 'vulture', *targets, '--min-confidence', str(min_confidence),
                           '--exclude', VULTURE_EXCLUDE, *extra], cwd=backend_dir, capture_output=True, text=True)
    if proc.returncode not in (0, 3):  # 3 = dead code found
        raise RuntimeError(f'vulture failed (exit {proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}')
    out = set()
    for line in proc.stdout.splitlines():
        match = VULTURE_LINE.match(line.strip())
        if not match:
            raise RuntimeError(f'unparsed vulture line: {line!r}')
        out.add(f"{match['path'].replace(chr(92), '/')}: {match['message']}")
    return out


def vulture_findings(backend_dir):
    return {f'backend:vulture:{f}' for f in _vulture(backend_dir, 80)}


def unused_definitions(backend_dir):
    found = _vulture(backend_dir, 60, ['--ignore-decorators', VULTURE_IGNORE_DECORATORS,
                                       '--ignore-names', VULTURE_IGNORE_NAMES])
    return {f for f in found if DEFINITION.search(f)}


def new_unused_definitions(base_dir, head_dir):
    return unused_definitions(head_dir) - unused_definitions(base_dir)


def _module_name(path):
    name = '.'.join(path.with_suffix('').parts)
    return name.removesuffix('.__init__')


def _imports(path, name, modules):
    package = name if path.name == '__init__.py' else name.rpartition('.')[0]
    named = set()
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'), str(path))):
        if isinstance(node, ast.Import):
            named |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package.split('.')[:len(package.split('.')) - node.level + 1]
                module = '.'.join(base + ([node.module] if node.module else []))
            else:
                module = node.module or ''
            named.add(module)
            named |= {f'{module}.{alias.name}' for alias in node.names}
    reached = set()
    for module in named:  # importing a.b.c also runs a and a.b
        parts = module.split('.')
        reached |= {'.'.join(parts[:i]) for i in range(1, len(parts) + 1)} & modules
    return reached


def orphan_modules(backend_dir):
    backend_dir = Path(backend_dir)
    files = {}
    for path in (backend_dir / 'app').rglob('*.py'):
        relative = path.relative_to(backend_dir)
        if VULTURE_EXCLUDE not in relative.as_posix():
            files[_module_name(relative)] = path
    modules = set(files)
    seen, stack = set(), [m for m in BACKEND_ENTRIES if m in modules]
    while stack:
        module = stack.pop()
        if module in seen:
            continue
        seen.add(module)
        parts = module.split('.')
        stack += [p for p in ('.'.join(parts[:i]) for i in range(1, len(parts))) if p in modules]
        stack += _imports(files[module], module, modules)
    return {f'backend:orphan:{m}' for m in modules - seen}


def compare(findings, baseline):
    errors = [f'new dead code: {f} (delete it, or wire it up)' for f in sorted(set(findings) - set(baseline))]
    errors += [f'baseline names a finding that is gone: {f} (remove it from {BASELINE.name})'
               for f in sorted(set(baseline) - set(findings))]
    errors += [f'baseline entry has no owning task id: {f}: {note!r}'
               for f, note in sorted(baseline.items()) if not OWNER.match(note)]
    return errors


def load_baseline(path=BASELINE):
    path = Path(path)
    return json.loads(path.read_text(encoding='utf-8'))['findings'] if path.exists() else {}


def all_findings(root=ROOT):
    return (knip_files(root / 'src/frontend') | vulture_findings(root / 'src/backend')
            | orphan_modules(root / 'src/backend'))


def _extract_backend(root, revision, folder):
    archive = subprocess.run(['git', '-C', str(root), 'archive', revision, 'src/backend/app'],
                             capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', str(folder)], input=archive, check=True)
    whitelist = root / 'src/backend/vulture_whitelist.py'  # the branch's whitelist judges both sides
    if whitelist.exists():
        shutil.copy(whitelist, Path(folder) / 'src/backend/vulture_whitelist.py')
    return Path(folder) / 'src/backend'


def branch_added_definitions(root, base, head):
    # Judge the branch against where it forked, not the base tip: master moving or renaming a
    # file after the fork would otherwise make its old dead code look branch-added.
    fork = subprocess.run(['git', '-C', str(root), 'merge-base', base, head],
                          capture_output=True, text=True, check=True).stdout.strip()
    with tempfile.TemporaryDirectory() as folder:
        return new_unused_definitions(_extract_backend(root, fork, folder), Path(root) / 'src/backend')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--base', help='base revision: also refuse unused definitions the branch adds')
    parser.add_argument('--head', help='head revision: with --base, sets the fork point (the working tree is checked)')
    args = parser.parse_args(argv)
    errors = compare(all_findings(), load_baseline())
    if args.base:
        errors += [f'new unused definition: {f} (delete it, or whitelist a false positive with a reason)'
                   for f in sorted(branch_added_definitions(ROOT, args.base, args.head or 'HEAD'))]
    for error in errors:
        print(error)
    print(f'dead-code ratchet: {"FAIL" if errors else "ok"} ({len(errors)} problem(s))')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
