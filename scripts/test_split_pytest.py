"""Acceptance tests for the backend pytest shards (T13964): the splitter and its workflow wiring."""
import json
from pathlib import Path
import random
import re
import subprocess
import sys
import tempfile
import unittest

import split_pytest
from test_ci_policy import jobs_block


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT/'src/backend'
SHARDS = 4
DURATIONS = BACKEND/'tests/.test_durations.json'
TEST_FILES = sorted(p.relative_to(BACKEND).as_posix() for p in (BACKEND/'tests').glob('test_*.py'))


def committed_durations():
    assert DURATIONS.exists(), f'{DURATIONS.relative_to(ROOT)} is not committed'
    return json.loads(DURATIONS.read_text(encoding='utf-8'))


class SplitTests(unittest.TestCase):
    def test_every_test_file_runs_in_exactly_one_shard(self):
        shards = split_pytest.split(TEST_FILES, committed_durations(), SHARDS)
        ran = [f for shard in shards for f in shard]
        self.assertEqual(len(shards), SHARDS)
        self.assertEqual(len(ran), len(set(ran)), 'a test file is in two shards')
        self.assertEqual(sorted(ran), TEST_FILES)

    def test_split_is_deterministic_whatever_the_input_order(self):
        durations = committed_durations()
        expected = split_pytest.split(TEST_FILES, durations, SHARDS)
        shuffled = list(TEST_FILES)
        random.Random(13964).shuffle(shuffled)
        self.assertEqual(split_pytest.split(shuffled, durations, SHARDS), expected)
        self.assertEqual(split_pytest.split(list(reversed(TEST_FILES)), durations, SHARDS), expected)

    def test_committed_durations_balance_the_shards_within_20_percent(self):
        durations = committed_durations()
        median = sorted(durations.values())[len(durations) // 2]
        loads = [sum(durations.get(f, median) for f in shard)
                 for shard in split_pytest.split(TEST_FILES, durations, SHARDS)]
        mean = sum(loads) / SHARDS
        self.assertLessEqual(max(loads), 1.2 * mean, loads)
        self.assertGreaterEqual(min(loads), 0.8 * mean, loads)

    def test_committed_durations_name_real_test_files(self):
        durations = committed_durations()
        self.assertTrue(all(re.fullmatch(r'tests/test_\w+\.py', k) for k in durations), 'keys are tests/test_x.py')
        self.assertTrue(all(isinstance(v, (int, float)) and v >= 0 for v in durations.values()))
        # Files added since the last refresh count as the median; a stale file is fine, a mostly stale one is not.
        self.assertGreaterEqual(len(set(durations) & set(TEST_FILES)), 0.9 * len(TEST_FILES))

    def test_files_without_a_duration_count_as_the_median(self):
        durations = {'tests/test_a.py': 10, 'tests/test_b.py': 2, 'tests/test_c.py': 1}
        # test_new counts as 2 (the median): 10 | 2+2+1 is the only longest-first packing.
        self.assertEqual(split_pytest.split(['tests/test_new.py', *durations], durations, 2),
                         [['tests/test_a.py'], ['tests/test_b.py', 'tests/test_c.py', 'tests/test_new.py']])

    def test_more_shards_than_files_leaves_shards_empty_not_missing(self):
        self.assertEqual(split_pytest.split(['tests/test_a.py'], {'tests/test_a.py': 1}, 3),
                         [['tests/test_a.py'], [], []])
        self.assertEqual(split_pytest.split([], {'tests/test_a.py': 1}, 2), [[], []])

    def test_bad_input_fails_loudly(self):
        for files, durations, shards in [(['tests/test_a.py'] * 2, {'tests/test_a.py': 1}, 2),
                                         (['tests/test_a.py'], {}, 2),
                                         (['tests/test_a.py'], {'tests/test_a.py': 1}, 0)]:
            with self.subTest(files=files, durations=durations, shards=shards):
                with self.assertRaises(ValueError):
                    split_pytest.split(files, durations, shards)


def reports(all_files, shards=SHARDS, mode='full', durations=None):
    split = split_pytest.split(all_files, durations or {f: 1 for f in all_files}, shards)
    return [{'shard': i + 1, 'shards': shards, 'mode': mode, 'all_files': sorted(all_files), 'files': files}
            for i, files in enumerate(split)]


class VerifyTests(unittest.TestCase):
    FILES = [f'tests/test_{n}.py' for n in 'abcdefg']

    def test_complete_reports_pass(self):
        self.assertEqual(split_pytest.verify(reports(self.FILES), SHARDS, self.FILES), [])
        selected = self.FILES[:2]  # testmon mode: the input is the selection, not every file
        self.assertEqual(split_pytest.verify(reports(selected, mode='testmon'), SHARDS, self.FILES), [])

    def test_a_missing_shard_fails(self):
        errors = split_pytest.verify(reports(self.FILES)[1:], SHARDS, self.FILES)
        self.assertIn('missing shard report(s): 1', errors)
        self.assertEqual(split_pytest.verify([], SHARDS, self.FILES), ['missing shard report(s): 1, 2, 3, 4'])

    def test_a_shard_reported_twice_or_split_another_way_fails(self):
        complete = reports(self.FILES)
        self.assertIn('shard 2 reported twice', split_pytest.verify(complete + [complete[1]], SHARDS, self.FILES))
        self.assertTrue(split_pytest.verify(reports(self.FILES, shards=3), SHARDS, self.FILES))

    def test_a_file_run_twice_or_never_fails(self):
        twice = reports(self.FILES)
        twice[0]['files'] = twice[0]['files'] + twice[1]['files'][:1]
        self.assertTrue(any('more than one shard' in e for e in split_pytest.verify(twice, SHARDS, self.FILES)))
        never = reports(self.FILES)
        dropped = never[0]['files'].pop()
        self.assertEqual(split_pytest.verify(never, SHARDS, self.FILES), ['shards do not cover their input: ' + dropped])

    def test_full_mode_must_split_every_test_file(self):
        errors = split_pytest.verify(reports(self.FILES[:-1]), SHARDS, self.FILES)
        self.assertEqual(errors, ['full mode did not split every test file: ' + self.FILES[-1]])

    def test_shards_that_disagree_on_the_input_fail(self):
        mixed = reports(self.FILES)
        mixed[3]['all_files'] = self.FILES[:-1]
        self.assertEqual(split_pytest.verify(mixed, SHARDS, self.FILES),
                         ['shards split different inputs (mode or file list differs)'])


class CommandLineTests(unittest.TestCase):
    def run_cli(self, *args, cwd):
        return subprocess.run([sys.executable, str(ROOT/'scripts/split_pytest.py'), *args], cwd=cwd,
                              capture_output=True, text=True)

    def test_shard_reports_then_verify_round_trip(self):
        files = [f'tests/test_{n}.py' for n in 'abcde']
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'durations.json').write_text(json.dumps({f: i + 1 for i, f in enumerate(files)}))
            Path(tmp, 'reports').mkdir()
            printed = []
            for index in range(1, 3):
                result = self.run_cli('shard', '--index', str(index), '--shards', '2', '--durations', 'durations.json',
                                      '--mode', 'full', '--report', f'reports/{index}.json', *files, cwd=tmp)
                self.assertEqual(result.returncode, 0, result.stderr)
                printed += result.stdout.split()
            self.assertEqual(sorted(printed), files)
            ok = self.run_cli('verify', '--shards', '2', '--reports-dir', 'reports', *files, cwd=tmp)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            Path(tmp, 'reports/2.json').unlink()
            missing = self.run_cli('verify', '--shards', '2', '--reports-dir', 'reports', *files, cwd=tmp)
            self.assertEqual(missing.returncode, 1)
            self.assertIn('missing shard report(s): 2', missing.stdout)

    def test_out_of_range_index_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'd.json').write_text('{"tests/test_a.py": 1}')
            result = self.run_cli('shard', '--index', '5', '--shards', '4', '--durations', 'd.json', '--mode', 'full',
                                  '--report', 'r.json', 'tests/test_a.py', cwd=tmp)
            self.assertNotEqual(result.returncode, 0)

    def test_durations_from_junit_sum_per_file(self):
        xml = ('<testsuites><testsuite>'
               '<testcase classname="tests.test_a" name="t1" time="1.5"/>'
               '<testcase classname="tests.test_a.TestX" name="t2" time="0.25"/>'
               '<testcase classname="tests.test_b" name="t3" time="2"/>'
               '<testcase classname="" name="tests.test_skipped" time="0.000"><skipped message="collection skipped"/></testcase>'
               '</testsuite></testsuites>')
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'j1.xml').write_text(xml)
            result = self.run_cli('durations', '--output', 'out.json', 'j1.xml', cwd=tmp)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(Path(tmp, 'out.json').read_text()),
                             {'tests/test_a.py': 1.75, 'tests/test_b.py': 2.0, 'tests/test_skipped.py': 0.0})


class WorkflowWiringTests(unittest.TestCase):
    def assert_shards(self, workflow):
        lines = (ROOT/'.github/workflows'/workflow).read_text(encoding='utf-8').splitlines()
        for job in ('backend-shard', 'backend-lint', 'backend'):
            self.assertTrue(f'  {job}:' in lines, f'{workflow} has no {job} job')
        shard = jobs_block(workflow, 'backend-shard')
        self.assertIn('fail-fast: false', shard, 'one red shard must not cancel the others')
        self.assertRegex(shard, r'shard: \[1, 2, 3, 4\]')
        self.assertIn(f"SHARDS: {SHARDS}", shard)
        self.assertIn('split_pytest.py shard --index "$SHARD" --shards "$SHARDS" --durations tests/.test_durations.json', shard)
        self.assertIn('name: backend-shard-report-${{ matrix.shard }}', shard)
        self.assertNotIn('ruff', shard, 'ruff and the import check run once, in backend-lint')
        lint = jobs_block(workflow, 'backend-lint')
        self.assertIn('Ruff regression gate', lint)
        self.assertIn('python -c "from app.main import app"', lint)
        backend = jobs_block(workflow, 'backend')
        self.assertRegex(backend, r'needs: \[[^\]]*\bbackend-lint\b[^\]]*\bbackend-shard\b')
        self.assertIn('pattern: backend-shard-report-*', backend)
        self.assertIn('split_pytest.py verify --shards "$SHARDS"', backend)
        self.assertIn(f"SHARDS: {SHARDS}", backend)
        self.assertIn("SHARD_RESULT: ${{ needs.backend-shard.result }}", backend)
        self.assertIn("LINT_RESULT: ${{ needs.backend-lint.result }}", backend)
        return shard, backend

    def test_branch_ci_shards_backend_and_ci_ready_waits_on_the_verified_aggregate(self):
        shard, backend = self.assert_shards('branch-ci.yml')
        self.assertIn("if: needs.changes.outputs.backend == 'true'", shard)
        self.assertIn("if: always() && needs.changes.outputs.backend == 'true'", backend,
                      'a failed or cancelled shard must fail backend, not skip it')
        self.assertIn('--testmon --testmon-nocollect --collect-only', shard, 'testmon selection still runs per shard')
        self.assertRegex(jobs_block('branch-ci.yml', 'ci-ready'), r'needs: \[[^\]]*\bbackend\b')

    def test_master_ci_shards_backend_and_publishes_fresh_durations(self):
        _, backend = self.assert_shards('master-ci.yml')
        self.assertIn('split_pytest.py durations', backend)
        self.assertIn('name: test-durations', backend)


if __name__ == '__main__':
    unittest.main()
