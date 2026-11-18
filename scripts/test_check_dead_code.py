"""Acceptance tests for the dead-code ratchet (T15910)."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

import check_dead_code as dead

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'src/frontend'
BACKEND = ROOT / 'src/backend'
OWNERS = ('T4440', 'T11180', 'T11185', 'T11300')


def tree(folder, files):
    root = Path(folder)
    for path, text in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
    return root


class CompareTests(unittest.TestCase):
    def test_a_finding_missing_from_the_baseline_fails(self):
        errors = dead.compare({'frontend:file:src/a.js', 'frontend:file:src/b.js'},
                              {'frontend:file:src/a.js': 'T11300: reused later'})
        self.assertEqual(len(errors), 1)
        self.assertIn('frontend:file:src/b.js', errors[0])

    def test_a_baseline_entry_that_no_longer_exists_fails_so_the_baseline_only_shrinks(self):
        errors = dead.compare(set(), {'frontend:file:src/gone.js': 'T11300: reused later'})
        self.assertEqual(len(errors), 1)
        self.assertIn('frontend:file:src/gone.js', errors[0])

    def test_a_baseline_entry_without_an_owning_task_fails(self):
        errors = dead.compare({'frontend:file:src/a.js'}, {'frontend:file:src/a.js': 'kept for now'})
        self.assertEqual(len(errors), 1)

    def test_matching_findings_pass(self):
        self.assertEqual(dead.compare({'frontend:file:src/a.js'}, {'frontend:file:src/a.js': 'T11300: x'}), [])


class CommittedBaselineTests(unittest.TestCase):
    def test_every_baseline_entry_is_owned_by_a_named_task(self):
        baseline = dead.load_baseline()
        self.assertTrue(baseline, 'scripts/dead_code_baseline.json is missing or empty')
        for finding, note in baseline.items():
            with self.subTest(finding=finding):
                self.assertRegex(note, r'^(%s)\b' % '|'.join(OWNERS))

    def test_unclaimed_findings_from_the_first_read_are_deleted(self):
        for path in ['components/CropControls.jsx', 'components/DebugInfo.jsx', 'components/ProjectHeader.jsx',
                     'components/collections/UnlockProgress.jsx', 'hooks/useExportManager.js', 'hooks/useRawClips.js',
                     'hooks/useStorageUrl.js', 'utils/gameNameLookup.js', 'components/PaymentResultModal.jsx',
                     'components/admin/FunnelChart.jsx', 'components/ThreePositionToggle.jsx',
                     'components/timeline/index.js', 'constants/index.js', 'constants/editorModes.js',
                     'constants/keyframeOrigins.js']:
            with self.subTest(path=path):
                self.assertFalse((FRONTEND / 'src' / path).exists())
        self.assertTrue((FRONTEND / 'src/utils/veoHighlights/durationWorker.js').exists())


class FrontendTests(unittest.TestCase):
    def test_an_unimported_frontend_module_is_reported(self):
        probe = FRONTEND / 'src/utils/deadCodeProbeT15910.js'
        probe.write_text('export const probe = 1;\n', encoding='utf-8')
        try:
            findings = dead.knip_files(FRONTEND)
        finally:
            probe.unlink()
        self.assertIn('frontend:file:src/utils/deadCodeProbeT15910.js', findings)

    def test_a_worker_loaded_by_url_is_an_entry_not_a_finding(self):
        self.assertNotIn('frontend:file:src/utils/veoHighlights/durationWorker.js', dead.knip_files(FRONTEND))


class BackendTests(unittest.TestCase):
    def test_a_module_nothing_imports_is_reported_even_when_tests_import_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = tree(folder, {
                'app/__init__.py': '', 'app/main.py': 'from app import used\n', 'app/used.py': 'X = 1\n',
                'app/orphan.py': 'def helper():\n    return 1\n',
                'tests/test_orphan.py': 'from app.orphan import helper\n',
            })
            self.assertEqual(dead.orphan_modules(root), {'backend:orphan:app.orphan'})

    def test_a_branch_adding_an_unused_backend_function_is_reported(self):
        base = {'app/__init__.py': '', 'app/main.py': 'from app.svc import used\nused()\n',
                'app/svc.py': 'def used():\n    return 1\n'}
        head = dict(base, **{'app/svc.py': 'def used():\n    return 1\n\n\ndef never_called():\n    return 2\n'})
        with tempfile.TemporaryDirectory() as b, tempfile.TemporaryDirectory() as h:
            added = dead.new_unused_definitions(tree(b, base), tree(h, head))
        self.assertEqual(len(added), 1)
        self.assertRegex(next(iter(added)), r"app/svc\.py: unused function 'never_called'")

    def test_a_bare_pydantic_field_validator_is_framework_called_not_dead(self):
        # T16900: auth.py imports field_validator by name, so the decorator has no "module." prefix.
        model = ('from pydantic import BaseModel, field_validator, model_validator\n\n\n'
                 'class Body(BaseModel):\n    host: str | None = None\n\n'
                 '    @field_validator("host")\n    @classmethod\n    def _check_host(cls, v):\n        return v\n\n'
                 '    @model_validator(mode="after")\n    def _check_all(self):\n        return self\n')
        base = {'app/__init__.py': '', 'app/main.py': 'from app.svc import Body\nBody()\n',
                'app/svc.py': 'from pydantic import BaseModel\n\n\nclass Body(BaseModel):\n    host: str | None = None\n'}
        head = dict(base, **{'app/svc.py': model})
        with tempfile.TemporaryDirectory() as b, tempfile.TemporaryDirectory() as h:
            self.assertEqual(dead.new_unused_definitions(tree(b, base), tree(h, head)), set())

    def test_a_dead_function_master_only_moved_is_not_branch_added(self):
        # CI passes the master tip as --base; master moving a file must not blame the branch.
        def git(repo, *args):
            subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True)

        dead_fn = 'def used():\n    return 1\n\n\ndef long_dead():\n    return 2\n'
        with tempfile.TemporaryDirectory() as folder:
            repo = tree(folder, {'src/backend/app/__init__.py': '', 'src/backend/app/main.py':
                                 'from app.svc import used\nused()\n', 'src/backend/app/svc.py': dead_fn})
            git(repo, 'init', '-q', '-b', 'master')
            git(repo, 'add', '-A')
            git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
            git(repo, 'checkout', '-qb', 'feature')
            (repo / 'src/backend/app/main.py').write_text('from app.svc import used\nused()\nused()\n')
            git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'branch work')
            git(repo, 'checkout', '-q', 'master')
            git(repo, 'mv', 'src/backend/app/svc.py', 'src/backend/app/moved.py')
            (repo / 'src/backend/app/main.py').write_text('from app.moved import used\nused()\n')
            git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'master moves svc')
            git(repo, 'checkout', '-q', 'feature')
            self.assertEqual(dead.branch_added_definitions(repo, 'master', 'HEAD'), set())

    def test_vulture_findings_carry_no_line_numbers_so_edits_above_do_not_churn_the_baseline(self):
        with tempfile.TemporaryDirectory() as folder:
            root = tree(folder, {'app/__init__.py': '', 'app/x.py': 'def f():\n    return 1\n    print("never")\n'})
            findings = dead.vulture_findings(root)
        self.assertEqual(len(findings), 1)
        self.assertFalse(re.search(r':\d+:', next(iter(findings))))


if __name__ == '__main__':
    unittest.main()
