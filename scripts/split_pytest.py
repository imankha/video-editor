"""Split backend pytest across CI shards by recorded per-file duration (T13964). Standard library only.

Whole test FILES only, so module-scoped fixtures and per-module caches behave as in one run.
Greedy longest-first bin packing over src/backend/tests/.test_durations.json (seconds per file,
paths relative to src/backend); a file the duration file lacks counts as its median.

  shard     print shard I of N (1-based) of the given files and write its report
  verify    the shard reports cover the input exactly once (and every test file in full mode)
  durations per-file seconds from pytest --junitxml reports (Master CI refreshes the file with it)
"""
import argparse
import json
from pathlib import Path
import statistics
import sys
import xml.etree.ElementTree as ET


def split(files, durations, shards):
    """[[files of shard 1], ..., [files of shard N]], each sorted; deterministic for the same input."""
    if shards < 1:
        raise ValueError(f'shards must be >= 1, got {shards}')
    if len(set(files)) != len(files):
        raise ValueError('duplicate test files: ' + ', '.join(sorted({f for f in files if files.count(f) > 1})))
    if not durations:
        raise ValueError('the duration file is empty')
    median = statistics.median(durations.values())
    loads, bins = [0.0] * shards, [[] for _ in range(shards)]
    for path in sorted(files, key=lambda f: (-durations.get(f, median), f)):
        target = min(range(shards), key=lambda i: (loads[i], i))
        loads[target] += durations.get(path, median)
        bins[target].append(path)
    return [sorted(b) for b in bins]


def verify(reports, shards, full_files):
    """Errors in a set of shard reports; [] when every shard reported and the files add up."""
    errors = []
    by_index = {}
    for report in reports:
        if report.get('shards') != shards:
            errors.append(f'report for shard {report.get("shard")} was split {report.get("shards")} ways, expected {shards}')
        if report.get('shard') in by_index:
            errors.append(f'shard {report.get("shard")} reported twice')
        by_index[report.get('shard')] = report
    missing = sorted(set(range(1, shards + 1)) - set(by_index))
    if missing:
        errors.append('missing shard report(s): ' + ', '.join(map(str, missing)))
    if errors or not reports:
        return errors or ['no shard reports']
    inputs = {json.dumps([r['mode'], r['all_files']]) for r in reports}
    if len(inputs) != 1:
        return ['shards split different inputs (mode or file list differs)']
    mode, all_files = reports[0]['mode'], reports[0]['all_files']
    ran = [f for r in reports for f in r['files']]
    duplicated = sorted({f for f in ran if ran.count(f) > 1})
    if duplicated:
        errors.append('test files run by more than one shard: ' + ', '.join(duplicated))
    if sorted(set(ran)) != sorted(all_files):
        errors.append('shards do not cover their input: ' + ', '.join(sorted(set(all_files) ^ set(ran))))
    if mode == 'full' and sorted(all_files) != sorted(full_files):
        errors.append('full mode did not split every test file: ' + ', '.join(sorted(set(all_files) ^ set(full_files))))
    return errors


def junit_durations(paths):
    """{tests/test_x.py: seconds} summed over every testcase (setup + call + teardown)."""
    totals = {}
    for path in paths:
        for case in ET.parse(path).iter('testcase'):
            # a module skipped at collection is one testcase with an empty classname and the module as its name
            module = (case.get('classname') or case.get('name', '')).split('.')
            if len(module) < 2 or module[0] != 'tests':
                raise ValueError(f'{path}: testcase {case.get("name")!r} has classname {case.get("classname")!r}, '
                                 'expected tests.<module>[.<Class>]')
            key = f'tests/{module[1]}.py'
            totals[key] = totals.get(key, 0.0) + float(case.get('time', 0))
    return {k: round(v, 2) for k, v in sorted(totals.items())}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    shard = sub.add_parser('shard')
    shard.add_argument('--index', type=int, required=True, help='1-based shard number')
    shard.add_argument('--shards', type=int, required=True)
    shard.add_argument('--durations', type=Path, required=True)
    shard.add_argument('--mode', required=True, help='the pytest plan mode the input came from (full|testmon)')
    shard.add_argument('--report', type=Path, required=True)
    shard.add_argument('files', nargs='*')
    check = sub.add_parser('verify')
    check.add_argument('--shards', type=int, required=True)
    check.add_argument('--reports-dir', type=Path, required=True)
    check.add_argument('full_files', nargs='+', help='every test file (tests/test_*.py), for full mode')
    merge = sub.add_parser('durations')
    merge.add_argument('--output', type=Path, required=True)
    merge.add_argument('junit', nargs='+', type=Path)
    args = parser.parse_args()
    if args.command == 'shard':
        if not 1 <= args.index <= args.shards:
            raise ValueError(f'--index {args.index} is outside 1..{args.shards}')
        durations = json.loads(args.durations.read_text(encoding='utf-8'))
        mine = split(args.files, durations, args.shards)[args.index - 1]
        args.report.write_text(json.dumps({'shard': args.index, 'shards': args.shards, 'mode': args.mode,
                                           'all_files': sorted(args.files), 'files': mine}, indent=2) + '\n',
                               encoding='utf-8')
        print('\n'.join(mine))
        return 0
    if args.command == 'verify':
        reports = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(args.reports_dir.rglob('*.json'))]
        errors = verify(reports, args.shards, args.full_files)
        print('\n'.join(errors) if errors else f'All {args.shards} shards reported; every input file ran exactly once')
        return bool(errors)
    durations = junit_durations(args.junit)
    args.output.write_text(json.dumps(durations, indent=2) + '\n', encoding='utf-8')
    print(f'{len(durations)} test files, {sum(durations.values()):.0f} s total -> {args.output}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, ET.ParseError) as exc:
        sys.exit(f'split_pytest failed: {exc}')
