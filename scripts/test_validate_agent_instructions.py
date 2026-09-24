import tempfile
from pathlib import Path
import unittest
from validate_agent_instructions import validate


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, path, text):
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf-8')

    def test_missing_agent_tools(self):
        self.write('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Review\n---\n')
        self.assertIn('tools', '\n'.join(validate(self.root, [])))

    def test_broken_link_and_deleted_target(self):
        self.write('CLAUDE.md', '[Missing](missing.md)')
        self.assertIn('missing local link', '\n'.join(validate(self.root, ['CLAUDE.md'])))

    def test_claude_extension_is_valid(self):
        self.write('.claude/skills/worker/SKILL.md', '---\nname: worker\ndescription: Drive worker\nuser-invocable: false\n---\n')
        self.assertEqual(validate(self.root, ['.claude/skills/worker/SKILL.md']), [])

    def test_wrong_case_skill_rejected(self):
        self.write('.claude/skills/worker/skill.md', '---\nname: worker\ndescription: Worker\n---\n')
        self.assertIn('filename', '\n'.join(validate(self.root, ['.claude/skills/worker/skill.md'])))

    def test_malformed_metadata_and_escape_rejected(self):
        self.write('.claude/agents/a.md', '---\nname: [\n---\n[x](../../../outside.md)')
        errors = validate(self.root, [])
        self.assertEqual(len(errors), 2)

    def test_fenced_examples_and_placeholders_are_not_links(self):
        self.write('CLAUDE.md', '```md\n[x](missing.md)\n```\n[x](docs/{id}.md)')
        self.assertEqual(validate(self.root, ['CLAUDE.md']), [])


if __name__ == '__main__':
    unittest.main()
