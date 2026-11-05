#!/usr/bin/env python3
"""T14920: export PLAN.md + the roadmap stage map to the frontend's roadmap.json.

    python scripts/export_roadmap.py --out src/frontend/public/roadmap.json

Run by the frontend build and dev server (src/frontend/generate-roadmap.js, `npm run roadmap`)
and validated on every PR by scripts/test_export_roadmap.py (tooling job). PLAN.md is the only
source of task order and status; this file is a build artifact (gitignored), never edited.

Inputs
  docs/plans/PLAN.md and docs/plans/PLAN-archive.md   board rows: id, title, status, link, section
  docs/plans/roadmap-stage-map.json                   {"transitions": {key: [ids]}, "gates": {key: [ids]}}
  src/frontend/src/components/admin/journeyTargets.js  the frozen transition keys (JOURNEY_TARGETS)
  src/backend/app/services/spend_readiness_constants.py  the gate keys (GATES)

Fails (exit 1, RoadmapError naming every offender) when a mapped id has no board row, when a
frozen key has no stage-map entry, or when the map names a key that is not frozen. There is no
"absent" status: an id the roadmap names must have a row, or the roadmap is wrong.
"""
import argparse
import importlib.util
import json
import posixpath
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan_parser import parse_plan

PLAN = 'docs/plans/PLAN.md'
ARCHIVE = 'docs/plans/PLAN-archive.md'
STAGE_MAP = 'docs/plans/roadmap-stage-map.json'
TARGETS_JS = 'src/frontend/src/components/admin/journeyTargets.js'
GATE_CONSTANTS = 'src/backend/app/services/spend_readiness_constants.py'
TASK_ID = re.compile(r'^T\d+$')
# The task board's badge rule (task-manager.py statusClass), applied once at export time.
KINDS = ('todo', 'wip', 'waiting', 'blocked', 'staging', 'done', 'other')


class RoadmapError(ValueError):
    pass


def kind_of(status):
    s = (status or '').lower().replace(' ', '')
    if s == 'done':
        return 'done'
    if s == 'staging':
        return 'staging'
    if s == 'wip':
        return 'wip'
    if s.startswith('waiting'):
        return 'waiting'
    if s == 'blocked':
        return 'blocked'
    if s == 'todo':
        return 'todo'
    return 'other'


def rows(text, archive=False):
    """Board rows of one PLAN file in document order: [{id, title, status, kind, section, file}].

    The archive files its sections under `##` headings (one per PLAN.md section); the board's
    parser only tracks `###`/`####`, so those headings are promoted before parsing. Epic header
    rows (no id) are skipped; `↳` children are ordinary tasks.
    """
    if archive:
        text = re.sub(r'^## (?!#)', '### ', text, flags=re.MULTILINE)
    out = []
    for milestone in parse_plan(text):
        for task in milestone['tasks']:
            tid = task.get('id', '').strip()
            if not tid:
                continue
            link = task.get('link', '')
            out.append({
                'id': tid,
                'title': task.get('name', '').strip(),
                'status': 'DONE' if archive else task.get('status', '').strip(),
                'kind': 'done' if archive else kind_of(task.get('status', '')),
                'section': milestone['name'],
                'file': posixpath.normpath(posixpath.join('docs/plans', link)) if link else None,
            })
    return out


def board(root):
    """id -> row. PLAN.md wins over the archive; within a file the first row wins."""
    tasks = {}
    for row in rows((root / PLAN).read_text(encoding='utf-8')):
        tasks.setdefault(row['id'], row)
    for row in rows((root / ARCHIVE).read_text(encoding='utf-8'), archive=True):
        tasks.setdefault(row['id'], row)
    return tasks


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def frozen_keys(root):
    """(transition keys in JOURNEY_TARGETS order minus the end-to-end key, gate keys in GATES order)."""
    source = (root / TARGETS_JS).read_text(encoding='utf-8')
    start = source.index('export const JOURNEY_TARGETS = {')
    table = source[start:source.index('};', start)]
    end_to_end = re.search(r"export const END_TO_END_KEY = '([^']+)'", source).group(1)
    transitions = [k for k in re.findall(r"'(\w+->\w+)':", table) if k != end_to_end]
    gates = [g['key'] for g in _module('spend_readiness_constants', root / GATE_CONSTANTS).GATES]
    return transitions, gates


def _check_keys(section, present, frozen, problems):
    missing = [k for k in frozen if k not in present]
    unknown = [k for k in present if k not in frozen]
    if missing:
        problems.append(f'{section}: no stage-map entry for {", ".join(missing)}')
    if unknown:
        problems.append(f'{section}: not a frozen key: {", ".join(unknown)}')


def build(root, transition_keys, gate_keys, commit=None, git_root=None, now=None):
    root = Path(root)
    stage_map = json.loads((root / STAGE_MAP).read_text(encoding='utf-8'))
    tasks = board(root)
    problems = []
    for section, frozen in (('transitions', transition_keys), ('gates', gate_keys)):
        entries = stage_map.get(section)
        if not isinstance(entries, dict):
            problems.append(f'{section}: missing or not an object')
            continue
        _check_keys(section, list(entries), frozen, problems)
        for key, ids in entries.items():
            if not isinstance(ids, list):
                problems.append(f'{section} {key}: not a list')
                continue
            bad = [i for i in ids if not isinstance(i, str) or not TASK_ID.match(i)]
            if bad:
                problems.append(f'{section} {key}: not a task id: {", ".join(map(str, bad))}')
            unresolved = [i for i in ids if isinstance(i, str) and TASK_ID.match(i) and i not in tasks]
            if unresolved:
                problems.append(f'{section} {key}: no board row in {PLAN} or {ARCHIVE} for {", ".join(unresolved)}')
    if problems:
        raise RoadmapError('roadmap-stage-map.json does not agree with PLAN.md:\n  ' + '\n  '.join(problems))
    transitions = {k: list(stage_map['transitions'][k]) for k in transition_keys}
    gates = {k: list(stage_map['gates'][k]) for k in gate_keys}
    mapped = {i for ids in list(transitions.values()) + list(gates.values()) for i in ids}
    if commit is None:
        commit = subprocess.check_output(['git', '-C', str(git_root or root), 'rev-parse', '--short', 'HEAD'],
                                         text=True).strip()
    return {
        'generated_at': (now or datetime.now(UTC)).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'commit': commit,
        'transitions': transitions,
        'gates': gates,
        'tasks': {i: tasks[i] for i in sorted(mapped)},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]), help='repository root')
    parser.add_argument('--out', required=True, help='where to write roadmap.json')
    parser.add_argument('--transition-keys', nargs='*', help='override the frozen transition keys (tests)')
    parser.add_argument('--gate-keys', nargs='*', help='override the frozen gate keys (tests)')
    parser.add_argument('--commit', help='override the git short head (tests)')
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        if args.transition_keys is None or args.gate_keys is None:
            transitions, gates = frozen_keys(root)
        else:
            transitions, gates = args.transition_keys, args.gate_keys
        data = build(root, transitions, gates, commit=args.commit)
    except (RoadmapError, FileNotFoundError, json.JSONDecodeError) as err:
        print(f'export_roadmap: {err}', file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'export_roadmap: {len(data["tasks"])} tasks, {len(data["transitions"])} steps, '
          f'{len(data["gates"])} gates -> {out} ({data["commit"]})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
