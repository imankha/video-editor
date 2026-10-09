#!/usr/bin/env bash
# ============================================================================
# dotask.sh -- supervisorless /dotask entry point.
#
# One `/dotask T1 T2 ...` = ONE container + ONE checkout + ONE branch + ONE PR
# for the whole group, tasks worked sequentially, one commit per task. There is
# NO model supervisor: the user talks directly to the Claude session in the
# container (a new VS Code window, or headless with `task.sh run`). This is a
# thin wrapper; the implementation (and its tests) live in dotask_cli.py.
#
#   bash scripts/dotask.sh start [--headless] [--capture] T1 [T2 ...]
#   bash scripts/dotask.sh stack <slug>               # app stack up + healthy; prints the URL
#   bash scripts/dotask.sh land <slug>                # stack up for the human test; stops (no push)
#   bash scripts/dotask.sh land <slug> --after-test   # push + PR + CI + evidence for the tested HEAD
#   bash scripts/dotask.sh status
# ============================================================================
set -euo pipefail
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dotask_cli.py" "$@"
