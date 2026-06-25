#!/usr/bin/env bash
# ============================================================================
# task.sh -- parallel, permission-free Claude sandboxes, one container per task
# ============================================================================
# Each task gets its OWN container (a local clone of the repo, the backend prod
# deps baked in, offset host ports, bypassPermissions). MANY conversations can
# attach to the SAME task container -- so several chats collaborate on one task,
# sharing files -- while DIFFERENT tasks run fully in parallel and isolated.
#
#   bash scripts/task.sh <id>          # up + open a permission-free Claude session (common path)
#   bash scripts/task.sh <id> --prompt-file <path>   # ...and feed Claude that prompt as its first message
#   bash scripts/task.sh up <id>       # ensure the task's checkout + container are running (no Claude)
#   bash scripts/task.sh claude <id>   # open ANOTHER Claude session in the task (run N times for N chats)
#   bash scripts/task.sh code <id> [--prompt-file <path>]  # open VS Code ATTACHED to the container (GUI Claude + image paste; optionally seed a kickoff)
#   bash scripts/task.sh stack <id>    # start the app (backend+frontend) in the container on offset ports
#   bash scripts/task.sh test <id>     # start the stack + run the Playwright E2E suite (headless) in the container
#   bash scripts/task.sh down <id>     # stop + remove the container (keeps the checkout)
#   bash scripts/task.sh nuke <id>     # down + delete the checkout dir
#   bash scripts/task.sh list          # show all task containers, ports, status
#
# Safe: damage is scoped to the container + that task's checkout dir; your OS,
# ~/.ssh, and other tasks are untouched. Permission-free: bypassPermissions is
# baked into the container's own ~/.claude.
# ============================================================================
set -euo pipefail

# --- constants (this machine) ------------------------------------------------
MAIN_REPO="${MAIN_REPO:-/c/Users/imank/projects/video-editor}"
TASKS_ROOT="${TASKS_ROOT:-/c/work/tasks}"
IMAGE="${REEL_TASK_IMAGE:-reel-task:latest}"
AUTH_VOLUME="reel-claude-config"      # shared across ALL task containers -> sign in once
DOCKERFILE_REL=".devcontainer/task.Dockerfile"
INTERNAL_BACKEND=8000
INTERNAL_FRONTEND=5173

die() { echo "ERROR: $*" >&2; exit 1; }
sanitize() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g'; }

# Windows path for docker -v / -w on Git Bash (avoids MSYS mangling).
winpath() { cygpath -w "$1" 2>/dev/null || echo "$1"; }

cname()  { echo "reel-task-$(sanitize "$1")"; }
taskdir(){ echo "$TASKS_ROOT/$(sanitize "$1")"; }

# --- image -------------------------------------------------------------------
ensure_image() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "[task] building image $IMAGE (first time; a couple of minutes)..." >&2
    ( cd "$MAIN_REPO" && docker build -f "$DOCKERFILE_REL" -t "$IMAGE" . ) \
      || die "image build failed"
  fi
}

# --- per-task offset (persisted in <checkout>/.task-env) ---------------------
host_port_busy() { docker ps --format '{{.Ports}}' | grep -q ":$1->" || netstat -ano 2>/dev/null | grep -q ":$1 .*LISTENING"; }
alloc_offset() {
  local dir="$1"
  if [ -f "$dir/.task-env" ]; then ( . "$dir/.task-env"; echo "$WT_OFFSET" ); return; fi
  local n
  for n in $(seq 1 40); do
    if ! host_port_busy $((INTERNAL_BACKEND+n)) && ! host_port_busy $((INTERNAL_FRONTEND+n)); then
      cat > "$dir/.task-env" <<EOF
WT_OFFSET=$n
BACKEND_PORT=$((INTERNAL_BACKEND+n))
FRONTEND_PORT=$((INTERNAL_FRONTEND+n))
EOF
      echo "$n"; return
    fi
  done
  die "no free port offset found (1..40 all busy)"
}

# --- checkout (local clone; self-contained .git so git works in-container) ----
ensure_checkout() {
  local id="$1" dir; dir="$(taskdir "$id")"
  if [ ! -d "$dir/.git" ]; then
    mkdir -p "$TASKS_ROOT"
    echo "[task] cloning $MAIN_REPO -> $dir (local hardlink clone)..." >&2
    git clone --local "$MAIN_REPO" "$dir" >/dev/null 2>&1 || die "clone failed"
    local origin; origin="$(git -C "$MAIN_REPO" remote get-url origin)"
    git -C "$dir" remote set-url origin "$origin"   # push goes to GitHub, not the local main
    # gitignored config the clone won't carry:
    [ -f "$MAIN_REPO/.env" ] && cp "$MAIN_REPO/.env" "$dir/.env"
    [ -f "$MAIN_REPO/src/frontend/.env" ] && cp "$MAIN_REPO/src/frontend/.env" "$dir/src/frontend/.env"
    echo "[task] checkout ready on master; the Claude session will branch per the workflow." >&2
  fi
  echo "$dir"
}

# --- container lifecycle -----------------------------------------------------
container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$(cname "$1")" 2>/dev/null)" = "true" ]; }

up() {
  local id="$1"; [ -n "$id" ] || die "usage: task up <id>"
  ensure_image
  local dir; dir="$(ensure_checkout "$id")"
  local off; off="$(alloc_offset "$dir")"
  local cn; cn="$(cname "$id")"
  local bp=$((INTERNAL_BACKEND+off)) fp=$((INTERNAL_FRONTEND+off))

  if ! docker inspect "$cn" >/dev/null 2>&1; then
    echo "[task] starting container $cn (offset $off: backend :$bp, frontend :$fp)..." >&2
    MSYS_NO_PATHCONV=1 docker run -d \
      --name "$cn" \
      --add-host=host.docker.internal:host-gateway \
      -p ${bp}:${INTERNAL_BACKEND} -p ${fp}:${INTERNAL_FRONTEND} \
      -e BACKEND_PORT=${INTERNAL_BACKEND} -e FRONTEND_PORT=${INTERNAL_FRONTEND} -e LOGDIR=/tmp \
      -v "$(winpath "$dir"):/workspace" \
      -v "${AUTH_VOLUME}:/home/dev/.claude" \
      -v "$(winpath "$HOME/.claude"):/host-claude:ro" \
      -v "${cn}-node:/workspace/src/frontend/node_modules" \
      "$IMAGE" >/dev/null || die "docker run failed"
  elif ! container_running "$id"; then
    echo "[task] restarting stopped container $cn..." >&2
    docker start "$cn" >/dev/null || die "docker start failed"
  fi

  # one-time-ish bootstrap (idempotent): fix volume ownership, bypass settings, seed creds
  MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" bash /workspace/.devcontainer/task-bootstrap.sh || true

  # frontend deps into the node_modules volume on first up (backend deps are baked)
  if ! MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" test -d /workspace/src/frontend/node_modules/.bin; then
    echo "[task] installing frontend deps (one-time, ~1-2 min; runs in background)..." >&2
    MSYS_NO_PATHCONV=1 docker exec -d -u dev "$cn" bash -lc 'cd /workspace/src/frontend && npm install'
  fi
  echo "$cn"
}

claude_session() {
  local id="$1"; shift || true; [ -n "$id" ] || die "usage: task claude <id>"
  # Optional: --prompt-file <hostpath> feeds Claude an initial prompt. We pipe the
  # file's bytes over `docker exec -i` stdin into a file INSIDE the container, then
  # have Claude read it there -- so the (multi-line) prompt never crosses the
  # winpty/MSYS arg boundary, where quoting + path conversion would mangle it.
  local prompt_file=""
  if [ "${1:-}" = "--prompt-file" ]; then
    prompt_file="${2:-}"; shift 2 || true
    [ -f "$prompt_file" ] || die "prompt file not found: $prompt_file"
  fi
  local cn; cn="$(cname "$id")"
  container_running "$id" || up "$id" >/dev/null
  if [ -n "$prompt_file" ]; then
    MSYS_NO_PATHCONV=1 docker exec -i -u dev "$cn" \
      bash -c 'cat > /workspace/.dotask-kickoff.md' < "$prompt_file" \
      || die "failed to write prompt into $cn"
    echo "[task] seeded kickoff prompt -> $cn:/workspace/.dotask-kickoff.md" >&2
  fi
  echo "[task] entering permission-free Claude session in $cn (Ctrl-C / /exit to leave; container stays warm)..." >&2
  # Git Bash/MinTTY isn't a real console TTY, so `docker exec -it` fails with
  # "the input device is not a TTY". winpty (bundled with Git Bash) bridges it.
  local WINPTY=""
  case "${MSYSTEM:-}" in MINGW*|MSYS*|UCRT*) command -v winpty >/dev/null 2>&1 && WINPTY="winpty";; esac
  # No -w: the image's WORKDIR is /workspace, so exec lands there. Passing a
  # unix -w path would get mangled by MSYS ("Cwd must be an absolute path").
  if [ -n "$prompt_file" ]; then
    # Read the prompt inside the container (one quoted arg); never crosses winpty.
    exec env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
      $WINPTY docker exec -it -u dev "$cn" bash -lc 'cd /workspace && exec claude "$(cat .dotask-kickoff.md)"'
  fi
  exec env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    $WINPTY docker exec -it -u dev "$cn" bash -lc 'cd /workspace && exec claude "$@"' _ "$@"
}

stack() {
  local id="$1"; [ -n "$id" ] || die "usage: task stack <id>"
  local cn dir off; cn="$(cname "$id")"; dir="$(taskdir "$id")"
  container_running "$id" || up "$id" >/dev/null
  off="$( . "$dir/.task-env"; echo "$WT_OFFSET" )"
  echo "[task] starting app stack in $cn -> host backend :$((INTERNAL_BACKEND+off)), frontend :$((INTERNAL_FRONTEND+off))" >&2
  MSYS_NO_PATHCONV=1 docker exec -d -u dev "$cn" bash /workspace/.devcontainer/container-stack.sh
  echo "[task] open: http://localhost:$((INTERNAL_FRONTEND+off))" >&2
}

# --- E2E (Playwright runs INSIDE the container; headless chromium is baked) ----
# Starts the app stack (container-stack.sh -> correct host.docker.internal DB),
# waits for the frontend to answer on the container's internal port (5173), then
# runs the suite. Servers run on the image's internal 8000/5173, which is exactly
# what playwright.config.js defaults to -- so no base-URL juggling is needed.
e2e_test() {
  local id="$1"; shift || true; [ -n "$id" ] || die "usage: task test <id>"
  local cn; cn="$(cname "$id")"
  container_running "$id" || up "$id" >/dev/null
  echo "[task] starting app stack in $cn for E2E..." >&2
  MSYS_NO_PATHCONV=1 docker exec -d -u dev "$cn" bash /workspace/.devcontainer/container-stack.sh
  echo "[task] waiting for frontend (container :$INTERNAL_FRONTEND) and backend health..." >&2
  MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" bash -lc '
    for i in $(seq 1 60); do
      curl -fsS "http://localhost:'"$INTERNAL_FRONTEND"'" >/dev/null 2>&1 \
        && curl -fsS "http://localhost:'"$INTERNAL_BACKEND"'/api/health" >/dev/null 2>&1 \
        && exit 0
      sleep 2
    done
    echo "[task] servers did not come up in time; see /tmp/backend.log /tmp/frontend.log" >&2
    exit 1
  ' || die "stack failed to start; check logs with: bash scripts/task.sh claude $id  then reduce_log /tmp/backend.log"
  echo "[task] running Playwright E2E (headless chromium) in $cn..." >&2
  # Pass through any extra args (e.g. --grep @smoke, a spec path).
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec -u dev "$cn" \
    bash -lc 'cd /workspace/src/frontend && exec npx playwright test "$@"' _ "$@"
}

# --- VS Code attached to the container (GUI session -> image paste works) -----
# A terminal `claude` session can't paste images; the VS Code Claude extension
# can. This opens a VS Code window ATTACHED to the task's running container, so
# the extension runs inside it (same /workspace, same bypassPermissions, same
# seeded auth volume) with full GUI. First attach installs the VS Code server +
# extensions in the container (~1 min); later attaches are instant.
code_session() {
  local id="$1"; shift || true; [ -n "$id" ] || die "usage: task code <id> [--prompt-file <path>]"
  # Optional: --prompt-file seeds the kickoff into the container so the GUI Claude
  # session in the attached window can act on it (the user sends one short line).
  local prompt_file=""
  if [ "${1:-}" = "--prompt-file" ]; then
    prompt_file="${2:-}"; shift 2 || true
    [ -f "$prompt_file" ] || die "prompt file not found: $prompt_file"
  fi
  command -v code >/dev/null 2>&1 || die "VS Code 'code' CLI not on PATH"
  local cn; cn="$(cname "$id")"
  container_running "$id" || up "$id" >/dev/null
  if [ -n "$prompt_file" ]; then
    MSYS_NO_PATHCONV=1 docker exec -i -u dev "$cn" \
      bash -c 'cat > /workspace/.dotask-kickoff.md' < "$prompt_file" \
      || die "failed to seed prompt into $cn"
    echo "[task] seeded kickoff -> $cn:/workspace/.dotask-kickoff.md" >&2
  fi
  # Dev Containers "attach to running container" folder URI: the authority is
  # attached-container+<hex>, where <hex> is hex-encoded {"containerName":"/<cn>"}.
  local hex; hex="$(printf '{"containerName":"/%s"}' "$cn" | od -An -tx1 | tr -d ' \n')"
  echo "[task] opening VS Code attached to $cn:/workspace (Claude extension there: GUI + image paste)..." >&2
  code --folder-uri "vscode-remote://attached-container+${hex}/workspace"
  [ -n "$prompt_file" ] && echo "[task] In the new window's Claude panel, send:  Implement /workspace/.dotask-kickoff.md" >&2
  true
}

down() {
  local id="$1"; [ -n "$id" ] || die "usage: task down <id>"
  local cn; cn="$(cname "$id")"
  docker rm -f "$cn" >/dev/null 2>&1 && echo "[task] removed container $cn" >&2 || echo "[task] no container $cn" >&2
  docker volume rm "${cn}-node" >/dev/null 2>&1 || true
}

nuke() {
  local id="$1"; [ -n "$id" ] || die "usage: task nuke <id>"
  down "$id"
  local dir; dir="$(taskdir "$id")"
  [ -d "$dir" ] && rm -rf "$dir" && echo "[task] deleted checkout $dir" >&2 || true
}

list() {
  printf '%-26s %-10s %-22s %s\n' "CONTAINER" "STATE" "PORTS(host)" "CHECKOUT"
  docker ps -a --filter "name=reel-task-" --format '{{.Names}}\t{{.State}}\t{{.Ports}}' \
    | while IFS=$'\t' read -r name state ports; do
        local short; short="${name#reel-task-}"
        printf '%-26s %-10s %-22s %s\n' "$name" "$state" "$(echo "$ports" | grep -oE '0.0.0.0:[0-9]+' | tr '\n' ',' )" "$TASKS_ROOT/$short"
      done
}

# --- dispatch ----------------------------------------------------------------
cmd="${1:-}"; shift || true
case "$cmd" in
  ""|-h|--help) sed -n '2,23p' "$0" ;;
  up)     up "$@" >/dev/null ;;
  claude) claude_session "$@" ;;
  stack)  stack "$@" ;;
  test)   e2e_test "$@" ;;
  code)   code_session "$@" ;;
  down)   down "$@" ;;
  nuke)   nuke "$@" ;;
  list)   list ;;
  *)      # bare id: up + claude (the common path)
          claude_session "$cmd" "$@" ;;
esac
