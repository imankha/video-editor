"""Shared Branch CI applicability and aggregate checks. Standard library only."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

JOBS = {'instructions', 'tooling', 'frontend', 'backend', 'shrink', 'landing', 'harness'}
# Every rule below names the job that executes, imports or parses the path. A path no rule
# claims fails loudly (UnclassifiedPath) instead of fanning out to suites that never load it.
EVERYTHING = {'scripts/ci_policy.py', 'scripts/test_ci_policy.py',
              '.gitattributes'}  # .gitattributes rewrites line endings of every checked-out file
INSTRUCTION_TOOLS = {
    'scripts/audit-agent-instructions.py', 'scripts/test_audit_agent_instructions.py',
    'scripts/validate_agent_instructions.py', 'scripts/test_validate_agent_instructions.py',
}
TOOLING_TOOLS = {'scripts/check_doc_drift.py', 'scripts/test_check_doc_drift.py'}
# The /dotask + landing harness: referenced by instructions and run by the harness job's tests.
HARNESS = {'scripts/task.sh', 'scripts/task.bat', 'scripts/task-manager.py',
           'scripts/landing_gate.py', 'scripts/test_landing_gate.py',
           'scripts/dotask.sh', 'scripts/dotask_cli.py', 'scripts/dotask_evidence.py',
           'scripts/wave_profile.py', 'scripts/ensure_sonnet_default.py',
           'scripts/test_dotask_cli.py', 'scripts/test_dotask_evidence.py',
           'scripts/test_dotask_expert_matrix.py', 'scripts/test_wave_profile.py',
           'scripts/test_task_run.sh'}
# Instruction text that harness tests read verbatim.
HARNESS_TEXT = {'.claude/ORCHESTRATION.md', 'scripts/dotask_kickoff_template.md'}
FRONTEND_TOOLS = {'scripts/check-viewport-units.mjs', 'scripts/check-media-api-base.mjs'}
# The landing build bakes these in (see deploy-landing.yml's trigger paths).
LANDING_INPUTS = {'src/backend/app/pricing.json'}
# Local-dev files and docs: no CI job reads them; tooling still checks patch whitespace.
LOCAL_ONLY = {'README.md', 'LICENSE', '.gitignore', 'docker-compose.yml', '.env.example', 'start-dev.bat'}
# Each test is listed with the job that runs it; test_ci_policy pins both workflows to this map.
SCRIPT_TESTS = {
    'scripts/test_ci_policy.py': 'tooling',
    'scripts/test_landing_gate.py': 'tooling',
    'scripts/test_check_doc_drift.py': 'tooling',
    'scripts/test_audit_agent_instructions.py': 'instructions',
    'scripts/test_validate_agent_instructions.py': 'instructions',
    'scripts/test_dotask_cli.py': 'harness',
    'scripts/test_dotask_evidence.py': 'harness',
    'scripts/test_dotask_expert_matrix.py': 'harness',
    'scripts/test_wave_profile.py': 'harness',
    'scripts/test_task_run.sh': 'harness',
    'scripts/test_reset_all_accounts.py': 'harness',
    'scripts/test_lint_hook.py': 'harness',
}
# Committed by accident; deliberately unrouted so that editing one fails loudly.
KNOWN_STRAYS = {
    'formal annotations.lnk', 'install-panel.png', 'nuf-reset-emails.txt',
    'qa/FunnelChart.test.jsx', 'qa/paywallBeacons.test.jsx', 'qa/storageCost.test.js',
    'qa/test_T13340_logo_lockup.mjs', 'qa/test_T13350_hero_spotlight.mjs',
    'qa/test_t13310_storage_per_gb.py', 'qa/test_t13330_paywall_funnel.py',
}


class UnclassifiedPath(ValueError):
    pass


def jobs_for(path):
    """Jobs one valid path needs, or None when no rule claims it."""
    parts = PurePosixPath(path).parts
    name = parts[-1]
    if path.startswith('.github/workflows/') or path in EVERYTHING:
        return set(JOBS)
    if path in HARNESS_TEXT or path in HARNESS or path.startswith('.devcontainer/'):
        return {'instructions', 'harness'}
    if '.claude' in parts:
        if path.endswith('.md'):
            return {'instructions'}
        if '/hooks/' in path or '/skills/' in path:
            return {'harness'}  # executables: syntax check + the hook's fixture test
        return None  # e.g. settings.json: CI has no consumer for it
    if name in {'CLAUDE.md', 'AGENTS.md'} or path in INSTRUCTION_TOOLS:
        return {'instructions'}
    if path in TOOLING_TOOLS:
        return set()
    if path in SCRIPT_TESTS:
        return {SCRIPT_TESTS[path]}
    if path in FRONTEND_TOOLS:
        return {'frontend'}
    if path.startswith('src/frontend/'):
        return {'frontend', 'landing'}  # the landing site imports @editor modules from src/frontend
    if path in LANDING_INPUTS:
        return {'backend', 'landing'}
    if path.startswith('src/backend/') or path.startswith('formal annotations/test.short/'):
        return {'backend'}  # backend tests read the formal annotations fixture
    if path.startswith('src/landing/'):
        return {'landing'}
    if path.startswith('scripts/shrink-tool/'):
        return {'shrink'}
    if path.startswith('scripts/shrink-spike/') or (path.startswith('scripts/') and path.endswith('.md')):
        return set()
    if path.startswith('scripts/'):
        if name.startswith('test_'):
            return None  # a new test must be added to SCRIPT_TESTS with the job that runs it
        return {'harness'}  # hand-run ops scripts: syntax checked
    if path.startswith('.githooks/'):
        return {'harness'}
    if path.startswith(('docs/', 'src/assets/', 'workers/', 'deploy/')) or path in LOCAL_ONLY:
        return set()  # docs/attachments, static brand files, hand-deployed edge code
    if path == 'qa/proof.json' or (path.startswith('qa/') and path.endswith(('.log', '.png'))):
        return set()  # worker proof evidence; no CI job executes it
    return None


def required_jobs(paths):
    jobs = {'tooling'}
    unclassified = []
    for path in paths:
        parts = PurePosixPath(path).parts
        if not path or path.startswith('/') or '\\' in path or '..' in parts:
            raise ValueError(f'Invalid repository path: {path!r}')
        needed = jobs_for(path)
        if needed is None:
            unclassified.append(path)
        else:
            jobs.update(needed)
    if unclassified:
        raise UnclassifiedPath('Unclassified path(s); add a rule to scripts/ci_policy.py naming the job '
                               'that executes, imports or parses each one: ' + ', '.join(map(repr, unclassified)))
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
            'policy_hash': hashlib.sha256(Path(__file__).read_text(encoding='utf-8').encode('utf-8')).hexdigest(),
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
