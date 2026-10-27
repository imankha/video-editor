"""Acceptance tests of job applicability, independent of workflow expression syntax."""
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import unittest

import ci_policy


ROOT = Path(__file__).resolve().parents[1]
ALL = {'tooling', 'instructions', 'frontend', 'backend', 'shrink', 'landing', 'harness'}


def jobs_block(workflow, job):
    """Text of one top-level job in a workflow file (jobs are 2-space-indented keys)."""
    lines = (ROOT / '.github/workflows' / workflow).read_text(encoding='utf-8').splitlines()
    start = lines.index(f'  {job}:')
    block = [lines[start]]
    for line in lines[start + 1:]:
        if line.startswith('  ') and not line.startswith('   ') and line.rstrip().endswith(':'):
            break
        block.append(line)
    return '\n'.join(block)


class RoutingTests(unittest.TestCase):
    def test_instructions_have_dedicated_checks_without_application_suites(self):
        self.assertEqual(ci_policy.required_jobs(['.claude/agents/tester.md']), {'tooling', 'instructions'})
        self.assertEqual(ci_policy.required_jobs(['.claude/knowledge/annotate.md']), {'tooling', 'instructions'})

    def test_audit_script_is_tooling_not_frontend(self):
        self.assertEqual(ci_policy.required_jobs(['scripts/audit-agent-instructions.py']), {'tooling', 'instructions'})

    def test_application_layers_remain_independent(self):
        self.assertEqual(ci_policy.required_jobs(['src/backend/app/main.py']), {'tooling', 'backend'})

    def test_frontend_change_also_builds_landing_which_imports_editor_modules(self):
        self.assertEqual(ci_policy.required_jobs(['src/frontend/src/App.jsx']), {'tooling', 'frontend', 'landing'})

    def test_landing_has_own_job_and_never_runs_app_suites(self):
        self.assertEqual(ci_policy.required_jobs(['src/landing/src/pages/index.astro']), {'tooling', 'landing'})

    def test_pricing_json_rebuilds_landing(self):
        self.assertEqual(ci_policy.required_jobs(['src/backend/app/pricing.json']), {'tooling', 'backend', 'landing'})

    def test_workflow_and_policy_changes_exercise_all_jobs(self):
        for path in ['.github/workflows/branch-ci.yml', 'scripts/ci_policy.py', 'scripts/test_ci_policy.py', '.gitattributes']:
            self.assertEqual(ci_policy.required_jobs([path]), ALL, path)

    def test_shrink_has_own_job(self):
        self.assertEqual(ci_policy.required_jobs(['scripts/shrink-tool/tool.js']), {'tooling', 'shrink'})

    def test_nested_instructions_are_not_application_changes(self):
        self.assertEqual(ci_policy.required_jobs(['src/backend/CLAUDE.md', 'src/frontend/.claude/skills/x/SKILL.md']), {'tooling', 'instructions'})

    def test_instruction_text_read_by_harness_tests_runs_harness(self):
        for path in ['.claude/ORCHESTRATION.md', 'scripts/dotask_kickoff_template.md']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling', 'instructions', 'harness'}, path)

    def test_harness_scripts_run_their_own_tests_not_app_suites(self):
        for path in ['scripts/dotask_evidence.py', 'scripts/dotask_cli.py', 'scripts/wave_profile.py',
                     'scripts/task.sh', 'scripts/test_dotask_cli.py', '.devcontainer/task-bootstrap.sh']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling', 'instructions', 'harness'}, path)

    def test_hook_and_skill_executables_never_route_to_app_suites(self):
        for path in ['.claude/hooks/lint-changed.cjs', '.claude/skills/cleanup-users/cleanup.py']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling', 'harness'}, path)

    def test_hand_run_ops_scripts_are_syntax_checked_not_app_suites(self):
        for path in ['scripts/reset_all_accounts.py', 'scripts/deploy_production.sh',
                     'scripts/migrations/migrate_staging.py', '.githooks/post-merge']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling', 'harness'}, path)

    def test_docs_and_attachments_have_lightweight_check_only(self):
        for path in ['docs/plans/example.md', 'docs/plans/PLAN.md', 'docs/plans/tasks/T1-mock.html',
                     'docs/plans/ux/run/scripts/driver.mjs', 'docs/plans/tasks/x/shot.png',
                     'scripts/migrations/README.md', 'src/assets/logo/logo-48.png',
                     '.gitignore', 'README.md', 'docker-compose.yml', '.env.example', 'start-dev.bat']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling'}, path)

    def test_worker_qa_evidence_gets_whitespace_check_only(self):
        for path in ['qa/proof.json', 'qa/red-Foo.log', 'qa/green-Foo.log', 'qa/BUG-1-390.png']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling'}, path)

    def test_frontend_change_with_qa_evidence_does_not_run_backend(self):
        self.assertEqual(ci_policy.required_jobs(['src/frontend/src/App.jsx', 'qa/proof.json', 'qa/red-App.log']),
                         {'tooling', 'frontend', 'landing'})

    def test_unclassified_paths_fail_loudly_and_are_all_named(self):
        for paths in (['unknown.config'], ['qa/test_helper.py'], ['newtool/src/index.ts'],
                      ['scripts/test_new_thing.py'], ['.claude/settings.json']):
            with self.subTest(paths=paths), self.assertRaises(ci_policy.UnclassifiedPath):
                ci_policy.required_jobs(paths)
        with self.assertRaises(ci_policy.UnclassifiedPath) as caught:
            ci_policy.required_jobs(['a.config', 'src/backend/app/main.py', 'b.config'])
        self.assertIn('a.config', str(caught.exception))
        self.assertIn('b.config', str(caught.exception))

    def test_mixed_changes_union_requirements(self):
        self.assertEqual(ci_policy.required_jobs(['CLAUDE.md', 'src/backend/app/main.py']), {'tooling', 'instructions', 'backend'})

    def test_invalid_repository_paths_rejected(self):
        for path in ['../outside', '/absolute', 'src\\backend\\app.py']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                ci_policy.required_jobs([path])

    def test_every_tracked_path_is_classified(self):
        tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode('utf-8').split('\0')
        unclassified = []
        for path in filter(None, tracked):
            try:
                ci_policy.required_jobs([path])
            except ci_policy.UnclassifiedPath:
                unclassified.append(path)
        # KNOWN_STRAYS were committed by accident and get no rule; editing one fails loudly.
        self.assertEqual(sorted(set(unclassified) - ci_policy.KNOWN_STRAYS), [])

    def test_every_script_test_is_run_by_the_job_it_is_routed_to(self):
        tracked = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', 'scripts']).decode().split()
        tests = {p for p in tracked if PurePosixPath(p).name.startswith('test_')
                 and p.endswith(('.py', '.sh')) and not p.startswith('scripts/shrink-')}
        self.assertEqual(tests, set(ci_policy.SCRIPT_TESTS))
        for test, job in ci_policy.SCRIPT_TESTS.items():
            with self.subTest(test=test):
                self.assertIn(job, ci_policy.required_jobs([test]))
                self.assertIn(test, jobs_block('branch-ci.yml', job))
                self.assertIn(test, jobs_block('master-ci.yml', job))


class WorkflowWiringTests(unittest.TestCase):
    def test_every_job_is_wired_into_changes_outputs_and_ci_ready(self):
        changes = jobs_block('branch-ci.yml', 'changes')
        ready = jobs_block('branch-ci.yml', 'ci-ready')
        for job in sorted(ci_policy.JOBS):
            with self.subTest(job=job):
                block = jobs_block('branch-ci.yml', job)
                self.assertIn(f'{job}: ${{{{ steps.filter.outputs.{job} }}}}', changes)
                self.assertRegex(ready, rf'needs: \[[^\]]*\b{job}\b')
                self.assertNotRegex(block, r'\n    name:', 'the landing gate matches jobs by key')
                if job != 'tooling':
                    self.assertIn(f"if: needs.changes.outputs.{job} == 'true'", block)

    def test_master_sweep_runs_every_job_unconditionally(self):
        for job in sorted(ci_policy.JOBS):
            with self.subTest(job=job):
                self.assertNotIn('if:', jobs_block('master-ci.yml', job).split('steps:')[0])


class AggregateTests(unittest.TestCase):
    def test_aggregate_rejects_missing_cancelled_failed_and_skipped_required_job(self):
        for result in [None, 'cancelled', 'failure', 'skipped']:
            outcomes = {'changes': {'result': 'success'}}
            if result:
                outcomes['instructions'] = {'result': result}
            self.assertTrue(ci_policy.aggregate(['instructions'], outcomes))
        self.assertEqual(ci_policy.aggregate(['instructions'], {
            'changes': {'result': 'success'}, 'instructions': {'result': 'success'},
            'frontend': {'result': 'skipped'}}), [])

    def test_failed_changes_can_never_make_empty_requirements_green(self):
        self.assertTrue(ci_policy.aggregate([], {'changes': {'result': 'failure'}}))

    def test_real_git_rename_retains_deleted_layer_and_manifest_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args):
                return subprocess.check_output(['git', '-C', folder, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'core.hooksPath', str(root/'no-hooks'))
            source = root/'src/backend/app/example.py'
            source.parent.mkdir(parents=True)
            source.write_text('example = 1\n')
            git('add', '.')
            git('commit', '-m', 'fixture before')
            base = git('rev-parse', 'HEAD')
            target = root/'docs/example file.md'
            target.parent.mkdir()
            source.rename(target)
            git('add', '-A')
            git('commit', '-m', 'fixture after')
            head = git('rev-parse', 'HEAD')
            record = ci_policy.manifest(root, base, head)
            self.assertEqual(record['base'], base)
            self.assertEqual(record['head'], head)
            self.assertEqual(record['paths'], ['docs/example file.md', 'src/backend/app/example.py'])
            self.assertIn('backend', record['required_jobs'])
            output = root/'manifest.json'
            result = subprocess.run([sys.executable, str(Path(ci_policy.__file__)), 'route', '--root', folder,
                '--base', base, '--head', head, '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text())['required_jobs'], ['backend', 'tooling'])


if __name__ == '__main__':
    unittest.main()
