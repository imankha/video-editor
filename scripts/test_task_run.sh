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

# --- stack --wait / wait_stack / alloc_offset (docker shadowed: nothing real runs) ----------
mkdir -p "$TASKS_ROOT/stk"
printf 'WT_OFFSET=3\nBACKEND_PORT=8003\nFRONTEND_PORT=5176\n' > "$TASKS_ROOT/stk/.task-env"
container_running() { return 0; }

echo "=== stack --wait stops the old stack synchronously, starts a fresh one, waits, prints the URL ==="
: > "$calls"
docker() { echo "docker $*" >> "$calls"; return 0; }
rc=0; out="$( (stack stk --wait) 2>&1 )" || rc=$?
stop_line="$(grep -n 'container-stack.sh --stop' "$calls" | cut -d: -f1 | head -1 || true)"
start_line="$(grep -n 'exec -d .*container-stack.sh$' "$calls" | cut -d: -f1 | head -1 || true)"
wait_line="$(grep -n 'api/health' "$calls" | cut -d: -f1 | head -1 || true)"
if [ "$rc" != 0 ]; then echo "FAIL: stack --wait exited $rc: $out"; fail=1; fi
if [ -z "$stop_line" ] || [ -z "$start_line" ] || [ -z "$wait_line" ] \
    || [ "$stop_line" -ge "$start_line" ] || [ "$start_line" -ge "$wait_line" ]; then
  echo "FAIL: expected stop -> detached start -> health wait, got:"; cat "$calls"; fail=1
fi
if ! grep -q "http://localhost:5176" <<<"$out"; then echo "FAIL: no offset URL in: $out"; fail=1; fi
[ "$fail" = 0 ] && echo "PASS"

echo "=== stack --wait fails loudly with the log paths when health never answers ==="
: > "$calls"
docker() { echo "docker $*" >> "$calls"; case "$*" in *api/health*) return 1 ;; esac; return 0; }
rc=0; out="$( (STACK_WAIT_SECONDS=2 stack stk --wait) 2>&1 )" || rc=$?
if [ "$rc" = 0 ]; then echo "FAIL: a stack that never answers must exit nonzero"; fail=1; fi
if ! grep -q "/tmp/backend.log" <<<"$out" || ! grep -q "/tmp/frontend.log" <<<"$out"; then
  echo "FAIL: timeout must print the log paths, got: $out"; fail=1
fi
if grep -q "open: http" <<<"$out"; then echo "FAIL: must not print the URL as if usable"; fail=1; fi
[ "$fail" = 0 ] && echo "PASS"

echo "=== alloc_offset stays inside the R2 CORS allowlist (frontend ports 5174-5183) ==="
mkdir -p "$TASKS_ROOT/ports1" "$TASKS_ROOT/ports2"
host_port_busy() { [ "$1" -lt 5183 ] || { [ "$1" -ge 8000 ] && [ "$1" -lt 8010 ]; }; }  # offsets 1-9 taken
rc=0; out="$( (alloc_offset "$TASKS_ROOT/ports1") 2>&1 )" || rc=$?
if [ "$rc" != 0 ] || [ "$out" != 10 ]; then echo "FAIL: expected offset 10, got rc=$rc out=$out"; fail=1; fi
host_port_busy() { return 0; }  # every offset taken
rc=0; out="$( (alloc_offset "$TASKS_ROOT/ports2") 2>&1 )" || rc=$?
if [ "$rc" = 0 ] || ! grep -q "CORS" <<<"$out" || [ -f "$TASKS_ROOT/ports2/.task-env" ]; then
  echo "FAIL: with 1-${MAX_OFFSET:-?} busy, alloc must refuse (not hand out a CORS-blocked port): rc=$rc out=$out"; fail=1
fi
[ "$fail" = 0 ] && echo "PASS"

echo "=== container-stack.sh --stop stops only stack processes and clears the logs ==="
if [ "$(uname -s)" = Linux ] && [ -r /proc/self/status ]; then
  sroot="$root/stackroot"; mkdir -p "$sroot"
  ( exec -a node python3 -c 'import time; time.sleep(60)' node_modules/.bin/vite ) & vite_pid=$!
  bash -c 'sleep 60; : npm run dev uvicorn app.main:app' & decoy_pid=$!
  sleep 0.5
  echo "ERROR:    Application startup failed. Exiting." > "$root/backend.log"
  start_s=$(date +%s)
  STACK_ROOT="$sroot" LOGDIR="$root" bash ../.devcontainer/container-stack.sh --stop >/dev/null
  took=$(( $(date +%s) - start_s ))
  wait "$vite_pid" 2>/dev/null || true
  if kill -0 "$vite_pid" 2>/dev/null; then echo "FAIL: the vite process survived --stop"; fail=1; fi
  if ! kill -0 "$decoy_pid" 2>/dev/null; then echo "FAIL: a shell that only MENTIONS stack commands was killed"; fail=1; fi
  if [ -s "$root/backend.log" ]; then echo "FAIL: --stop must clear the previous backend.log"; fail=1; fi
  if [ "$took" -ge 8 ]; then echo "FAIL: --stop took ${took}s (a zombie must count as stopped)"; fail=1; fi
  kill "$decoy_pid" 2>/dev/null || true
  [ "$fail" = 0 ] && echo "PASS"
else
  echo "SKIP (needs Linux /proc)"
fi

if [ "$fail" = 0 ]; then
  echo "ALL PASS"
else
  echo "SOME FAILED"
fi
exit "$fail"
