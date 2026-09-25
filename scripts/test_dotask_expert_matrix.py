from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DOTASK = (ROOT / '.claude/skills/dotask/SKILL.md').read_text(encoding='utf-8')
ORCHESTRATION = (ROOT / '.claude/ORCHESTRATION.md').read_text(encoding='utf-8')


class DotaskExpertMatrixTests(unittest.TestCase):
    def test_matrix_declares_canonical_selection_and_always_on_gates(self):
        for phrase in (
            'Canonical expert-selection matrix',
            'knowledge gap',
            'backend-services',
            'persistence-sync',
            'modal-gpu',
            'export-pipeline',
            'keyframes-framing',
            'annotate',
            'ui-designer',
            'ux-investigator',
            'migration',
            'proof-verifier',
            'reviewer',
        ):
            self.assertIn(phrase, DOTASK)

    def test_matrix_requires_reason_and_prevents_roster_spawning(self):
        self.assertIn('record the reason', DOTASK)
        self.assertIn('Do not spawn every expert', DOTASK)
        self.assertIn('one primary expert', DOTASK)

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
