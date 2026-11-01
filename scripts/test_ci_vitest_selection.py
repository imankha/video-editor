"""T13950: which vitest tests Branch CI's frontend job runs for a diff (Master CI always runs all)."""
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_policy
from test_ci_policy import jobs_block

ROOT = Path(__file__).resolve().parents[1]
SCANNERS = ['src/frontend/src/components/instructions/guidePulse.guard.test.js']


READERS = {
    'pricing.json': ['src/frontend/src/config/pricing.js', 'src/frontend/src/config/pricing.test.js'],
    'quest_config.py': ['src/frontend/src/utils/questDefinitions.test.jsx'],
    'report-problem.png': ['src/frontend/src/components/ReportProblemButton.icon.test.jsx'],
}


def select(paths, deleted=()):
    return ci_policy.vitest_selection(paths, set(deleted), SCANNERS, lambda name: READERS.get(name, []))


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
                     'scripts/check-viewport-units.mjs', '.github/workflows/branch-ci.yml', '.gitattributes']:
            with self.subTest(path=path):
                self.assertEqual(select(['src/frontend/src/App.jsx', path]),
                                 {'mode': 'full', 'files': [], 'full_because': [path]})

    def test_static_assets_run_no_vitest_unless_a_test_names_them(self):
        # #672, #668: public/*.png edits ran the whole suite.
        for paths in [['src/frontend/public/icon-192.png', 'src/frontend/public/og-card.jpg'],
                      ['src/frontend/public/favicon.svg']]:
            with self.subTest(paths=paths):
                self.assertEqual(select(paths), {'mode': 'none', 'files': [], 'full_because': []})
        self.assertEqual(select(['src/frontend/public/icons/report-problem.png']),
                         {'mode': 'related', 'full_because': [],
                          'files': ['src/components/ReportProblemButton.icon.test.jsx',
                                    'src/components/instructions/guidePulse.guard.test.js']})

    def test_non_asset_public_files_still_run_the_full_suite(self):
        for path in ['src/frontend/public/_headers', 'src/frontend/public/e2e-test-only-stale-sw.js']:
            with self.subTest(path=path):
                self.assertEqual(select([path])['mode'], 'full')

    def test_cross_tree_data_file_runs_only_what_reads_it(self):
        # #673: pricing.json alone ran the whole suite.
        self.assertEqual(select(['src/backend/app/pricing.json']),
                         {'mode': 'related', 'full_because': [],
                          'files': ['src/components/instructions/guidePulse.guard.test.js',
                                    'src/config/pricing.js', 'src/config/pricing.test.js']})
        self.assertIn('src/utils/questDefinitions.test.jsx', select(['src/backend/app/quest_config.py'])['files'])

    def test_cross_tree_data_file_nobody_reads_selects_nothing(self):
        READERS_BACKUP = dict(READERS)
        READERS.clear()
        try:
            self.assertEqual(select(['src/backend/app/pricing.json'])['mode'], 'none')
        finally:
            READERS.update(READERS_BACKUP)

    def test_data_file_plus_code_merges_with_related_set(self):
        got = select(['src/backend/app/pricing.json', 'src/frontend/src/App.jsx'])
        self.assertEqual(got['mode'], 'related')
        self.assertEqual(got['files'], ['src/App.jsx', 'src/components/instructions/guidePulse.guard.test.js',
                                        'src/config/pricing.js', 'src/config/pricing.test.js'])

    def test_data_file_alongside_a_full_trigger_is_full(self):
        self.assertEqual(select(['src/backend/app/pricing.json', 'src/frontend/package-lock.json'])['mode'], 'full')

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
        shard = jobs_block('branch-ci.yml', 'frontend-shard')
        self.assertIn('npx vitest related --run --retry=2 --passWithNoTests --shard=${{ matrix.shard }}/3', shard)
        self.assertIn('npx vitest run --retry=2 --shard=${{ matrix.shard }}/3', shard)

    def test_master_ci_keeps_the_full_suite(self):
        shard = jobs_block('master-ci.yml', 'frontend-shard')
        self.assertIn('npx vitest run --retry=2 --shard=${{ matrix.shard }}/3', shard)
        self.assertNotIn('related', shard)


class ShardWiringTests(unittest.TestCase):
    """T13966: vitest runs in 3 shards; the `frontend` aggregate stays the one required check."""

    def assert_wiring(self, workflow):
        shard = jobs_block(workflow, 'frontend-shard')
        self.assertIn('fail-fast: false', shard, 'one red shard must not cancel the others')
        self.assertRegex(shard, r'shard: \[1, 2, 3\]')
        self.assertNotIn('eslint', shard, 'lint runs once, in frontend-lint')
        lint = jobs_block(workflow, 'frontend-lint')
        self.assertIn('eslint src --max-warnings 360', lint)
        self.assertNotIn('vitest', lint)
        aggregate = jobs_block(workflow, 'frontend')
        self.assertRegex(aggregate, r'needs: \[[^\]]*\bfrontend-lint\b[^\]]*\bfrontend-shard\b')
        self.assertIn('SHARD_RESULT: ${{ needs.frontend-shard.result }}', aggregate)
        self.assertIn('LINT_RESULT: ${{ needs.frontend-lint.result }}', aggregate)
        return aggregate

    def test_branch_ci_aggregate_runs_even_when_a_shard_fails(self):
        aggregate = self.assert_wiring('branch-ci.yml')
        self.assertIn("if: always() && needs.changes.outputs.frontend == 'true'", aggregate)
        self.assertRegex(jobs_block('branch-ci.yml', 'ci-ready'), r'needs: \[[^\]]*\bfrontend\b')

    def test_master_ci_has_the_same_shape(self):
        self.assert_wiring('master-ci.yml')


if __name__ == '__main__':
    unittest.main()
