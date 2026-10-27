"""Fixture tests for the PostToolUse lint hook (.claude/hooks/lint-changed.cjs).

The hook exits 0 on any internal problem by design, so a broken hook means files silently
stop being linted. These tests run it against a throwaway copy of the repo layout (the hook
and its gate scripts resolve the repo root from their own location) and need only `node`.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
COPIED = ['.claude/hooks/lint-changed.cjs', 'scripts/check-viewport-units.mjs', 'scripts/check-media-api-base.mjs']


class LintHookTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for rel in COPIED:
            (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / rel, self.root / rel)

    def run_hook(self, stdin):
        return subprocess.run(['node', str(self.root / COPIED[0])], input=stdin,
                              capture_output=True, text=True, timeout=60)

    def edit(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return self.run_hook(json.dumps({'tool_input': {'file_path': str(path)}}))

    def test_malformed_input_and_missing_file_stay_silent(self):
        self.assertEqual(self.run_hook('not json').returncode, 0)
        missing = json.dumps({'tool_input': {'file_path': str(self.root / 'src/frontend/src/Gone.jsx')}})
        self.assertEqual(self.run_hook(missing).returncode, 0)

    def test_viewport_unit_gate_blocks_h_screen(self):
        result = self.edit('src/frontend/src/Bad.jsx', 'export const A = () => <div className="h-screen" />;\n')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('[hook:viewport-units]', result.stderr)

    def test_media_api_base_gate_blocks_bare_api_media_url(self):
        result = self.edit('src/frontend/src/Poster.jsx', 'export const P = () => <img src="/api/clips/1/poster" />;\n')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('[hook:media-api-base]', result.stderr)

    def test_clean_frontend_file_and_non_lintable_file_pass(self):
        # No src/frontend/node_modules in the fixture, so eslint is skipped after the gates pass.
        self.assertEqual(self.edit('src/frontend/src/Good.jsx', 'export const G = () => <div className="h-dvh" />;\n').returncode, 0)
        self.assertEqual(self.edit('docs/notes.md', '# h-screen is fine in docs\n').returncode, 0)


if __name__ == '__main__':
    unittest.main()
