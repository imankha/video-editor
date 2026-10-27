"""Acceptance tests for the doc-drift floor, run against throwaway git repositories."""
from pathlib import Path
import subprocess
import tempfile
import unittest

import check_doc_drift as drift


class Repo:
    def __init__(self, folder):
        self.root = Path(folder)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'core.hooksPath', str(self.root / 'no-hooks'))
        self.git('config', 'core.autocrlf', 'false')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL).decode().strip()

    def commit(self, files=(), delete=()):
        for path, text in dict(files).items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding='utf-8')
        for path in delete:
            (self.root / path).unlink()
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', 'fixture')
        return self.git('rev-parse', 'HEAD')


class DocDriftTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Repo(tmp.name)
        self.base = self.repo.commit({
            'src/frontend/src/Panel.jsx': 'export function renderPanel() { return null }\n',
            'src/backend/app/sync.py': 'def upload_with_cas():\n    pass\n',
            '.gitignore': 'qa/\n',
            '.claude/knowledge/area.md': '# Area\nEntry: `src/frontend/src/Panel.jsx`\n',
        })

    def branch_errors(self, head):
        return '\n'.join(drift.branch_check(self.repo.root, self.base, head))

    def test_new_reference_to_missing_file_fails_and_existing_passes(self):
        head = self.repo.commit({'.claude/knowledge/area.md': '# Area\n`src/frontend/src/Gone.jsx` and `src/backend/app/sync.py`\n'})
        errors = self.branch_errors(head)
        self.assertIn('src/frontend/src/Gone.jsx', errors)
        self.assertNotIn('sync.py', errors)

    def test_code_change_deleting_referenced_file_fails_naming_the_doc(self):
        head = self.repo.commit(delete=['src/frontend/src/Panel.jsx'])
        errors = self.branch_errors(head)
        self.assertIn('.claude/knowledge/area.md', errors)
        self.assertIn('Panel.jsx', errors)

    def test_preexisting_dead_reference_is_not_blamed_on_the_branch(self):
        self.base = self.repo.commit({'CLAUDE.md': 'See `scripts/long_gone.py`.\n'})
        head = self.repo.commit({'src/backend/app/sync.py': 'def upload_with_cas():\n    return 1\n'})
        self.assertEqual(self.branch_errors(head), '')

    def test_basename_and_suffix_references_resolve(self):
        head = self.repo.commit({'CLAUDE.md': '`Panel.jsx`, `src/Panel.jsx`, `./src/backend/app/sync.py:2`\n'})
        self.assertEqual(self.branch_errors(head), '')

    def test_fences_placeholders_history_and_ignored_paths_are_skipped(self):
        head = self.repo.commit({'CLAUDE.md': (
            '```\n`src/missing/in_fence.py`\n```\n'
            '`docs/plans/tasks/T{id}-x.md` `/workspace/.notes.md` `T5642-...qa.spec.js`\n'
            'The old `src/frontend/src/OldPanel.jsx` was removed in T1.\n'
            'Evidence lives in `qa/proof.json`.\n')})
        self.assertEqual(self.branch_errors(head), '')

    def test_task_files_are_history_and_never_checked(self):
        head = self.repo.commit({'docs/plans/tasks/T1-x.md': '`src/frontend/src/Gone.jsx`\n'})
        self.assertEqual(self.branch_errors(head), '')

    def test_added_symbol_must_exist_in_code(self):
        head = self.repo.commit({'.claude/knowledge/area.md': (
            '# Area\nEntry: `src/frontend/src/Panel.jsx`\n'
            'Calls `renderPanel()` then `upload_with_cas`, never `uploadWithoutCas`.\n')})
        errors = self.branch_errors(head)
        self.assertIn('uploadWithoutCas', errors)
        self.assertNotIn('renderPanel', errors)
        self.assertNotIn('upload_with_cas', errors)

    def test_symbol_removed_from_code_under_unchanged_doc_line_does_not_block(self):
        self.base = self.repo.commit({'.claude/knowledge/area.md': '# Area\n`src/frontend/src/Panel.jsx` exports `renderPanel`\n'})
        head = self.repo.commit({'src/frontend/src/Panel.jsx': 'export function drawPanel() { return null }\n'})
        self.assertEqual(self.branch_errors(head), '')

    def test_total_mode_is_a_ratchet(self):
        self.repo.commit({'CLAUDE.md': '`a/gone_one.py` `a/gone_two.py`\n'})
        self.assertEqual(drift.total_check(self.repo.root, 'HEAD', baseline=2), [])
        self.assertIn('2 dead path references', '\n'.join(drift.total_check(self.repo.root, 'HEAD', baseline=1)))

    def test_plan_added_broken_link_fails_and_preexisting_is_tolerated(self):
        self.base = self.repo.commit({
            'docs/plans/tasks/T1-a.md': '# T1\n',
            'docs/plans/PLAN.md': '| ID | Task | I | C | P | Status |\n|---|---|---|---|---|---|\n'
                                  '| T1 | [A](tasks/T1-a.md) | 1 | 1 | 1 | TODO |\n[old](tasks/gone.md)\n'})
        head = self.repo.commit({'docs/plans/PLAN.md': (
            '| ID | Task | I | C | P | Status |\n|---|---|---|---|---|---|\n'
            '| T1 | [A](tasks/T1-a.md) | 1 | 1 | 1 | TODO |\n[old](tasks/gone.md)\n'
            '| T2 | [B](tasks/T2-missing.md) | 1 | 1 | 1 | TODO |\n')})
        errors = self.branch_errors(head)
        self.assertIn('tasks/T2-missing.md', errors)
        self.assertNotIn('tasks/gone.md', errors)

    def test_plan_duplicate_task_row_fails(self):
        row = '| T1 | [A](tasks/T1-a.md) | 1 | 1 | 1 | TODO |\n'
        self.base = self.repo.commit({'docs/plans/tasks/T1-a.md': '# T1\n', 'docs/plans/PLAN.md': row})
        head = self.repo.commit({'docs/plans/PLAN.md': row + row.replace('TODO', 'WIP')})
        self.assertIn('T1', self.branch_errors(head))


if __name__ == '__main__':
    unittest.main()
