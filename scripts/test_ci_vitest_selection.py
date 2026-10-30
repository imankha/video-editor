"""T13950: which vitest tests Branch CI's frontend job runs for a diff (Master CI always runs all)."""
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_policy
from test_ci_policy import jobs_block

ROOT = Path(__file__).resolve().parents[1]
SCANNERS = ['src/frontend/src/components/instructions/guidePulse.guard.test.js']


def select(paths, deleted=()):
    return ci_policy.vitest_selection(paths, set(deleted), SCANNERS)


class SelectionTests(unittest.TestCase):
    def test_changed_frontend_code_runs_related_tests_plus_every_runtime_reader(self):
        self.assertEqual(select(['src/frontend/src/App.jsx', 'src/frontend/src/utils/a.test.js', 'docs/x.md']),
                         {'mode': 'related', 'full_because': [],
                          'files': ['src/App.jsx', 'src/components/instructions/guidePulse.guard.test.js',
                                    'src/utils/a.test.js']})

    def test_module_graph_dirs_outside_src_are_related_too(self):
        for path in ['src/frontend/eslint-rules/no-raw-editor-mode-literals.js',
                     'src/frontend/functions/shared/share-page.js', 'src/frontend/e2e/helpers.js',
                     'src/frontend/test/flake-repro/onUnhandledError.test.js']:
            with self.subTest(path=path):
                self.assertEqual(select([path])['mode'], 'related')

    def test_inputs_the_module_graph_cannot_see_run_the_full_suite(self):
        for path in ['src/frontend/package.json', 'src/frontend/package-lock.json', 'src/frontend/vite.config.js',
                     'src/frontend/vitest.onUnhandledError.js', 'src/frontend/tailwind.config.js',
                     'src/frontend/postcss.config.js', 'src/frontend/eslint.config.js', 'src/frontend/.env.production',
                     'src/frontend/src/version.stub.json', 'src/frontend/src/utils/veoHighlights/manifests/rebels.json',
                     'src/frontend/src/index.css', 'src/frontend/index.html', 'src/frontend/tests/perf/load-perf.spec.js',
                     'src/backend/app/pricing.json', 'src/backend/app/quest_config.py',
                     'scripts/check-viewport-units.mjs', '.github/workflows/branch-ci.yml', '.gitattributes']:
            with self.subTest(path=path):
                self.assertEqual(select(['src/frontend/src/App.jsx', path]),
                                 {'mode': 'full', 'files': [], 'full_because': [path]})

    def test_deleted_module_runs_the_full_suite(self):
        # A deleted file is no longer in the graph, so its former importers cannot be found.
        self.assertEqual(select(['src/frontend/src/old.js'], deleted=['src/frontend/src/old.js'])['mode'], 'full')

    def test_diff_without_frontend_inputs_selects_nothing(self):
        self.assertEqual(select(['src/backend/app/main.py', 'scripts/ci_policy.py'])['mode'], 'none')

    def test_runtime_reader_scan_finds_the_source_scanning_tests(self):
        head = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip()
        readers = ci_policy.runtime_read_tests(ROOT, head)
        for test in ['src/frontend/src/components/instructions/guidePulse.guard.test.js',  # readdirSync
                     'src/frontend/src/components/instructions/guideRules.pulse.test.js',  # import.meta.glob ?raw
                     'src/frontend/src/utils/veoHighlights/manifests.test.js',  # JSON fixtures via fs
                     'src/frontend/src/config/shippedCopyHygiene.test.js']:
            self.assertIn(test, readers)
        self.assertNotIn('src/frontend/src/components/AttachVideoModal.test.jsx', readers)

    def test_manifest_records_selection_for_the_frontend_job(self):
        with tempfile.TemporaryDirectory() as folder:
            def git(*args):
                return subprocess.check_output(['git', '-C', folder, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'core.hooksPath', str(Path(folder)/'no-hooks'))
            src = Path(folder)/'src/frontend/src'
            src.mkdir(parents=True)
            (src/'a.js').write_text('export const a = 1\n')
            (src/'scan.test.js').write_text("import { readFileSync } from 'node:fs'\n")
            git('add', '.')
            git('commit', '-m', 'before')
            base = git('rev-parse', 'HEAD')
            (src/'a.js').write_text('export const a = 2\n')
            git('commit', '-am', 'after')
            record = ci_policy.manifest(Path(folder), base, git('rev-parse', 'HEAD'))
            self.assertEqual(record['vitest'], {'mode': 'related', 'full_because': [],
                                                'files': ['src/a.js', 'src/scan.test.js']})


class WorkflowWiringTests(unittest.TestCase):
    def test_branch_ci_feeds_the_selection_to_vitest_related(self):
        changes = jobs_block('branch-ci.yml', 'changes')
        for output in ['vitest_mode', 'vitest_files', 'vitest_full_because']:
            self.assertIn(f'{output}: ${{{{ steps.filter.outputs.{output} }}}}', changes)
        frontend = jobs_block('branch-ci.yml', 'frontend')
        self.assertIn('npx vitest related --run --retry=2 --passWithNoTests', frontend)
        self.assertIn('npx vitest run --retry=2', frontend)

    def test_master_ci_keeps_the_full_suite(self):
        frontend = jobs_block('master-ci.yml', 'frontend')
        self.assertIn('npx vitest run --retry=2', frontend)
        self.assertNotIn('related', frontend)


if __name__ == '__main__':
    unittest.main()
