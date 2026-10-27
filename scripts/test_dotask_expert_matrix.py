from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ORCHESTRATION = (ROOT / '.claude/ORCHESTRATION.md').read_text(encoding='utf-8')


# The dotask skill's expert-selection matrix was retired with the supervisor (dotask v6,
# 2026-10-08); ORCHESTRATION.md is now the only matrix, so only it is pinned here.
class DotaskExpertMatrixTests(unittest.TestCase):
    def test_orchestration_matrix_references_real_resources(self):
        for obsolete in ('mvc-pattern', 'state-management', 'data-always-ready',
                         'type-safety', 'gesture-based-sync', 'persistence-model',
                         'database-schema', 'bug-reproduction'):
            self.assertNotIn(obsolete, ORCHESTRATION)
        for resource in ('.claude/knowledge/backend-services.md',
                         '.claude/knowledge/persistence-sync.md',
                         '.claude/skills/run-tests/SKILL.md'):
            self.assertIn(resource, ORCHESTRATION)


if __name__ == '__main__':
    unittest.main()
