"""T13960: which pytest tests Branch CI's backend job runs (testmon vs full suite; Master CI always runs all)."""
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_policy
from test_ci_policy import jobs_block

ROOT = Path(__file__).resolve().parents[1]
APP = 'src/backend/app/services/storage.py'
TEST = 'src/backend/tests/test_t4050_durable_sync.py'
IMPORT_LINES = {'lines': {'app/a.py': [1, 4]}, 'unimportable': {}}  # import_lines.json: lines run at import, relative to src/backend
ALWAYS = ['tests/test_spawn.py']  # always_run.json


def select(paths, deleted=(), import_time=None, shared_tests=()):
    return ci_policy.pytest_selection(paths, set(deleted), import_time or {}, set(shared_tests))


def changed(old, new, executed=()):
    """Reason a .py edit changes what runs at import, or None; `executed` = old-file lines run at import."""
    return ci_policy.import_time_change(old, new, set(executed))


class SelectionTests(unittest.TestCase):
    def test_function_body_change_runs_testmon(self):
        self.assertEqual(select([APP, 'src/backend/tests/test_new.py', 'docs/x.md']),
                         {'mode': 'testmon', 'full_because': []})

    def test_inputs_testmon_cannot_see_run_the_full_suite(self):
        for path in ['src/backend/requirements.test.txt', 'src/backend/requirements.prod.txt',
                     'src/backend/pytest.ini', 'src/backend/tests/conftest.py', 'src/backend/app/conftest.py',
                     'src/backend/app/migrations/user_db/v060_x.py', 'src/backend/app/services/pg.py',
                     'src/backend/app/services/user_db.py', 'src/backend/app/database.py',
                     'src/backend/tests/fixtures/x.json', 'src/backend/app/pricing.json',
                     'formal annotations/test.short/a.json', 'scripts/delete_user.py',
                     'src/frontend/src/utils/introCardGeometry.js', 'nuf-reset-emails.txt',
                     '.github/workflows/branch-ci.yml', '.gitattributes']:
            with self.subTest(path=path):
                result = select([APP, path])
                self.assertEqual(result['mode'], 'full')
                self.assertEqual([r.split(':')[0] for r in result['full_because']], [path])

    def test_deleted_module_runs_the_full_suite(self):
        self.assertEqual(select([APP], deleted=[APP])['mode'], 'full')

    def test_import_time_change_runs_the_full_suite(self):
        result = select([APP], import_time={APP: 'module-level code changed'})
        self.assertEqual(result, {'mode': 'full', 'full_because': [APP + ': module-level code changed']})

    def test_test_file_module_level_change_is_testmons_unless_another_test_imports_it(self):
        self.assertEqual(select([TEST], import_time={TEST: 'x'})['mode'], 'testmon')
        self.assertEqual(select([TEST], import_time={TEST: 'x'}, shared_tests=[TEST])['mode'], 'full')

    def test_diff_without_backend_inputs_selects_nothing(self):
        self.assertEqual(select(['src/frontend/src/App.jsx', 'scripts/ci_policy.py'])['mode'], 'none')


class ImportTimeTests(unittest.TestCase):
    """testmon only links a test to files it executed a line of; values built at import are invisible."""
    BASE = ('import os\nLIMIT = 5\n\n\nclass Model:\n    size: int = 3\n\n    def grow(self):\n        return 1\n\n\n'
            '@register\ndef handler(x=1):\n    """Doc."""\n    return x\n\n\ndef helper():\n    return 2\n\n\n'
            'TABLE = helper()\n')

    def test_body_comment_and_docstring_edits_stay_with_testmon(self):
        for new in [self.BASE.replace('return x', 'return x + 1'),
                    self.BASE.replace('return 1', 'return 1  # grew'),
                    self.BASE.replace('"""Doc."""', '"""Other."""'),
                    self.BASE.replace('LIMIT = 5', '# note\nLIMIT = 5')]:
            with self.subTest(new=new):
                self.assertIsNone(changed(self.BASE, new))

    def test_module_level_edits_need_the_full_suite(self):
        for new in [self.BASE.replace('LIMIT = 5', 'LIMIT = 6'),
                    self.BASE.replace('size: int = 3', 'size: int = 4'),
                    self.BASE.replace('import os', 'import os\nimport sys'),
                    self.BASE.replace('@register\n', ''),
                    self.BASE.replace('x=1', 'x=2'),
                    self.BASE + '\n\ndef added():\n    pass\n']:
            with self.subTest(new=new):
                self.assertEqual(changed(self.BASE, new), 'module-level code changed')

    def test_body_overlapping_a_recorded_import_time_line_needs_the_full_suite(self):
        new = self.BASE.replace('return 2', 'return 3')
        self.assertEqual(changed(self.BASE, new, executed={1, 2, 19, 22}), 'runs at import: helper')
        self.assertIsNone(changed(self.BASE, new, executed={1, 2, 22}))  # body line 19 never ran at import

    def test_cached_function_bodies_count_as_skeleton(self):
        for decorator in ['@lru_cache(maxsize=None)', '@functools.cache', '@cached_property']:
            old = f'class C:\n    {decorator}\n    def cfg(self):\n        return 1\n'
            with self.subTest(decorator=decorator):
                self.assertEqual(changed(old, old.replace('return 1', 'return 2')), 'cached function body: C.cfg')

    def test_new_or_unparsable_module_needs_the_full_suite(self):
        self.assertIsNotNone(changed(None, 'X = 1\n'))
        self.assertIsNotNone(ci_policy.import_time_change('X = 1\n', 'def (\n', set()))


class PlanTests(unittest.TestCase):
    def fixture(self, folder):
        def git(*args):
            return subprocess.check_output(['git', '-C', folder, *args], stderr=subprocess.DEVNULL).decode().strip()
        git('init')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'core.hooksPath', str(Path(folder)/'no-hooks'))
        tests = Path(folder)/'src/backend/tests'
        tests.mkdir(parents=True)
        (Path(folder)/'src/backend/app').mkdir()
        (Path(folder)/'src/backend/app/a.py').write_text('X = 1\n\n\ndef f():\n    return X\n')
        (tests/'test_spawn.py').write_text('import sys\n\n\ndef test_s():\n    assert sys.executable\n')
        (tests/'test_plain.py').write_text('def test_p():\n    pass\n')
        git('add', '.')
        git('commit', '-m', 'baseline')
        return git, git('rev-parse', 'HEAD')

    def test_body_change_plans_testmon_plus_tests_coverage_cannot_follow(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            (Path(folder)/'src/backend/app/a.py').write_text('X = 1\n\n\ndef f():\n    return X + 1\n')
            git('commit', '-am', 'body')
            head = git('rev-parse', 'HEAD')
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, IMPORT_LINES, ALWAYS)
            self.assertEqual(plan, {'mode': 'testmon', 'full_because': [], 'baseline': baseline,
                                    'always_run': ['tests/test_spawn.py']})

    def test_constant_change_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            (Path(folder)/'src/backend/app/a.py').write_text('X = 2\n\n\ndef f():\n    return X\n')
            git('commit', '-am', 'constant')
            head = git('rev-parse', 'HEAD')
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, IMPORT_LINES, ALWAYS)
            self.assertEqual(plan['mode'], 'full')
            self.assertEqual(plan['always_run'], [])

    def test_body_run_at_import_per_the_baseline_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            (Path(folder)/'src/backend/app/a.py').write_text('X = 1\n\n\ndef f():\n    return X + 1\n')
            git('commit', '-am', 'body')
            head = git('rev-parse', 'HEAD')
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, {'lines': {'app/a.py': [1, 4, 5]}, 'unimportable': {}}, ALWAYS)
            self.assertEqual(plan['mode'], 'full')
            self.assertIn('runs at import: f', plan['full_because'][0])

    def test_change_to_unimportable_module_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            (Path(folder)/'src/backend/app/a.py').write_text('X = 1\n\n\ndef f():\n    return X + 1\n')
            git('commit', '-am', 'body')
            head = git('rev-parse', 'HEAD')
            lines = {'lines': {}, 'unimportable': {'app/a.py': 'torch'}}
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, lines, ALWAYS)
            self.assertEqual(plan['mode'], 'full')
            self.assertIn('app/a.py', plan['full_because'][0])
            self.assertIn('torch', plan['full_because'][0])

    def test_deleted_unimportable_module_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            git('rm', '-q', 'src/backend/app/a.py')
            git('commit', '-m', 'delete')
            head = git('rev-parse', 'HEAD')
            lines = {'lines': {}, 'unimportable': {'app/a.py': 'torch'}}
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, lines, ALWAYS)
            self.assertEqual(plan['mode'], 'full')
            self.assertIn('torch', plan['full_because'][0])

    def test_old_flat_import_lines_shape_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            head = git('rev-parse', 'HEAD')
            plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, {'app/a.py': [1, 4]}, ALWAYS)
            self.assertEqual(plan['mode'], 'full')
            self.assertIn('old shape', plan['full_because'][0])

    def test_missing_baseline_data_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, baseline = self.fixture(folder)
            head = git('rev-parse', 'HEAD')
            for lines, always, reason in [(None, ALWAYS, 'import_lines.json'), (IMPORT_LINES, None, 'always_run.json')]:
                with self.subTest(reason=reason):
                    plan = ci_policy.pytest_plan(Path(folder), head, head, baseline, lines, always)
                    self.assertEqual(plan['mode'], 'full')
                    self.assertIn(reason, plan['full_because'][0])

    def test_missing_or_foreign_baseline_plans_the_full_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            git, _ = self.fixture(folder)
            git('checkout', '-q', '-b', 'side')
            git('commit', '-q', '--allow-empty', '-m', 'side')
            side = git('rev-parse', 'HEAD')
            git('checkout', '-q', '-')
            git('commit', '-q', '--allow-empty', '-m', 'master')
            base = git('rev-parse', 'HEAD')
            for baseline, reason in [(None, 'no Master CI testmon baseline'),
                                     (side, 'not an ancestor'), ('0' * 40, 'not an ancestor')]:
                with self.subTest(baseline=baseline):
                    plan = ci_policy.pytest_plan(Path(folder), base, base, baseline, IMPORT_LINES, ALWAYS)
                    self.assertEqual(plan['mode'], 'full')
                    self.assertIn(reason, plan['full_because'][0])

    def test_shared_test_modules_come_from_imports_between_tests(self):
        head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip()
        shared = ci_policy.shared_test_modules(ROOT, head)
        self.assertIn('src/backend/tests/test_t4050_durable_sync.py', shared)
        self.assertNotIn('src/backend/tests/test_clip_phases.py', shared)


class ReplayTests(unittest.TestCase):
    def test_b1f1dd20_runs_the_full_suite_so_the_regressed_test_runs(self):
        """b1f1dd20 renamed a private helper; test_t7600_orphan_raw_clips.py broke and only Master CI saw it."""
        def rev(name):
            return subprocess.run(['git', '-C', str(ROOT), 'rev-parse', name], capture_output=True, text=True)
        parent, commit = rev('b1f1dd204^'), rev('b1f1dd204')
        if parent.returncode or commit.returncode:
            self.skipTest('history not available (shallow checkout)')
        plan = ci_policy.pytest_plan(ROOT, parent.stdout.strip(), commit.stdout.strip(), parent.stdout.strip(),
                                    {'lines': {}, 'unimportable': {}}, [])
        self.assertEqual(plan['mode'], 'full')


class WorkflowWiringTests(unittest.TestCase):
    def test_master_ci_records_and_saves_a_baseline_per_merge(self):
        backend = jobs_block('master-ci.yml', 'testmon-baseline')  # T13964: its own job beside the shards
        self.assertIn('rm -f .testmondata*', backend)
        self.assertIn('wal_checkpoint(TRUNCATE)', backend)
        self.assertIn('uses: actions/cache/save@v4', backend)
        self.assertIn('key: testmon-${{ github.sha }}', backend)

    def test_branch_ci_restores_the_baseline_and_runs_the_plan(self):
        backend = jobs_block('branch-ci.yml', 'backend-shard')  # T13964: every shard plans and selects
        self.assertIn('uses: actions/cache/restore@v4', backend)
        self.assertIn('restore-keys: testmon-', backend)
        self.assertIn('ci_policy.py pytest-plan', backend)
        self.assertIn('--testmon --testmon-nocollect --collect-only -q tests/test_*.py', backend)
        self.assertIn('src/backend/always_run.json', backend)
        self.assertIn('src/backend/import_lines.json', backend)
        self.assertIn('All tests have to be re-executed', backend)
        self.assertIn('INPUT=$(echo tests/test_*.py)', backend)
        self.assertIn('unexpected pytest mode', backend)

    def test_testmon_is_a_pinned_test_dependency(self):
        text = (ROOT/'src/backend/requirements.test.txt').read_text(encoding='utf-8')
        self.assertIn('pytest-testmon==2.2.0', text)


if __name__ == '__main__':
    unittest.main()
