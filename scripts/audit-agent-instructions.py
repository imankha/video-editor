#!/usr/bin/env python3
"""Check structural instruction invariants, not semantic correctness of prompts."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / ".claude" / "agents"
SCANNED = [ROOT / "CLAUDE.md", ROOT / ".claude" / "ORCHESTRATION.md"]
SCANNED += sorted((ROOT / ".claude" / "workflows").glob("*.md"))
SCANNED += sorted(AGENT_DIR.glob("*.md"))
SCANNED += sorted((ROOT / ".claude" / "skills").rglob("*.md"))
SCANNED += sorted((ROOT / ".claude" / "schemas").glob("*.md"))
CONTRACT = ROOT / ".claude" / "references" / "agent-contract.md"
if CONTRACT.is_file():
    SCANNED.append(CONTRACT)


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    block = text.split("---", 2)[1]
    values = {}
    for line in block.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip()
    return values


def main() -> int:
    errors: list[str] = []
    if not CONTRACT.is_file():
        errors.append("missing shared agent contract: .claude/references/agent-contract.md")
    agents: dict[str, Path] = {}
    for path in sorted(AGENT_DIR.glob("*.md")):
        meta = frontmatter(path)
        name = meta.get("name")
        if not name:
            errors.append(f"{path.relative_to(ROOT)}: missing frontmatter name")
            continue
        if name in agents:
            errors.append(f"duplicate agent name {name}: {agents[name]} and {path}")
        agents[name] = path
        if not meta.get("tools"):
            errors.append(f"{path.relative_to(ROOT)}: every agent needs explicit tools")
        if "../references/agent-contract.md" not in path.read_text(encoding="utf-8"):
            errors.append(f"{path.relative_to(ROOT)}: must reference shared agent contract")

    legacy = re.compile(r"subagent_type:\s*(general-purpose|Plan|Explore)\b")
    invocation = re.compile(r"subagent_type:\s*([a-z][a-z0-9-]*)\b")
    for path in SCANNED:
        text = path.read_text(encoding="utf-8")
        for match in legacy.finditer(text):
            errors.append(f"{path.relative_to(ROOT)}: legacy agent invocation `{match.group(0)}`")
        for match in invocation.finditer(text):
            name = match.group(1)
            if name not in agents:
                errors.append(f"{path.relative_to(ROOT)}: unknown registered agent `{name}`")
        if "**Status:** TESTING" in text:
            errors.append(f"{path.relative_to(ROOT)}: TESTING is not a task lifecycle status")

    if errors:
        print("Agent instruction audit failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"Agent instruction audit passed: {len(agents)} agents, {len(SCANNED)} instruction files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
