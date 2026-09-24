"""Behavioral fixtures for the instruction audit, isolated from the real checkout."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

AUDIT = Path(__file__).with_name('audit-agent-instructions.py')


class InstructionAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.write('scripts/audit-agent-instructions.py', AUDIT.read_text(encoding='utf-8'))
        self.write('CLAUDE.md', '# Policy\n')
        self.write('.claude/ORCHESTRATION.md', '# Orchestration\n')
        self.write('.claude/references/agent-contract.md', '# Contract\n')
        self.agent = ('---\nname: reviewer\ndescription: Assess quality\n'
                      'tools: Read, Grep, Glob\n---\n# Reviewer\n'
                      '[Shared Agent Contract](../references/agent-contract.md)\n')
        self.write('.claude/agents/reviewer.md', self.agent)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

    def run_audit(self):
        return subprocess.run([sys.executable, str(self.root / 'scripts/audit-agent-instructions.py')],
                              capture_output=True, text=True)

    def rejected(self, diagnostic):
        result = self.run_audit()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(diagnostic, result.stdout)

    def test_valid_contract_passes(self):
        result = self.run_audit()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_read_only_agent_also_requires_explicit_tools(self):
        self.write('.claude/agents/reviewer.md', self.agent.replace('tools: Read, Grep, Glob\n', ''))
        self.rejected('explicit tools')

    def test_legacy_invocation_in_skill_is_rejected(self):
        self.write('.claude/skills/example/SKILL.md', 'subagent_type: general-purpose\n')
        self.rejected('legacy agent invocation')

    def test_missing_shared_contract_is_rejected(self):
        (self.root / '.claude/references/agent-contract.md').unlink()
        self.rejected('missing shared agent contract')

    def test_agent_must_reference_contract(self):
        self.write('.claude/agents/reviewer.md', self.agent.split('[Shared Agent Contract]')[0])
        self.rejected('must reference shared agent contract')

    def test_unknown_agent_in_handoff_is_rejected(self):
        self.write('.claude/schemas/handoffs.md', 'subagent_type: imaginary-agent\n')
        self.rejected('unknown registered agent')


if __name__ == '__main__':
    unittest.main()
