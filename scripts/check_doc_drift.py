"""Doc-drift floor for instruction and knowledge docs. Standard library only.

Checks that CLAUDE.md/AGENTS.md and .claude/**/*.md name files and code symbols that exist.
This is an EXISTENCE floor: it cannot tell whether a doc's claims about behaviour are true,
which stays a review responsibility. Task files and other docs/plans history are not checked.

Branch mode (--base/--head): fails on dead path references the branch introduces, whether a
doc gained one or a code change deleted/renamed a file a doc still names, on code-shaped
symbols in ADDED doc lines that exist nowhere in the code, and on PLAN.md rows/links it breaks.
Total mode (no revisions): the count of dead path references must not exceed BASELINE.
"""
import argparse
from collections import Counter
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import sys
import tempfile

from ci_policy import resolve

# Ratchet: dead path references on master when this check landed (T13710). Lower it as docs
# are fixed; never raise it.
BASELINE = 51
PLAN = 'docs/plans/PLAN.md'
EXTENSIONS = 'py|js|jsx|ts|tsx|mjs|cjs|sh|bat|yml|yaml|json|md|sql|toml|astro|css|html'
PATH_TOKEN = re.compile(rf'^[\w.\-/]+\.(?:{EXTENSIONS})$')
SYMBOL_TOKEN = re.compile(r'^([A-Za-z_][A-Za-z0-9_]{5,})(?:\(\))?$')
BACKTICKED = re.compile(r'`([^`\s]+)`')
FENCE = re.compile(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', re.M | re.S)
# A line describing what USED to exist legitimately names things that are gone.
HISTORY = re.compile(r'\b(removed|deleted|renamed|retired|replaced|formerly|no longer|obsolete|legacy|old|was|were)\b', re.I)
CODE_PATHSPECS = [':(exclude)*.md', ':(exclude)docs/', ':(exclude)**/package-lock.json']


def git(root, *args, data=None):
    return subprocess.run(['git', '-C', str(root), *args], input=data, capture_output=True, check=True).stdout


def tracked(root, rev):
    return [p.decode('utf-8') for p in git(root, 'ls-tree', '-r', '--name-only', '-z', rev).split(b'\0') if p]


def read(root, rev, path):
    return git(root, 'show', f'{rev}:{path}').decode('utf-8', 'replace')


def in_scope(path):
    parts = PurePosixPath(path).parts
    return path.endswith('.md') and (parts[-1] in {'CLAUDE.md', 'AGENTS.md'} or '.claude' in parts)


def visible_lines(text):
    """Doc lines with fenced examples blanked (line numbers preserved)."""
    return FENCE.sub(lambda m: '\n' * m.group(0).count('\n'), text).splitlines()


def candidate_paths(line):
    if HISTORY.search(line):
        return []
    found = []
    for token in BACKTICKED.findall(line):
        token = re.sub(r':\d+(?:-\d+)?$', '', token)
        token = token[2:] if token.startswith('./') else token
        if '...' in token or token.startswith(('/', '~')) or not PATH_TOKEN.match(token):
            continue
        found.append(token)
    return found


class Tree:
    def __init__(self, root, rev):
        self.files = set(tracked(root, rev))
        self.dirs = {str(PurePosixPath(f).parent) for f in self.files}
        self.dirs |= {str(p) for f in self.files for p in PurePosixPath(f).parents}
        self.names = {PurePosixPath(f).name for f in self.files}

    def exists(self, token):
        if token in self.files or token in self.dirs:
            return True
        if '/' not in token:
            return token in self.names
        suffix = '/' + token
        return any(f.endswith(suffix) for f in self.files)


def ignored(root, tokens):
    """Tokens the checkout's .gitignore covers are runtime artifacts (qa/proof.json, .dotask-*.json)."""
    if not tokens:
        return set()
    out = subprocess.run(['git', '-C', str(root), 'check-ignore', '--no-index', '--stdin'],
                         input='\n'.join(sorted(tokens)).encode(), capture_output=True).stdout
    return set(out.decode().split())


def dead_refs(root, rev):
    """{(doc, token)} path references in scope docs at rev that resolve to nothing."""
    tree = Tree(root, rev)
    refs = set()
    for doc in sorted(f for f in tree.files if in_scope(f)):
        for line in visible_lines(read(root, rev, doc)):
            refs.update((doc, token) for token in candidate_paths(line) if not tree.exists(token))
    skip = ignored(root, {token for _, token in refs})
    return {(doc, token) for doc, token in refs if token not in skip}


def added_lines(root, base, head, path):
    """Line numbers (1-based) added to path between base and head."""
    diff = git(root, 'diff', '-U0', '--no-renames', base, head, '--', path).decode('utf-8', 'replace')
    added = []
    for match in re.finditer(r'^@@ -\S+ \+(\d+)(?:,(\d+))? @@', diff, re.M):
        start, count = int(match.group(1)), int(match.group(2) or 1)
        added.extend(range(start, start + count))
    return added


def missing_symbols(root, rev, symbols):
    if not symbols:
        return set()
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(sorted(symbols)) + '\n')
    try:
        result = subprocess.run(['git', '-C', str(root), 'grep', '-o', '-h', '-I', '-F', '-w', '-f', handle.name,
                                 rev, '--', *CODE_PATHSPECS], capture_output=True)
    finally:
        Path(handle.name).unlink()
    found = {line.split(':')[-1] for line in result.stdout.decode('utf-8', 'replace').splitlines()}
    return set(symbols) - found


def plan_errors(root, base, head):
    errors = []
    tree = Tree(root, head)
    lines = read(root, head, PLAN).splitlines()
    for number in added_lines(root, base, head, PLAN):
        for target in re.findall(r'\]\(([^)\s]+)\)', lines[number - 1]):
            target = target.split('#', 1)[0]
            if not target or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', target):
                continue
            normalized = posixpath.normpath(posixpath.join('docs/plans', target))
            if not normalized.startswith('..') and not tree.exists(normalized):
                errors.append(f'{PLAN}:{number}: link to missing file {target}')

    def duplicates(text):
        ids = Counter(cells[0] for cells in ([c.strip() for c in line.strip().strip('|').split('|')]
                                              for line in text.splitlines() if line.startswith('|'))
                      if re.fullmatch(r'T\d+', cells[0]))
        return {task for task, count in ids.items() if count > 1}

    try:
        before = duplicates(read(root, base, PLAN))
    except subprocess.CalledProcessError:
        before = set()
    errors += [f'{PLAN}: task {task} has more than one row' for task in sorted(duplicates('\n'.join(lines)) - before)]
    return errors


def branch_check(root, base, head):
    merge_base = git(root, 'merge-base', base, head).decode().strip()
    errors = [f'{doc}: `{token}` names a path that does not exist; update the doc in this branch'
              for doc, token in sorted(dead_refs(root, head) - dead_refs(root, merge_base))]
    changed = git(root, 'diff', '--no-renames', '--name-only', '-z', merge_base, head).decode('utf-8').split('\0')
    head_files = set(tracked(root, head))
    symbols = {}
    for doc in sorted(p for p in changed if p in head_files and in_scope(p)):
        lines = visible_lines(read(root, head, doc))
        for number in added_lines(root, merge_base, head, doc):
            line = lines[number - 1] if number <= len(lines) else ''
            if HISTORY.search(line):
                continue
            for token in BACKTICKED.findall(line):
                match = SYMBOL_TOKEN.match(token)
                if match and re.search(r'[a-z][A-Z]|_', match.group(1)):
                    symbols.setdefault(match.group(1), []).append(f'{doc}:{number}')
    for symbol in sorted(missing_symbols(root, head, symbols)):
        errors.append(f'{symbols[symbol][0]}: `{symbol}` does not appear anywhere in the code')
    if PLAN in changed and PLAN in head_files:
        errors += plan_errors(root, merge_base, head)
    return errors


def total_check(root, rev, baseline=BASELINE):
    dead = sorted(dead_refs(root, rev))
    if len(dead) > baseline:
        listing = '\n'.join(f'  {doc}: `{token}`' for doc, token in dead)
        return [f'{len(dead)} dead path references exceed the baseline of {baseline}:\n{listing}']
    if len(dead) < baseline:
        print(f'note: {len(dead)} dead path references; lower BASELINE in scripts/check_doc_drift.py to {len(dead)}')
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--base')
    parser.add_argument('--head')
    args = parser.parse_args()
    if bool(args.base) != bool(args.head):
        parser.error('--base and --head are required together')
    if args.base:
        resolve(args.root, args.base)
        resolve(args.root, args.head)
        errors = branch_check(args.root, args.base, args.head)
    else:
        errors = total_check(args.root, 'HEAD')
    print('\n'.join(errors) if errors else 'Doc drift check passed')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
