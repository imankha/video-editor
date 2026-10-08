#!/usr/bin/env bash
# Bash harness for `task.sh run`'s implementation -> QA chaining (C1), without Docker:
# sources task.sh (so its constants/functions load, harmlessly printing help once for the
# empty-arg dispatch at the bottom), then SHADOWS `drive()` with a fake that only appends a
# scripted status line -- so run_task()'s own chaining logic (wait for exit, check the last
# status line, chain only on IMPL_READY, stop on anything else) is what's under test.
set -euo pipefail
cd "$(dirname "$0")"
export MAIN_REPO="$PWD/.."   # real repo root: image_hash() reads real Dockerfile/requirements
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export TASKS_ROOT="$root/tasks"
mkdir -p "$TASKS_ROOT/demo"
status="$TASKS_ROOT/demo/.dotask-status"
: > "$status"
calls="$root/calls.log"
: > "$calls"
fail=0

# shellcheck source=/dev/null
source ./task.sh "" >/dev/null 2>&1 || true

echo "=== chains implementation -> qa only on IMPL_READY ==="
drive() {
  local id="$1"; shift
  echo "DOTASK_PHASE=$DOTASK_PHASE id=$id args=$*" >> "$calls"
  case "$DOTASK_PHASE" in
    implementation) echo "2026-10-08T00:00 IMPL_READY feature/demo abc123" >> "$TASKS_ROOT/$id/.dotask-status" ;;
    qa) echo "2026-10-08T00:01 PUSHREADY feature/demo abc123" >> "$TASKS_ROOT/$id/.dotask-status" ;;
  esac
  return 0
}
out="$(run_task demo "go")"
echo "$out"
if ! grep -q "PUSHREADY" <<<"$out"; then echo "FAIL: expected PUSHREADY, got: $out"; fail=1; fi
if [ "$(grep -c "DOTASK_PHASE=" "$calls")" != 2 ]; then echo "FAIL: expected exactly 2 drive calls, got $(grep -c "DOTASK_PHASE=" "$calls")"; fail=1; fi
if ! grep -q "DOTASK_PHASE=qa.*-c" "$calls"; then echo "FAIL: QA dispatch must pass -c"; fail=1; fi
[ "$fail" = 0 ] && echo "PASS"

echo "=== stops at BLOCKED without dispatching QA ==="
: > "$calls"; : > "$status"
drive() {
  local id="$1"; shift
  echo "DOTASK_PHASE=$DOTASK_PHASE id=$id args=$*" >> "$calls"
  echo "2026-10-08T00:02 BLOCKED needs design input" >> "$TASKS_ROOT/$id/.dotask-status"
  return 0
}
out="$(run_task demo "go")"
echo "$out"
if ! grep -q "BLOCKED" <<<"$out"; then echo "FAIL: expected BLOCKED, got: $out"; fail=1; fi
if [ "$(grep -c "DOTASK_PHASE=" "$calls")" != 1 ]; then echo "FAIL: QA must not run after BLOCKED (calls: $(cat "$calls"))"; fail=1; fi
[ "$fail" = 0 ] && echo "PASS"

echo "=== stops when the implementation dispatch itself fails (nonzero exit, no new line) ==="
: > "$calls"; : > "$status"
drive() {
  local id="$1"; shift
  echo "DOTASK_PHASE=$DOTASK_PHASE id=$id args=$*" >> "$calls"
  echo "2026-10-08T00:03 DISPATCH_FAILED phase=implementation exit=1 outcome=error" >> "$TASKS_ROOT/$id/.dotask-status"
  return 1
}
rc=0
out="$(run_task demo "go")" || rc=$?
echo "$out (rc=$rc)"
if [ "$rc" = 0 ]; then echo "FAIL: run_task must propagate the implementation dispatch's failure"; fail=1; fi
if [ "$(grep -c "DOTASK_PHASE=" "$calls")" != 1 ]; then echo "FAIL: QA must not run after a failed dispatch"; fail=1; fi
[ "$fail" = 0 ] && echo "PASS"

if [ "$fail" = 0 ]; then
  echo "ALL PASS"
else
  echo "SOME FAILED"
fi
exit "$fail"
