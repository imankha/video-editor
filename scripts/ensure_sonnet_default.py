"""Idempotently merge the Sonnet-alias default and bypassPermissions into a Claude
settings.json, without clobbering any other key (container task workers only; the
user requires every task container's Claude to default to `sonnet`). Called from
`.devcontainer/task-bootstrap.sh` on every `task.sh up`.

Usage: python scripts/ensure_sonnet_default.py <settings.json path>
"""
import json
import sys
from pathlib import Path


def merge(path):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    permissions = data.get("permissions")
    if not isinstance(permissions, dict):
        permissions = {}
    permissions["defaultMode"] = "bypassPermissions"
    data["permissions"] = permissions
    data["model"] = "sonnet"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: ensure_sonnet_default.py <settings.json path>", file=sys.stderr)
        return 2
    merge(argv[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
