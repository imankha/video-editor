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


if __name__ == '__main__':
    unittest.main()
