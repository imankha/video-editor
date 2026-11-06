"""T14920: the roadmap export (PLAN.md + stage map -> roadmap.json) and its validation.

Runs under the tooling job on every PR: the live test exports the real PLAN.md and stage map,
so a stage-map id without a board row, or a transition / gate key without an entry, fails CI.
"""
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_roadmap

ROOT = Path(__file__).resolve().parents[1]

PLAN = """# Project Plan

## Current Focus

### Journey map follow-ups (user request 2026-11-03)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T100 | [First task](tasks/T100-first.md) | 7 | 3 | 2.3 | TODO | [ ] | Plain row. |
| T110 | [Second task](tasks/T110-second.md) | 7 | 3 | 2.3 | WIP | [ ] | Working. |
| T120 | [Third task](tasks/T120-third.md) | 7 | 3 | 2.3 | WAITING ON USER (deferred) | [ ] | Qualified status. |
| T130 | [Fourth task](tasks/T130-fourth.md) | 7 | 3 | 2.3 | STAGING | [ ] | On staging. |
| T140 | [Fifth task](tasks/T140-fifth.md) | 7 | 3 | 2.3 | BLOCKED | [ ] | Blocked. |
| T150 | [Sixth task](tasks/T150-sixth.md) | 7 | 3 | 2.3 | SUPERSEDED | [ ] | Other. |

### Milestone: An epic

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Referral programme](tasks/referral/EPIC.md)** | 8 | 5 | 1.6 | BLOCKED |  | Header row, no id. |
| T200 | ↳ [Epic child](tasks/referral/T200-child.md) | 8 | 5 | 1.6 | TODO | [x] | Child row. |
| T300 | [Also in the archive](tasks/T300-dup.md) | 8 | 5 | 1.6 | WIP | [ ] | PLAN.md wins. |
"""

ARCHIVE = """# Archive

## Current Focus — Veo Highlights Import

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T400 | [Shipped task](tasks/T400-shipped.md) | 6 | 3 | 2.0 | DONE | [ ] | Deployed. |
| T300 | [Also in the archive](tasks/T300-dup.md) | 8 | 5 | 1.6 | DONE | [ ] | Older copy. |
"""

STAGE_MAP = {
    "transitions": {"a->b": ["T100", "T110", "T400"], "b->c": [], "c->d": ["T120", "T130", "T140", "T150", "T200", "T300"]},
    "gates": {"g1": ["T100"], "g2": []},
}
TRANSITION_KEYS = ["a->b", "b->c", "c->d"]
GATE_KEYS = ["g1", "g2"]


def fixture(plan=PLAN, archive=ARCHIVE, stage_map=STAGE_MAP):
    root = Path(tempfile.mkdtemp())
    (root / 'docs' / 'plans').mkdir(parents=True)
    (root / 'docs' / 'plans' / 'PLAN.md').write_text(plan, encoding='utf-8')
    (root / 'docs' / 'plans' / 'PLAN-archive.md').write_text(archive, encoding='utf-8')
    (root / 'docs' / 'plans' / 'roadmap-stage-map.json').write_text(json.dumps(stage_map), encoding='utf-8')
    return root


def build(root, **kw):
    return export_roadmap.build(root, transition_keys=TRANSITION_KEYS, gate_keys=GATE_KEYS, commit='abc1234', **kw)


class RowsTests(unittest.TestCase):
    def test_statuses_are_verbatim_and_kind_is_the_board_rule(self):
        tasks = build(fixture())['tasks']
        self.assertEqual(tasks['T100']['status'], 'TODO')
        self.assertEqual(tasks['T120']['status'], 'WAITING ON USER (deferred)')
        kinds = {tid: tasks[tid]['kind'] for tid in ['T100', 'T110', 'T120', 'T130', 'T140', 'T150', 'T400']}
        self.assertEqual(kinds, {'T100': 'todo', 'T110': 'wip', 'T120': 'waiting', 'T130': 'staging',
                                 'T140': 'blocked', 'T150': 'other', 'T400': 'done'})

    def test_title_section_and_repo_relative_file(self):
        tasks = build(fixture())['tasks']
        self.assertEqual(tasks['T100']['title'], 'First task')
        self.assertEqual(tasks['T100']['section'], 'Journey map follow-ups (user request 2026-11-03)')
        self.assertEqual(tasks['T100']['file'], 'docs/plans/tasks/T100-first.md')

    def test_archive_rows_are_done_and_plan_wins_on_a_duplicate(self):
        tasks = build(fixture())['tasks']
        self.assertEqual(tasks['T400']['status'], 'DONE')
        self.assertEqual(tasks['T400']['kind'], 'done')
        self.assertEqual(tasks['T400']['section'], 'Current Focus — Veo Highlights Import')
        self.assertEqual(tasks['T300']['status'], 'WIP')

    def test_epic_header_rows_are_skipped_and_children_are_ordinary_tasks(self):
        tasks = build(fixture())['tasks']
        self.assertNotIn('', tasks)
        self.assertEqual(tasks['T200']['title'], 'Epic child')
        self.assertEqual(tasks['T200']['file'], 'docs/plans/tasks/referral/T200-child.md')
        self.assertEqual(tasks['T200']['section'], 'An epic')

    def test_only_mapped_ids_are_exported_in_map_order(self):
        out = build(fixture())
        self.assertEqual(out['transitions'], STAGE_MAP['transitions'])
        self.assertEqual(out['gates'], STAGE_MAP['gates'])
        self.assertEqual(set(out['tasks']), {'T100', 'T110', 'T400', 'T120', 'T130', 'T140', 'T150', 'T200', 'T300'})


class HeaderTests(unittest.TestCase):
    def test_generated_at_is_utc_iso_and_commit_is_recorded(self):
        out = build(fixture())
        self.assertRegex(out['generated_at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertEqual(out['commit'], 'abc1234')

    def test_commit_defaults_to_git_short_head(self):
        out = export_roadmap.build(fixture(), transition_keys=TRANSITION_KEYS, gate_keys=GATE_KEYS, git_root=ROOT)
        head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD']).decode().strip()
        self.assertEqual(out['commit'], head)


class ValidationTests(unittest.TestCase):
    def test_an_id_without_a_board_row_fails_naming_it(self):
        bad = {**STAGE_MAP, 'transitions': {**STAGE_MAP['transitions'], 'a->b': ['T100', 'T999']}}
        with self.assertRaises(export_roadmap.RoadmapError) as ctx:
            build(fixture(stage_map=bad))
        self.assertIn('T999', str(ctx.exception))
        self.assertIn('a->b', str(ctx.exception))

    def test_a_missing_transition_or_gate_key_fails(self):
        no_transition = {**STAGE_MAP, 'transitions': {k: v for k, v in STAGE_MAP['transitions'].items() if k != 'b->c'}}
        with self.assertRaises(export_roadmap.RoadmapError) as ctx:
            build(fixture(stage_map=no_transition))
        self.assertIn('b->c', str(ctx.exception))
        no_gate = {**STAGE_MAP, 'gates': {'g1': ['T100']}}
        with self.assertRaises(export_roadmap.RoadmapError) as ctx:
            build(fixture(stage_map=no_gate))
        self.assertIn('g2', str(ctx.exception))

    def test_an_unknown_key_fails(self):
        extra = {**STAGE_MAP, 'gates': {**STAGE_MAP['gates'], 'not_a_gate': []}}
        with self.assertRaises(export_roadmap.RoadmapError) as ctx:
            build(fixture(stage_map=extra))
        self.assertIn('not_a_gate', str(ctx.exception))

    def test_a_malformed_id_in_the_map_fails(self):
        bad = {**STAGE_MAP, 'gates': {**STAGE_MAP['gates'], 'g2': ['T100-T110']}}
        with self.assertRaises(export_roadmap.RoadmapError):
            build(fixture(stage_map=bad))


class MainTests(unittest.TestCase):
    def test_main_writes_the_file_and_exits_zero(self):
        root = fixture()
        out = root / 'public' / 'roadmap.json'
        code = export_roadmap.main(['--root', str(root), '--out', str(out), '--transition-keys', *TRANSITION_KEYS,
                                    '--gate-keys', *GATE_KEYS, '--commit', 'abc1234'])
        self.assertEqual(code, 0)
        data = json.loads(out.read_text(encoding='utf-8'))
        self.assertEqual(data['tasks']['T100']['kind'], 'todo')

    def test_main_reports_the_error_and_exits_one(self):
        root = fixture(stage_map={**STAGE_MAP, 'gates': {'g1': ['T777'], 'g2': []}})
        code = export_roadmap.main(['--root', str(root), '--out', str(root / 'x.json'), '--transition-keys',
                                    *TRANSITION_KEYS, '--gate-keys', *GATE_KEYS, '--commit', 'abc1234'])
        self.assertEqual(code, 1)
        self.assertFalse((root / 'x.json').exists())


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class LiveTests(unittest.TestCase):
    """The real PLAN.md, archive and stage map: the roadmap must agree with the plan on every PR."""

    def test_frozen_keys_come_from_journey_targets_and_the_gate_constants(self):
        transitions, gates = export_roadmap.frozen_keys(ROOT)
        source = (ROOT / 'src/frontend/src/components/admin/journeyTargets.js').read_text(encoding='utf-8')
        table = source[source.index('export const JOURNEY_TARGETS = {'):source.index('};', source.index('export const JOURNEY_TARGETS = {'))]
        expected = [m for m in re.findall(r"'(\w+->\w+)':", table) if m != 'signed_up->took_away']
        self.assertEqual(transitions, expected)
        self.assertEqual(len(transitions), 9)
        constants = _module('spend_readiness_constants', ROOT / 'src/backend/app/services/spend_readiness_constants.py')
        self.assertEqual(gates, [g['key'] for g in constants.GATES])
        self.assertEqual(len(gates), 11)

    def test_live_stage_map_is_complete_and_every_id_has_a_board_row(self):
        transitions, gates = export_roadmap.frozen_keys(ROOT)
        out = export_roadmap.build(ROOT, transition_keys=transitions, gate_keys=gates, commit='live')
        self.assertEqual(list(out['transitions']), transitions)
        self.assertEqual(list(out['gates']), gates)
        for key, ids in {**out['transitions'], **out['gates']}.items():
            for tid in ids:
                self.assertIn(tid, out['tasks'], f'{key}: {tid} has no board row')

    def test_the_nine_rows_dropped_by_the_2026_11_03_resort_are_back(self):
        transitions, gates = export_roadmap.frozen_keys(ROOT)
        tasks = export_roadmap.build(ROOT, transition_keys=transitions, gate_keys=gates, commit='live')['tasks']
        for tid in ['T14760', 'T14770', 'T14780', 'T14800', 'T14810', 'T14830', 'T14840', 'T14850', 'T14860']:
            self.assertIn(tid, tasks)

    def test_importing_the_export_and_the_parser_has_no_side_effects(self):
        code = ('import sys; sys.argv = ["x", "--out", "nowhere"]; sys.path.insert(0, "scripts"); '
                'import export_roadmap, plan_parser; print("ok")')
        out = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual((out.returncode, out.stdout.strip()), (0, 'ok'), out.stderr)


if __name__ == '__main__':
    unittest.main()
