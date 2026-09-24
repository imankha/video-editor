"""Validate active agent metadata and local instruction links, not prompt semantics."""
import argparse
from pathlib import Path
import re
import sys

import yaml
from ci_policy import git_paths


def validate(root, paths):
    errors = []
    registered = sorted((root / '.claude/agents').glob('*.md'))
    skill_files = sorted((root / '.claude/skills').rglob('*.md'))
    selected = set(registered)
    selected.update(skill_files)
    selected.update(root / p for p in paths if '.claude' in Path(p).parts or Path(p).name in {'CLAUDE.md', 'AGENTS.md'})
    for path in sorted(selected):
        if not path.is_file() or path.suffix != '.md':
            continue  # Deleted instructions have no metadata; audit validates surviving references.
        relative = path.relative_to(root).as_posix()
        text = path.read_text(encoding='utf-8')
        is_agent = path in registered
        is_skill = path.name.lower() == 'skill.md'
        if is_skill and path.name != 'SKILL.md':
            errors.append(f'{relative}: skill filename must be SKILL.md')
        if is_agent or is_skill:
            match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
            try:
                data = yaml.safe_load(match.group(1)) if match else None
                if not isinstance(data, dict):
                    raise ValueError('missing/malformed YAML mapping')
                for field in ('name', 'description') + (('tools',) if is_agent else ()):
                    if not isinstance(data.get(field), str) or not data[field].strip():
                        raise ValueError(f'missing/non-string {field}')
                if is_agent and data['name'] != path.stem:
                    raise ValueError('agent name differs from filename')
                if is_skill and data['name'] != path.parent.name:
                    raise ValueError('skill name must match directory')
                for field in ('user-invocable', 'disable-model-invocation'):
                    if field in data and type(data[field]) is not bool:
                        raise ValueError(f'{field} must be boolean')
                if 'user_invocable' in data:
                    raise ValueError('use user-invocable, not user_invocable')
            except (ValueError, yaml.YAMLError) as exc:
                errors.append(f'{relative}: {exc}')
        # Ignore fenced examples; placeholders are not literal filesystem references.
        body = re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '', text, flags=re.M | re.S)
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', body):
            target = target.split('#', 1)[0]
            if not target or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', target) or any(c in target for c in '<>{} '):
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.is_relative_to(root.resolve()):
                errors.append(f'{relative}: link escapes repository: {target}')
            elif not resolved.exists():
                errors.append(f'{relative}: missing local link: {target}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--base')
    parser.add_argument('--head')
    args = parser.parse_args()
    if bool(args.base) != bool(args.head):
        parser.error('--base and --head are required together')
    paths = git_paths(args.root, args.base, args.head) if args.base else [
        'CLAUDE.md', '.claude/ORCHESTRATION.md', '.claude/references/agent-contract.md',
        *[p.relative_to(args.root).as_posix() for p in (args.root / '.claude/workflows').glob('*.md')]]
    errors = validate(args.root, paths)
    print('\n'.join(errors) if errors else 'Agent metadata and scoped local links passed')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
