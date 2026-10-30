"""Tests for the Master CI testmon baseline helpers (plugin + import-time line recorder)."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest

import testmon_baseline_plugin as plugin


class BatchSizeTests(unittest.TestCase):
    def test_batch_size_is_raised_so_coverage_never_restarts(self):
        core = types.SimpleNamespace(TEST_BATCH_SIZE=250)
        plugin.raise_batch_size(core)
        self.assertGreaterEqual(core.TEST_BATCH_SIZE, 10 ** 9)

    def test_missing_attribute_fails_loudly(self):
        # A testmon upgrade that renames the knob must break the baseline run, not silently restart coverage.
        with self.assertRaises(RuntimeError) as ctx:
            plugin.raise_batch_size(types.SimpleNamespace())
        self.assertIn('TEST_BATCH_SIZE', str(ctx.exception))


class SpawnRecorderTests(unittest.TestCase):
    def setUp(self):
        self.recorder = plugin.SpawnRecorder()
        self.recorder.install()
        self.addCleanup(self.recorder.uninstall)

    def test_subprocess_is_credited_to_the_running_test_file(self):
        self.recorder.set_current('tests/test_a.py::test_x')
        subprocess.run([sys.executable, '-c', 'pass'], check=True)
        self.recorder.set_current('tests/test_b.py::test_y')
        self.recorder.uninstall()
        self.assertEqual(sorted(self.recorder.files), ['tests/test_a.py'])
        self.assertIn('subprocess.Popen', self.recorder.files['tests/test_a.py'])

    def test_process_pool_submit_is_recorded(self):
        from concurrent.futures import ProcessPoolExecutor
        self.recorder.set_current('tests/test_pool.py::test_z')
        with ProcessPoolExecutor(max_workers=1) as pool:
            pool.submit(int, '1').result()
        self.recorder.uninstall()
        self.assertIn('ProcessPoolExecutor.submit', self.recorder.files['tests/test_pool.py'])

    def test_nothing_recorded_outside_a_test(self):
        self.recorder.set_current(None)
        subprocess.run([sys.executable, '-c', 'pass'], check=True)
        self.recorder.uninstall()
        self.assertEqual(self.recorder.files, {})

    def test_write_saves_sorted_file_list(self):
        self.recorder.set_current('tests/test_b.py::t')
        subprocess.run([sys.executable, '-c', 'pass'], check=True)
        self.recorder.set_current('tests/test_a.py::t')
        subprocess.run([sys.executable, '-c', 'pass'], check=True)
        self.recorder.uninstall()
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'always_run.json'
            self.recorder.write(out)
            self.assertEqual(json.loads(out.read_text()), ['tests/test_a.py', 'tests/test_b.py'])

    def test_uninstall_restores_originals(self):
        self.recorder.uninstall()
        fresh = plugin.SpawnRecorder()
        original = subprocess.Popen.__init__
        fresh.install()
        self.assertIsNot(subprocess.Popen.__init__, original)
        fresh.uninstall()
        self.assertIs(subprocess.Popen.__init__, original)


class ImportLinesTests(unittest.TestCase):
    def make_project(self, folder, module_body='X = 1\n\ndef f():\n    return 2\n', test_body='def test_a():\n    pass\n'):
        root = Path(folder)
        (root / 'app').mkdir()
        (root / 'app' / '__init__.py').write_text('')
        (root / 'app' / 'mod.py').write_text(module_body)
        (root / 'tests').mkdir()
        (root / 'tests' / 'test_a.py').write_text(test_body)
        return root

    def run_record(self, root, out):
        # Fresh interpreter: the recorder imports app/ and must not see this process's modules.
        code = ('import sys; sys.path.insert(0, %r); import testmon_import_lines as m; '
                'sys.exit(m.record(%r, ["tests/test_a.py"], %r))') % (str(Path(__file__).parent), str(root), str(out))
        return subprocess.run([sys.executable, '-c', code], cwd=root, capture_output=True, text=True)

    def test_records_import_time_lines_but_not_function_bodies(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder)
            out = root / 'import_lines.json'
            result = self.run_record(root, out)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            data = json.loads(out.read_text())
            self.assertEqual(data['unimportable'], {})
            lines = data['lines']
            self.assertIn('app/mod.py', lines)
            self.assertIn(1, lines['app/mod.py'])       # X = 1 ran at import
            self.assertIn(3, lines['app/mod.py'])       # def f ran at import
            self.assertNotIn(4, lines['app/mod.py'])    # f's body did not

    def test_import_error_in_app_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder, module_body='from app import nonexistent_name\n')
            result = self.run_record(root, root / 'import_lines.json')
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / 'import_lines.json').exists())

    def test_third_party_module_not_found_is_recorded_not_fatal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder, module_body='import nonexistent_dep_xyz\n')
            out = root / 'import_lines.json'
            result = self.run_record(root, out)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('app/mod.py', result.stdout)
            data = json.loads(out.read_text())
            self.assertEqual(data['unimportable'], {'app/mod.py': 'nonexistent_dep_xyz'})

    def test_third_party_submodule_import_records_top_level_package(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder, module_body='from nonexistent_dep_xyz.sub import thing\n')
            out = root / 'import_lines.json'
            result = self.run_record(root, out)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(out.read_text())['unimportable'], {'app/mod.py': 'nonexistent_dep_xyz'})

    def test_missing_app_module_is_still_fatal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder, module_body='import app.nonexistent_local\n')
            result = self.run_record(root, root / 'import_lines.json')
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / 'import_lines.json').exists())

    def test_other_import_errors_are_still_fatal(self):
        for body in ['undefined_name\n', 'def (:\n', 'raise SystemExit(3)\n']:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as folder:
                root = self.make_project(folder, module_body=body)
                result = self.run_record(root, root / 'import_lines.json')
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / 'import_lines.json').exists())

    def test_collection_error_in_tests_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.make_project(folder, test_body='import nonexistent_dep_xyz\n')
            result = self.run_record(root, root / 'import_lines.json')
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / 'import_lines.json').exists())


if __name__ == '__main__':
    unittest.main()
