#!/usr/bin/env python3
"""Prove a task's commits are identifier renames only (a /dotask acceptance check).

Checks every commit on HEAD whose subject matches --subject. For each file a commit modifies it
diffs the parent and the commit token by token and requires every difference to be one declared
OLD=NEW identifier rename (whole token). Any other edit (added logic, a changed literal, a dropped
line) fails. A rename target that already exists in a file next to its old name fails too: that
would merge two names, a behaviour change. An old name the commit deliberately keeps (a wire-format
key) must be declared with --keep PATH:OLD; every other occurrence still in the file at HEAD must
be renamed (a later commit matching --subject may finish a rename an earlier one missed). Added files and
check harness files are allowed only when listed with --allow-added / --allow-changed. Every map
entry must be used.

  python3 scripts/check_rename_only.py --subject '^T11270: ' \\
      --map selectedClipId=projectClipId ... --allow-added path/to/new.test.js
"""
import argparse
import difflib
import re
import subprocess
import sys

TOKEN = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*|[^A-Za-z_$]+')
IDENT = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout


def find_commits(subject):
    pattern = re.compile(subject)
    return [line.split('\t', 1)[0] for line in git('log', '--reverse', '--format=%H\t%s', 'HEAD').splitlines()
            if pattern.search(line.split('\t', 1)[1])]


def check_file(path, old, new, renames, failures, used, leftovers):
    old_idents = set(IDENT.findall(old))
    for old_name, new_name in renames.items():
        if old_name in old_idents and new_name in old_idents:
            failures.append(f'{path}: rename target {new_name!r} already exists next to {old_name!r}')
    old_tokens, new_tokens = TOKEN.findall(old), TOKEN.findall(new)
    matcher = difflib.SequenceMatcher(None, old_tokens, new_tokens, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            for token in old_tokens[i1:i2]:
                if token in renames:
                    leftovers.add((path, token))
            continue
        pairs = list(zip(old_tokens[i1:i2], new_tokens[j1:j2]))
        if op != 'replace' or i2 - i1 != j2 - j1 or any(renames.get(o) != n for o, n in pairs):
            failures.append(f'{path}: non-rename edit {"".join(old_tokens[i1:i2])!r} -> {"".join(new_tokens[j1:j2])!r}')
            continue
        used.update(o for o, _ in pairs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--subject', required=True)
    ap.add_argument('--map', action='append', required=True, help='OLD=NEW identifier rename')
    ap.add_argument('--keep', action='append', default=[], help='PATH:OLD occurrences left unrenamed on purpose')
    ap.add_argument('--allow-added', action='append', default=[])
    ap.add_argument('--allow-changed', action='append', default=[])
    args = ap.parse_args()
    renames = dict(pair.split('=', 1) for pair in args.map)
    keeps = {tuple(k.rsplit(':', 1)) for k in args.keep}
    commits = find_commits(args.subject)
    failures, used, leftovers, checked = [], set(), set(), 0
    if not commits:
        failures.append(f'no commit on HEAD matches {args.subject!r}')
    for commit in commits:
        for line in git('diff', '--name-status', '-M', f'{commit}^', commit).splitlines():
            status, *paths = line.split('\t')
            new_path = paths[-1]
            if (status == 'A' and new_path in args.allow_added) or (status == 'M' and new_path in args.allow_changed):
                continue
            if status != 'M' and not status.startswith('R'):
                failures.append(f'{commit[:9]} {status} {" -> ".join(paths)}: not a rename-only change')
                continue
            old = git('show', f'{commit}^:{paths[0]}')
            new = git('show', f'{commit}:{new_path}')
            check_file(new_path, old, new, renames, failures, used, leftovers)
            checked += 1
    # An old name one commit leaves behind may be renamed by a later one: judge leftovers at HEAD.
    kept_seen = set()
    for path, token in sorted(leftovers):
        try:
            still_there = token in IDENT.findall(git('show', f'HEAD:{path}'))
        except subprocess.CalledProcessError:
            still_there = False
        if not still_there:
            continue
        if (path, token) in keeps:
            kept_seen.add((path, token))
        else:
            failures.append(f'{path}: {token!r} left unrenamed (declare --keep {path}:{token} if intended)')
    for path, token in sorted(keeps - kept_seen):
        failures.append(f'--keep {path}:{token} matched nothing')
    unused = set(renames) - used
    if unused:
        failures.append(f'map entries never used: {sorted(unused)}')
    if checked == 0:
        failures.append('no modified files checked')
    if failures:
        print(f'FAIL: {len(commits)} commit(s) matching {args.subject!r} are not renames only:')
        print('\n'.join(f'  {f}' for f in failures))
        return 1
    print(f'PASS: {len(commits)} commit(s), {checked} file diffs are exactly the parent with '
          f'{len(renames)} identifier renames ({len(keeps)} declared keeps)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
