"""Shared Branch CI applicability and aggregate checks. Standard library only."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

JOBS = {'instructions', 'tooling', 'frontend', 'backend', 'shrink'}
INSTRUCTION_TOOLS = {
    'scripts/audit-agent-instructions.py', 'scripts/test_audit_agent_instructions.py',
    'scripts/validate_agent_instructions.py', 'scripts/test_validate_agent_instructions.py',
}
HARNESS = {'scripts/task.sh', 'scripts/task.bat', 'scripts/task-manager.py',
           'scripts/landing_gate.py', 'scripts/test_landing_gate.py'}
FRONTEND_TOOLS = {'scripts/check-viewport-units.mjs', 'scripts/check-media-api-base.mjs'}


def required_jobs(paths):
    jobs = {'tooling'}
    for path in paths:
        parts = PurePosixPath(path).parts
        if not path or path.startswith('/') or '\\' in path or '..' in parts:
            raise ValueError(f'Invalid repository path: {path!r}')
        if path.startswith('.github/workflows/') or path in {'scripts/ci_policy.py', 'scripts/test_ci_policy.py'}:
            jobs.update(JOBS)
        elif '.claude' in parts or PurePosixPath(path).name in {'CLAUDE.md', 'AGENTS.md'} or path in INSTRUCTION_TOOLS:
            jobs.add('instructions')
        elif path in HARNESS:
            jobs.add('instructions')
        elif path in FRONTEND_TOOLS or path.startswith('src/frontend/'):
            jobs.add('frontend')
        elif path.startswith('src/backend/'):
            jobs.add('backend')
        elif path.startswith('scripts/shrink-tool/'):
            jobs.add('shrink')
        elif (path.startswith('docs/') and path.endswith('.md')) or path in {'README.md', 'LICENSE'}:
            pass
        else:
            jobs.update({'frontend', 'backend', 'shrink'})
    return jobs


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def resolve(root, revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Use a full lowercase commit SHA')
    value = git(root, 'rev-parse', '--verify', revision + '^{commit}').decode().strip()
    if value != revision:
        raise ValueError('Revision did not resolve exactly')
    return value


def git_paths(root, base, head):
    resolve(root, base)
    resolve(root, head)
    # No rename folding: both deleted source and added destination are selected.
    raw = git(root, 'diff', '--no-renames', '--name-only', '-z', base + '...' + head)
    return sorted(set(p.decode('utf-8', 'strict') for p in raw.split(b'\0') if p))


def manifest(root, base, head):
    paths = git_paths(root, base, head)
    return {'schema_version': 1, 'base': base, 'head': head, 'paths': paths,
            'required_jobs': sorted(required_jobs(paths)),
            'policy_hash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'reasons': {p: sorted(required_jobs([p])) for p in paths}}


def aggregate(required, outcomes):
    if not set(required) <= JOBS:
        raise ValueError('Unknown required job')
    errors = []
    for job in sorted(set(required) | {'changes'}):
        if outcomes.get(job, {}).get('result') != 'success':
            errors.append(f'{job}: expected success, got {outcomes.get(job, {}).get("result", "missing")}')
    for job, state in outcomes.items():
        if job not in set(required) | {'changes'} and state.get('result') not in {'success', 'skipped'}:
            errors.append(f'{job}: unexpected outcome {state.get("result")}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    route = sub.add_parser('route')
    route.add_argument('--base', required=True)
    route.add_argument('--head', required=True)
    route.add_argument('--root', type=Path, default=Path.cwd())
    route.add_argument('--output', type=Path, required=True)
    check = sub.add_parser('aggregate')
    check.add_argument('--required', required=True)
    check.add_argument('--outcomes', required=True)
    args = parser.parse_args()
    if args.command == 'aggregate':
        errors = aggregate(json.loads(args.required), json.loads(args.outcomes))
        print('\n'.join(errors) if errors else 'All applicable checks passed')
        return bool(errors)
    result = manifest(args.root, args.base, args.head)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
            for job in sorted(JOBS):
                stream.write(f'{job}={str(job in result["required_jobs"]).lower()}\n')
            stream.write('required=' + json.dumps(result['required_jobs']) + '\n')
            stream.write(f'base={result["base"]}\nhead={result["head"]}\n')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, subprocess.CalledProcessError, OSError) as exc:
        raise SystemExit(f'CI policy failed: {exc}')
