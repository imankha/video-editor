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
#   bash scripts/task.sh drive <id> [-c] "<instruction>"  # re-seed creds, auth check, then a profiled headless dispatch (env: DOTASK_WAVE_ID/PHASE/MODEL/EFFORT/DESIGN_REASON/MAX_TURNS/TASK_IDS)
#   bash scripts/task.sh claude <id>   # open ANOTHER Claude session in the task (run N times for N chats)
#   bash scripts/task.sh code <id> [--prompt-file <path>]  # open VS Code ATTACHED to the container (GUI Claude + image paste; optionally seed a kickoff)
#   bash scripts/task.sh stack <id>    # start the app (backend+frontend) in the container on offset ports
#   bash scripts/task.sh test <id>     # start the stack + run the Playwright E2E suite (headless) in the container
#   bash scripts/task.sh push <id> [--force]  # push the task's branch to GitHub (host creds); guards against CRLF-noise pushes (--force overrides)
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
# Image tag is a content hash of its build inputs, so editing the Dockerfile or
# the baked requirements AUTO-rebuilds on the next `up` (a fixed :latest tag let
# the image go stale: T4120's pytest bake never reached workers).
image_hash() {
  ( cd "$MAIN_REPO" && cat .devcontainer/task.Dockerfile \
      src/backend/requirements.prod.txt src/backend/requirements.test.txt 2>/dev/null \
      | git hash-object --stdin | cut -c1-12 )
}
IMAGE="${REEL_TASK_IMAGE:-reel-task:$(image_hash)}"
# Per-task ~/.claude volume. Was one shared volume ("sign in once"), but Claude CLI
# keys conversation sessions by cwd and every container's cwd is /workspace, so with
# parallel workers `claude -p -c` resumed a RANDOM worker's session (observed: a QA
# continuation for one task resuming another task's conversation). Credentials still
# seed automatically per-volume from the read-only /host-claude mount (bootstrap).
auth_volume() { echo "reel-claude-config-$(sanitize "$1")"; }
DOCKERFILE_REL=".devcontainer/task.Dockerfile"
INTERNAL_BACKEND=8000
INTERNAL_FRONTEND=5173

die() { echo "ERROR: $*" >&2; exit 1; }
sanitize() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g'; }

# Windows path for docker -v / -w on Git Bash (avoids MSYS mangling).
winpath() { cygpath -w "$1" 2>/dev/null || echo "$1"; }

# --- meta timing: host wall clock per lifecycle step ---------------------------
# One JSON line per step in $TASKS_ROOT/profiles/<slug>/meta.jsonl (outlives nuke);
# `python scripts/wave_profile.py report` aggregates it per wave. No model calls.
jsafe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._-'; }
now_s() { date +%s.%N 2>/dev/null || date +%s; }
meta_log() {
  local id="$1" step="$2" start="$3" rc="$4" dir
  dir="$TASKS_ROOT/profiles/$(sanitize "$id")"
  mkdir -p "$dir" 2>/dev/null || return 0
  printf '{"schema_version":1,"wave_id":"%s","task":"%s","step":"%s","started_at":%s,"seconds":%s,"exit_code":%s}\n' \
    "$(jsafe "${DOTASK_WAVE_ID:-standalone-$id}")" "$(jsafe "$id")" "$step" "$start" \
    "$(awk -v a="$start" -v b="$(now_s)" 'BEGIN{printf "%.3f", b-a}')" "${rc:-0}" >> "$dir/meta.jsonl" 2>/dev/null || true
}

cname()  { echo "reel-task-$(sanitize "$1")"; }
taskdir(){ echo "$TASKS_ROOT/$(sanitize "$1")"; }

# --- image -------------------------------------------------------------------
ensure_image() {
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "[task] building image $IMAGE (inputs changed or first time; a couple of minutes)..." >&2
    local t rc=0; t="$(now_s)"
    ( cd "$MAIN_REPO" && docker build -f "$DOCKERFILE_REL" -t "$IMAGE" . ) || rc=$?
    meta_log "${1:-image}" image_build "$t" "$rc"
    [ "$rc" = 0 ] || die "image build failed"
    # keep a stable alias for manual docker runs; prune superseded content tags
    docker tag "$IMAGE" reel-task:latest >/dev/null 2>&1 || true
    docker images 'reel-task' --format '{{.Repository}}:{{.Tag}}' \
      | grep -v -e ":latest$" -e "^$IMAGE$" | xargs -r docker rmi >/dev/null 2>&1 || true
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
    local t; t="$(now_s)"
    # core.autocrlf=false: the host repo checks out CRLF (Windows), but this
    # checkout is consumed by a LINUX container -- an autocrlf clone shows 1500+
    # phantom-modified files in-container and forces git-add gymnastics.
    git clone --local --config core.autocrlf=false "$MAIN_REPO" "$dir" >/dev/null 2>&1 || die "clone failed"
    local origin; origin="$(git -C "$MAIN_REPO" remote get-url origin)"
    git -C "$dir" remote set-url origin "$origin"   # push goes to GitHub, not the local main
    # Push guard: this checkout is driven by a permission-free worker INSIDE the
    # container, which has no push creds BY DESIGN (a push sends only commits; the
    # supervisor pushes from the host via `task.sh push`). Without this, a worker
    # that runs `git push` fumbles an auth failure ("could not read Username") and
    # burns tokens diagnosing it. The guard hard-aborts a push from inside the
    # container (detected via /.dockerenv) in ONE line; host pushes have no
    # /.dockerenv and pass straight through. `git clone --local` gives a fresh
    # .git/hooks (default hooksPath), so this pre-push is active without touching
    # the repo's committed .githooks.
    mkdir -p "$dir/.git/hooks"
    cat > "$dir/.git/hooks/pre-push" <<'HOOK'
#!/bin/sh
if [ -f /.dockerenv ]; then
  echo "[dotask] Workers do NOT push (no creds by design). Commit + report; the supervisor runs 'bash scripts/task.sh push <id>'." >&2
  exit 1
fi
exit 0
HOOK
    chmod +x "$dir/.git/hooks/pre-push"
    # Base the task on origin/master, NOT whatever branch the shared tree is on
    # (a shared-tree feature branch used to leak sibling commits into task pushes).
    # TASK_BASE overrides when a task must build on an unmerged branch.
    local base="${TASK_BASE:-master}"
    if git -C "$dir" fetch origin "$base" >/dev/null 2>&1; then
      git -C "$dir" checkout -B "$base" FETCH_HEAD >/dev/null 2>&1 || true
      echo "[task] based on origin/$base @ $(git -C "$dir" rev-parse --short HEAD)" >&2
    else
      echo "[task] WARN: could not fetch origin/$base (offline?); using the local clone's HEAD" >&2
    fi
    # LF re-checkout so the worktree matches the index (kills CRLF noise at birth).
    git -C "$dir" checkout -f -- . 2>/dev/null || true
    # gitignored config the clone won't carry:
    [ -f "$MAIN_REPO/.env" ] && cp "$MAIN_REPO/.env" "$dir/.env"
    [ -f "$MAIN_REPO/src/frontend/.env" ] && cp "$MAIN_REPO/src/frontend/.env" "$dir/src/frontend/.env"
    meta_log "$id" clone "$t" 0
    echo "[task] checkout ready; the Claude session will branch per the workflow." >&2
  fi
  ensure_excludes "$dir"
  echo "$dir"
}

# Usage logs hold prompts/tool output; keep them out of git even in clones whose
# branch predates the .gitignore rule.
ensure_excludes() {
  local exclude="$1/.git/info/exclude"
  [ -d "$1/.git" ] || return 0
  mkdir -p "$1/.git/info"
  grep -qxF '.dotask-profile/' "$exclude" 2>/dev/null || echo '.dotask-profile/' >> "$exclude"
}

# Copy the worker's usage records to a host directory that outlives `nuke`.
archive_profiles() {
  local src dest; src="$(taskdir "$1")/.dotask-profile"; dest="$TASKS_ROOT/profiles/$(sanitize "$1")"
  [ -d "$src" ] || return 0
  mkdir -p "$dest" && cp -u "$src"/* "$dest"/ 2>/dev/null || echo "[task] WARN: could not archive $src to $dest" >&2
}

# --- container lifecycle -----------------------------------------------------
container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$(cname "$1")" 2>/dev/null)" = "true" ]; }

up() {
  local id="$1"; [ -n "$id" ] || die "usage: task up <id>"
  ensure_image "$id"
  local dir; dir="$(ensure_checkout "$id")"
  local off; off="$(alloc_offset "$dir")"
  local cn; cn="$(cname "$id")"
  local bp=$((INTERNAL_BACKEND+off)) fp=$((INTERNAL_FRONTEND+off))

  if ! docker inspect "$cn" >/dev/null 2>&1; then
    echo "[task] starting container $cn (offset $off: backend :$bp, frontend :$fp)..." >&2
    local t; t="$(now_s)"
    MSYS_NO_PATHCONV=1 docker run -d \
      --name "$cn" \
      --add-host=host.docker.internal:host-gateway \
      -p ${bp}:${INTERNAL_BACKEND} -p ${fp}:${INTERNAL_FRONTEND} \
      -e BACKEND_PORT=${INTERNAL_BACKEND} -e FRONTEND_PORT=${INTERNAL_FRONTEND} -e LOGDIR=/tmp \
      -v "$(winpath "$dir"):/workspace" \
      -v "$(auth_volume "$id"):/home/dev/.claude" \
      -v "$(winpath "$HOME/.claude"):/host-claude:ro" \
      -v "${cn}-node:/workspace/src/frontend/node_modules" \
      "$IMAGE" >/dev/null || { meta_log "$id" container_create "$t" 1; die "docker run failed"; }
    meta_log "$id" container_create "$t" 0
  elif ! container_running "$id"; then
    echo "[task] restarting stopped container $cn..." >&2
    local t; t="$(now_s)"
    docker start "$cn" >/dev/null || { meta_log "$id" container_start "$t" 1; die "docker start failed"; }
    meta_log "$id" container_start "$t" 0
  fi

  # one-time-ish bootstrap (idempotent): fix volume ownership, bypass settings, seed creds
  local tb rcb=0; tb="$(now_s)"
  MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" bash /workspace/.devcontainer/task-bootstrap.sh || rcb=$?
  meta_log "$id" bootstrap "$tb" "$rcb"

  # frontend deps into the node_modules volume on first up (backend deps are baked).
  # npm ci (not install): never mutates package-lock.json in the checkout. The
  # .ready marker lets container-stack.sh / dev-verify.sh gate on completion.
  if ! MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" test -f /workspace/src/frontend/node_modules/.ready; then
    echo "[task] installing frontend deps (one-time, ~1-2 min; runs in background)..." >&2
    meta_log "$id" npm_ci_started "$(now_s)" 0
    MSYS_NO_PATHCONV=1 docker exec -d -u dev "$cn" bash -lc \
      'cd /workspace/src/frontend && npm ci --no-audit --no-fund && touch node_modules/.ready'
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

# --- credential pre-flight (force-copy, bypassing mtime entirely) ------------
# Bakes the previously-manual "docker cp + chown + chmod" incident recovery in
# as an UNCONDITIONAL step run before every dispatch, instead of a runbook a
# human has to remember to run reactively after noticing a container went
# silent. See project_dotask_quota_hit_corrupts_container_credentials memory:
# concurrent containers redeeming the same OAuth refresh token race at spawn or
# at a subscription reset window; the loser writes a corrupted local
# credentials.json whose mtime looks newer than the host copy, so
# task-bootstrap.sh's up-time `cp -u` can't fix it. Re-copying from the host
# before every dispatch (not just at container `up`) closes that window.
seed_creds() {
  local cn="$1"
  MSYS_NO_PATHCONV=1 docker cp "$(winpath "$HOME/.claude/.credentials.json")" "$cn:/home/dev/.claude/.credentials.json" \
    || die "failed to copy host credentials into $cn (is the host CLI logged in?)"
  MSYS_NO_PATHCONV=1 docker exec -u root "$cn" chown dev:dev /home/dev/.claude/.credentials.json
  MSYS_NO_PATHCONV=1 docker exec -u root "$cn" chmod 600 /home/dev/.claude/.credentials.json
}

# --- drive: seed + auth check + the profiled headless dispatch ----------------
# Replaces raw `docker exec ... claude -p` from spawn-worker. The auth check is
# `claude auth status` (no model call and no session, so it can never become the
# target of a later `-c`). A failed check writes AUTH_DEAD to the status file and
# exits non-zero -- exit-0 silence is exactly the failure mode that let T9530 sit
# dead for 7 hours. The dispatch runs through scripts/wave_profile.py, which owns
# every Claude flag (model, effort, turns, output) and accepts only `-c` /
# `--resume <id>` plus the instruction. It records usage in .dotask-profile/ and
# appends DISPATCH_FAILED / ENDED_WITHOUT_STATUS / PHASE_VIOLATION when the
# worker itself left no status line.
drive() {
  local id="$1"; shift || true
  [ -n "$id" ] || die "usage: task drive <id> [-c] \"<instruction>\" (env: DOTASK_WAVE_ID, DOTASK_PHASE, DOTASK_MODEL, DOTASK_EFFORT, DOTASK_DESIGN_REASON, DOTASK_MAX_TURNS, DOTASK_TASK_IDS)"
  local phase="${DOTASK_PHASE:-implementation}" model="${DOTASK_MODEL:-sonnet}"
  local effort="${DOTASK_EFFORT:-medium}" reason="${DOTASK_DESIGN_REASON:-}"
  # Cheap host-side checks before waking a container; wave_profile.py re-validates.
  case "$phase" in design|implementation|qa) ;; *) die "DOTASK_PHASE must be design, implementation or qa";; esac
  case "$model" in sonnet|opus) ;; *) die "DOTASK_MODEL must be the alias sonnet or opus";; esac
  [ "$model" != opus ] || { [ -n "$reason" ] && [ "$phase" = design ]; } \
    || die "Opus requires DOTASK_PHASE=design and DOTASK_DESIGN_REASON"
  [ -n "${DOTASK_WAVE_ID:-}" ] \
    || echo "[task] WARN: DOTASK_WAVE_ID unset; usage is recorded as standalone-$id and excluded from wave reports" >&2

  local cn dir status t rc; cn="$(cname "$id")"; dir="$(taskdir "$id")"; status="$dir/.dotask-status"
  if ! container_running "$id"; then
    t="$(now_s)"; up "$id" >/dev/null; meta_log "$id" container_wake "$t" 0
  fi
  t="$(now_s)"; seed_creds "$cn"; meta_log "$id" seed_creds "$t" 0

  t="$(now_s)"; rc=0
  MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" claude auth status --text >/dev/null || rc=$?
  meta_log "$id" auth_status "$t" "$rc"
  if [ "$rc" != 0 ]; then
    [ -d "$dir" ] && echo "$(date -u +%FT%H:%M) AUTH_DEAD auth status failed" >> "$status"
    die "host/container authentication unavailable; see $status"
  fi
  # Worker clones may predate the profiler; the host copy is the trusted collector.
  t="$(now_s)"
  MSYS_NO_PATHCONV=1 docker cp "$(winpath "$MAIN_REPO/scripts/wave_profile.py")" "$cn:/tmp/dotask-wave-profile.py"
  meta_log "$id" profiler_copy "$t" 0
  ensure_excludes "$dir"

  t="$(now_s)"; rc=0
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec -u dev "$cn" bash -lc \
    'cd /workspace && exec python /tmp/dotask-wave-profile.py run --directory .dotask-profile --status-file .dotask-status --wave "$1" --tasks "$2" --phase "$3" --model "$4" --effort "$5" --reason "$6" --max-turns "$7" -- "${@:8}"' \
    _ "${DOTASK_WAVE_ID:-standalone-$(jsafe "$id")}" "${DOTASK_TASK_IDS:-$id}" "$phase" "$model" "$effort" "$reason" "${DOTASK_MAX_TURNS:-120}" "$@" \
    || rc=$?
  meta_log "$id" "dispatch_$phase" "$t" "$rc"
  archive_profiles "$id"
  return "$rc"
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
  # Self-heal the browser ONLY when missing, capped: re-running `playwright install`
  # re-validates over the network and can HANG in a network-restricted container
  # (same guard as dev-verify.sh step 3).
  MSYS_NO_PATHCONV=1 docker exec -u dev "$cn" bash -lc '
    b="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
    ls "$b"/chromium-* >/dev/null 2>&1 \
      || ( cd /workspace/src/frontend && timeout 120 npx playwright install chromium )
  ' >/dev/null 2>&1 || true
  echo "[task] running Playwright E2E (headless chromium) in $cn..." >&2
  # Pass through any extra args (e.g. --grep @smoke, a spec path).
  local t rc=0; t="$(now_s)"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec -u dev "$cn" \
    bash -lc 'cd /workspace/src/frontend && exec npx playwright test "$@"' _ "$@" || rc=$?
  meta_log "$id" e2e_test "$t" "$rc"
  return "$rc"
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
  archive_profiles "$id"
  local t; t="$(now_s)"
  down "$id"
  local dir; dir="$(taskdir "$id")"
  meta_log "$id" nuke "$t" 0
  [ -d "$dir" ] && rm -rf "$dir" && echo "[task] deleted checkout $dir" >&2 || true
}

# --- push the task's branch to GitHub so YOU can fetch + test + merge it --------
# Runs HOST-side git on the checkout dir (which lives on your disk), so it uses
# your existing GitHub credentials (Credential Manager / GitHub Desktop) -- the
# container has no push creds. A push sends only COMMITS, so the container's
# CRLF working-tree noise never goes up. Refuses master/main and shows the
# diffstat vs the checkout's master first (a huge list = the worker accidentally
# committed line-ending noise; abort and have it re-commit explicit paths).
push() {
  local id="$1"; shift || true; [ -n "$id" ] || die "usage: task push <id> [--force]"
  local force=""; [ "${1:-}" = "--force" ] && force=1
  local dir; dir="$(taskdir "$id")"
  [ -d "$dir/.git" ] || die "no checkout at $dir (run 'task up $id' first)"
  local branch; branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  [ "$branch" = "HEAD" ] && die "detached HEAD in $dir; the worker must be on a branch"
  case "$branch" in master|main) die "refusing to push '$branch' from a task sandbox";; esac
  local ahead files; ahead="$(git -C "$dir" rev-list --count master.."$branch" 2>/dev/null || echo '?')"
  files="$(git -C "$dir" diff --name-only master.."$branch" 2>/dev/null | wc -l | tr -d ' ')"
  echo "[task] $branch: $ahead commit(s), $files file(s) changed vs master. Diffstat:" >&2
  git -C "$dir" diff --stat master.."$branch" 2>/dev/null | tail -25 >&2

  # CRLF-noise guard: compare raw churn vs churn IGNORING cr-at-eol. A big gap means
  # line-ending flips got committed (e.g. GitHub-Desktop entanglement) that would
  # pollute master on merge. Refuse unless --force, and point at the offending files.
  local raw cri noise
  raw="$(git -C "$dir" diff --numstat master.."$branch" 2>/dev/null | awk '{a+=$1;d+=$2} END{print a+d+0}')"
  cri="$(git -C "$dir" diff --ignore-cr-at-eol --numstat master.."$branch" 2>/dev/null | awk '{a+=$1;d+=$2} END{print a+d+0}')"
  noise=$((raw - cri))
  if [ -z "$force" ] && [ "$noise" -gt 200 ] && [ "$raw" -gt $((cri * 2)) ]; then
    echo "[task] ABORT: ~$noise lines look like CRLF line-ending churn (raw=$raw vs real=$cri)." >&2
    echo "[task] Likely a line-ending flip (GitHub-Desktop entanglement). Biggest raw-vs-real files:" >&2
    git -C "$dir" diff --numstat master.."$branch" 2>/dev/null | awk '{print $1+$2, $3}' | sort -rn | head -5 | sed 's/^/      /' >&2
    echo "[task] Fix: normalize those to LF in the checkout (e.g. sed -i 's/\\r\$//' <file>), commit, retry." >&2
    echo "[task] Or override with: bash scripts/task.sh push $id --force" >&2
    die "CRLF-noise guard tripped"
  fi

  echo "[task] pushing $branch to origin (using your host GitHub creds)..." >&2
  local t; t="$(now_s)"
  git -C "$dir" push -u origin "$branch" || { meta_log "$id" push "$t" 1; die "push failed (is host git signed in to GitHub?)"; }
  meta_log "$id" push "$t" 0
  echo "[task] pushed. In GitHub Desktop: Fetch origin -> switch to '$branch' -> test -> PR/merge." >&2
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
  ""|-h|--help) sed -n '2,25p' "$0" ;;
  up)     up "$@" >/dev/null ;;
  drive)  drive "$@" ;;
  claude) claude_session "$@" ;;
  stack)  stack "$@" ;;
  test)   e2e_test "$@" ;;
  code)   code_session "$@" ;;
  push)   push "$@" ;;
  down)   down "$@" ;;
  nuke)   nuke "$@" ;;
  list)   list ;;
  *)      # bare id: up + claude (the common path)
          claude_session "$cmd" "$@" ;;
esac
