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
    # Past the 2-minute default, a command is backgrounded, which ends a headless dispatch. `npm ci` on
    # the Windows bind mount takes about 3 minutes (g-t15000-2, 2026-11-06).
    env = data.get("env")
    if not isinstance(env, dict):
        env = {}
    env["BASH_DEFAULT_TIMEOUT_MS"] = "600000"
    env["BASH_MAX_TIMEOUT_MS"] = "600000"
    data["env"] = env
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
