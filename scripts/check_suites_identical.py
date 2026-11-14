#!/usr/bin/env python3
"""Prove vitest suites behave the same before and after a commit (a /dotask acceptance check).

Runs the named frontend test files twice with the JSON reporter: in a temporary git worktree at
the parent of the one commit on HEAD whose subject matches --subject (sharing this checkout's
node_modules), and in this checkout. Every test that exists before must exist after under the same
file and title (titles normalized through the declared OLD=NEW renames) with the same status. Tests
added after are reported, not required to match. Fails when the base run has no passing tests.

  python3 scripts/check_suites_identical.py --subject '^T11270: Rename' \\
      --map selectedClipId=projectClipId src/screens/__tests__/focusScreenLoadTrace.test.jsx ...
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

REPO = subprocess.run(['git', 'rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True).stdout.strip()


def git(*args, cwd=REPO):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True, cwd=cwd).stdout


def run_vitest(frontend, files, out):
    cmd = ['npx', 'vitest', 'run', '--testTimeout=60000', '--hookTimeout=60000',
           '--reporter=json', f'--outputFile={out}', *files]
    subprocess.run(cmd, cwd=frontend, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)  # failures are compared below
    if not os.path.exists(out):
        sys.exit(f'FAIL: vitest wrote no report in {frontend}')
    with open(out) as fh:
        report = json.load(fh)
    results = {}
    for suite in report['testResults']:
        rel = os.path.relpath(suite['name'], frontend)
        if not suite['assertionResults'] and suite.get('status') == 'failed':
            results[(rel, '<file failed to load>')] = 'failed'
        for test in suite['assertionResults']:
            results[(rel, test['fullName'])] = test['status']
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--subject', required=True)
    ap.add_argument('--map', action='append', default=[], help='OLD=NEW rename applied to base test titles')
    ap.add_argument('files', nargs='+', help='test files relative to src/frontend')
    args = ap.parse_args()
    pattern = re.compile(args.subject)
    hits = [line.split('\t', 1)[0] for line in git('log', '--format=%H\t%s', 'HEAD').splitlines()
            if pattern.search(line.split('\t', 1)[1])]
    if len(hits) != 1:
        sys.exit(f'FAIL: expected exactly one commit on HEAD matching {args.subject!r}, found {len(hits)}')
    base = git('rev-parse', f'{hits[0]}^').strip()
    renames = [(re.compile(rf'\b{re.escape(o)}\b'), n) for o, n in (m.split('=', 1) for m in args.map)]
    frontend = os.path.join(REPO, 'src/frontend')
    with tempfile.TemporaryDirectory() as tmp:
        tree = os.path.join(tmp, 'base')
        git('worktree', 'add', '--detach', tree, base)
        try:
            os.symlink(os.path.join(frontend, 'node_modules'), os.path.join(tree, 'src/frontend/node_modules'))
            before_files = [f for f in args.files if os.path.exists(os.path.join(tree, 'src/frontend', f))]
            before = run_vitest(os.path.join(tree, 'src/frontend'), before_files, os.path.join(tmp, 'before.json'))
        finally:
            git('worktree', 'remove', '--force', tree)
        after = run_vitest(frontend, args.files, os.path.join(tmp, 'after.json'))

    def normalize(key):
        path, title = key
        for regex, new in renames:
            title = regex.sub(new, title)
        return path, title

    before = {normalize(k): v for k, v in before.items()}
    failures = []
    for key, status in sorted(before.items()):
        if key not in after:
            failures.append(f'missing after: {key[0]} > {key[1]} (was {status})')
        elif after[key] != status:
            failures.append(f'changed: {key[0]} > {key[1]}: {status} -> {after[key]}')
    passed = sum(1 for s in before.values() if s == 'passed')
    if passed == 0:
        failures.append('base run has no passing tests')
    added = sorted(set(after) - set(before))
    print(f'base {base[:9]}: {len(before)} tests ({passed} passed); HEAD: {len(after)} tests ({len(added)} added)')
    for path, title in added:
        print(f'  added after: {path} > {title} [{after[(path, title)]}]')
    if failures:
        print('FAIL: suites differ before/after:')
        print('\n'.join(f'  {f}' for f in failures))
        return 1
    print(f'PASS: all {len(before)} base tests present after with the same status')
    return 0


if __name__ == '__main__':
    sys.exit(main())
