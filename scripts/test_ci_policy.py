"""Acceptance tests of job applicability, independent of workflow expression syntax."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import ci_policy


class RoutingTests(unittest.TestCase):
    def test_instructions_have_dedicated_checks_without_application_suites(self):
        self.assertEqual(ci_policy.required_jobs(['.claude/agents/tester.md']), {'tooling', 'instructions'})

    def test_audit_script_is_tooling_not_frontend(self):
        self.assertEqual(ci_policy.required_jobs(['scripts/audit-agent-instructions.py']), {'tooling', 'instructions'})

    def test_unknown_shared_script_cannot_miss_backend(self):
        self.assertTrue({'frontend', 'backend', 'tooling'} <= ci_policy.required_jobs(['scripts/new-shared.py']))

    def test_application_layers_remain_independent(self):
        self.assertEqual(ci_policy.required_jobs(['src/backend/app/main.py']), {'tooling', 'backend'})
        self.assertEqual(ci_policy.required_jobs(['src/frontend/src/App.jsx']), {'tooling', 'frontend'})

    def test_workflow_and_policy_changes_exercise_all_jobs(self):
        for path in ['.github/workflows/branch-ci.yml', 'scripts/ci_policy.py']:
            self.assertEqual(ci_policy.required_jobs([path]), {'tooling','instructions','frontend','backend','shrink'})

    def test_shrink_has_own_job(self):
        self.assertEqual(ci_policy.required_jobs(['scripts/shrink-tool/tool.js']), {'tooling','shrink'})

    def test_nested_instructions_are_not_application_changes(self):
        self.assertEqual(ci_policy.required_jobs(['src/backend/CLAUDE.md', 'src/frontend/.claude/skills/x/SKILL.md']), {'tooling','instructions'})

    def test_docs_have_lightweight_check_and_unknown_configuration_is_conservative(self):
        self.assertEqual(ci_policy.required_jobs(['docs/plans/example.md']), {'tooling'})
        self.assertTrue({'frontend','backend'} <= ci_policy.required_jobs(['unknown.config']))

    def test_mixed_changes_union_requirements(self):
        self.assertEqual(ci_policy.required_jobs(['CLAUDE.md','src/backend/app/main.py']), {'tooling','instructions','backend'})

    def test_invalid_repository_paths_rejected(self):
        for path in ['../outside', '/absolute', 'src\\backend\\app.py']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                ci_policy.required_jobs([path])

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
