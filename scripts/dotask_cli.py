"""Supervisorless /dotask: one GROUP (one or more tasks) = one container, one
checkout, one branch, one PR. There is no model supervisor process -- a group
runs headless by default (HEADLESS_LOOP: one fresh `claude -p` per task, the
equivalent of /clear + resending the kickoff), or with --window the user talks
directly to the Claude session in the container (`task.sh code`). This module
does host-side bookkeeping and git/gh plumbing only; it never calls a model itself.

Commands (see scripts/dotask.sh, the thin bash entry point):
  python scripts/dotask_cli.py start [--window] [--capture] T1 [T2 ...]
  python scripts/dotask_cli.py stack <slug>              # app stack up + healthy, prints the URLs
  python scripts/dotask_cli.py land <slug>               # stack up for a human test; no push yet
  python scripts/dotask_cli.py land <slug> --after-test  # push, PR, CI, evidence (HEAD must be the tested one)
  python scripts/dotask_cli.py autoland <slug> [--no-land]  # verify -> fix -> verify, then push (headless runs this itself)
  python scripts/dotask_cli.py status
  python scripts/dotask_cli.py nextup [--limit N]          # TODO tasks bundled by shared code area
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import tempfile
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import dotask_evidence
import wave_profile

def host_path(value):
    """A Path the host OS understands. Git Bash spells C:\\work as /c/work; on Windows Python reads
    that as C:\\c\\work (a 2026-10-08 group was cloned there while task.sh used C:\\work)."""
    value = str(value)
    match = re.fullmatch(r"/([A-Za-z])(/.*)?", value)
    if os.name == "nt" and match:
        value = f"{match.group(1).upper()}:{match.group(2) or '/'}"
    return Path(value)


def bash_path(path):
    """Forward slashes for paths handed to bash: Git Bash reads C:\\x backslashes as escapes."""
    return Path(path).as_posix()


def write_lf(path, text):
    """Bytes with LF endings: Path.write_text emits CRLF on Windows (breaks `git diff --check`)."""
    Path(path).write_bytes(text.replace("\r\n", "\n").encode("utf-8"))


def save_group(checkout, group):
    write_lf(Path(checkout) / GROUP_FILE, json.dumps(group, indent=2) + "\n")


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_REPO = host_path(os.environ.get("MAIN_REPO") or REPO_ROOT)
TASKS_ROOT = host_path(os.environ.get("TASKS_ROOT") or "/c/work/tasks")
LANDING_ROOT = host_path(os.environ.get("DOTASK_LANDING_ROOT") or "/c/work/landing")
GROUP_FILE = ".dotask-group.json"
STOPWORDS = {"the", "a", "an", "to", "of", "for", "and", "on", "in", "is", "this", "that", "with"}
HEADLESS_INSTRUCTION = ("Implement /workspace/.dotask-kickoff.md: the next task without a commit line in "
                        "/workspace/.dotask-status, one commit, a status line after every stage; then stop.")
# One fresh `claude -p` (task.sh drive: one implementation dispatch, no QA chaining) per task, the
# kickoff's one-task-per-conversation protocol. Args: $1 max dispatches, $2 task.sh, $3 slug,
# $4 instruction, $5 status file, $6 space-separated task ids. Each dispatch must end on the next
# task's commit line (continue) or PUSHREADY (done); anything else (BLOCKED, DISPATCH_FAILED,
# ENDED_WITHOUT_STATUS, ...) stops with exit 1, and running out of dispatches without PUSHREADY is 3.
# The dispatch names its task: a worker left to derive it trusted a stale BLOCKED line instead (2026-11-07).
HEADLESS_LOOP = r'''
for i in $(seq 1 "$1"); do
  next=""
  for t in $6; do grep -q "STAGE_DONE $t commit" "$5" 2>/dev/null || { next="$t"; break; }; done
  [ -n "$next" ] || break
  DOTASK_TASK_IDS="$next" bash "$2" drive "$3" "$4 Your task is $next." || exit $?
  last="$(tail -n 1 "$5" 2>/dev/null)"
  case "$last" in
    *" PUSHREADY "*) exit 0 ;;
    *" STAGE_DONE $next commit"*) ;;
    *) echo "[dotask] headless stopped after $next: $last" >&2; exit 1 ;;
  esac
done
tail -n 1 "$5" 2>/dev/null | grep -q " PUSHREADY " && exit 0
echo "[dotask] headless stopped: no PUSHREADY after $1 dispatch(es)" >&2
exit 3
'''
# $7 python, $8 dotask_cli.py. The subshell keeps the loop's `exit` from skipping the verify stage.
HEADLESS_THEN_VERIFY = "(" + HEADLESS_LOOP + ') && "$7" "$8" autoland "$3"\n'


def die(message, code=2):
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def normalize_task(task):
    match = re.fullmatch(r"[Tt](\d+)", task.strip())
    if not match:
        die(f"{task!r} is not a task id (expected T<number>)")
    return "T" + match.group(1)


def sanitize(name):
    return re.sub(r"[^a-z0-9._-]", "-", name.lower())


def cname(slug):
    return f"reel-task-{sanitize(slug)}"


def container_running(slug):
    try:
        result = subprocess.run([tool("docker"), "inspect", "-f", "{{.State.Running}}", cname(slug)],
                                capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


# --- task file resolution -----------------------------------------------------
def resolve_task_file(task_id):
    matches = sorted(m for m in (MAIN_REPO / "docs" / "plans" / "tasks").rglob(f"{task_id}-*.md")
                     if not m.name.endswith("-design.md"))
    if not matches:
        die(f"no task file matches {task_id}-*.md under docs/plans/tasks")
    if len(matches) > 1:
        die(f"{task_id} matches multiple task files: {', '.join(str(m) for m in matches)}")
    return matches[0]


def task_status(path):
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        match = re.match(r"\*\*Status:\*\*\s*(.+)", line.strip())
        if match:
            return match.group(1).strip()
    return None


def task_title(path):
    first_line = Path(path).read_text(encoding="utf-8").splitlines()[0]
    return re.sub(r"^#\s*T\d+:\s*", "", first_line).strip()


def relevant_files(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    files, in_section = [], False
    for line in lines:
        if re.match(r"^###\s*Relevant Files", line):
            in_section = True
            continue
        if in_section and line.startswith("###"):
            break
        if in_section:
            files += [m.group(1).split()[0] for m in re.finditer(r"`([^`]+)`", line)]
    return files


def merged_commits(task_id):
    # Docs-only commits (filing, status, rulings under docs/plans) are bookkeeping, not work done, and
    # so are agent and knowledge docs under .claude, which a filing commit may touch beside them.
    # Merges are skipped: a PR body quotes its commit subjects and its diff carries every branch commit,
    # so a filing PR's merge looks like work. The branch's own commits are still checked one by one.
    # --grep also matches body lines, and a wrapped list of task ids can open one (5c669996f), so the
    # subject decides: only a subject that starts with the id is that task's work.
    result = subprocess.run([tool("git"), "-C", str(MAIN_REPO), "log", "origin/master", "--no-merges", "--grep",
                             f"^{task_id}[: ]", "--format=%h %s", "--", ".", ":(exclude)docs/plans", ":(exclude).claude"],
                            capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        return []
    subject = re.compile(rf"\S+ {task_id}[: ]")
    return [line for line in result.stdout.splitlines() if subject.match(line)]


def live_groups():
    groups = []
    for group_path in sorted(TASKS_ROOT.glob(f"*/{GROUP_FILE}")):
        try:
            group = json.loads(group_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if container_running(group.get("slug", "")):
            groups.append(group)
    return groups


def short_words(title, limit=4):
    words = [w for w in re.findall(r"[A-Za-z0-9]+", title.lower()) if w not in STOPWORDS]
    return "-".join(words[:limit]) or "task"


def tool(name):
    """Resolve an executable through PATH (honours PATHEXT on Windows) so PATH order decides, not System32."""
    found = shutil.which(name)
    if not found:
        raise SystemExit(f"{name} not found on PATH")
    return found


def bash():
    """Git Bash from PATH. A bare "bash" on Windows resolves System32\bash.exe (WSL) first."""
    found = shutil.which("bash")
    if not found:
        raise SystemExit("bash not found on PATH (run /dotask from Git Bash)")
    return found


def task_sh(*args, check=True, capture_output=False):
    # Paths handed to bash use forward slashes: Git Bash on Windows reads 'C:\x' backslashes as escapes.
    env = {**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT)}
    return subprocess.run([bash(), (REPO_ROOT / "scripts" / "task.sh").as_posix(), *args],
                          env=env, check=check, text=True, capture_output=capture_output)


# --- start ---------------------------------------------------------------------
def preflight(task_ids, allow_overlap=False):
    files_by_task = {}
    for task_id in task_ids:
        path = resolve_task_file(task_id)
        status = task_status(path)
        if status not in ("TODO", "WIP"):
            die(f"{task_id} has PLAN.md status {status!r}, not TODO/WIP")
        commits = merged_commits(task_id)
        if commits:
            die(f"{task_id} already has commits on origin/master: {commits[0]}")
        files_by_task[task_id] = relevant_files(path)
    owned = sorted({f for files in files_by_task.values() for f in files})
    conflicts = {}  # task -> ["file (live group slug)"]
    for group in live_groups():
        taken = set(group.get("owned_files", []))
        for task_id, files in files_by_task.items():
            for name in sorted(set(files) & taken):
                conflicts.setdefault(task_id, []).append(f"{name} (live group {group.get('slug')})")
    shared = {}  # file -> slug of the live group that also owns it
    for group in live_groups():
        for name in set(owned) & set(group.get("owned_files", [])):
            shared[name] = group.get("slug")
    if conflicts:
        lines = [f"  {task_id}: {', '.join(items)}" for task_id, items in conflicts.items()]
        if allow_overlap:
            print("WARNING: --allow-overlap: these files are also owned by a live group; the worker "
                  "rebases on master before finishing:\n" + "\n".join(lines), file=sys.stderr)
            return files_by_task, owned, shared
        clear = [t for t in task_ids if t not in conflicts]
        hint = (f"Start the non-overlapping tasks now: /dotask {' '.join(clear)}" if clear
                else "Every task overlaps; land or stop the live group first.")
        hint += "\nOr start them all and resolve at rebase time: add --allow-overlap."
        die("files overlap a live group (no same-file concurrency):\n" + "\n".join(lines) + "\n" + hint)
    return files_by_task, owned, shared


def render_kickoff(task_ids, files_by_task, branch, group):
    template = (REPO_ROOT / "scripts" / "dotask_kickoff_template.md").read_text(encoding="utf-8")
    task_lines = []
    for task_id in task_ids:
        path = resolve_task_file(task_id)
        owned = ", ".join(files_by_task[task_id]) or "(none listed)"
        task_lines.append(f"- {task_id}: {task_title(path)} -- `{path.relative_to(MAIN_REPO).as_posix()}`\n"
                          f"  Owned files: {owned}")
    capture_line = "yes (land will capture reviewer + proof-verifier and run the gate)" if group.get("capture") \
        else "no (default: `/dotask land` hands the PR + evidence to the user)"
    substitutions = {
        "__SLUG__": group["slug"], "__BRANCH__": branch, "__WAVE_ID__": group["wave_id"],
        "__TASK_LIST__": "\n".join(task_lines), "__CAPTURE__": capture_line, "__TASK_COUNT__": str(len(task_ids)),
    }
    for token, value in substitutions.items():
        template = template.replace(token, value)
    return template


def flip_plan_status(task_ids):
    plan_path = MAIN_REPO / "docs" / "plans" / "PLAN.md"
    lines = plan_path.read_text(encoding="utf-8").splitlines(keepends=True)
    for i, line in enumerate(lines):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 6 and cells[0] in task_ids:
            cells[5] = "WIP"
            lines[i] = "| " + " | ".join(cells) + " |\n"
    plan_path.write_text("".join(lines), encoding="utf-8")
    for task_id in task_ids:
        path = resolve_task_file(task_id)
        content = re.sub(r"\*\*Status:\*\*\s*\S.*", "**Status:** WIP", path.read_text(encoding="utf-8"), count=1)
        path.write_text(content, encoding="utf-8")


def shared_files_section(shared):
    """Kickoff rules when --allow-overlap let this group share files with another live group."""
    if not shared:
        return ""
    files = "\n".join(f"- `{name}` (also owned by live group `{slug}`)" for name, slug in sorted(shared.items()))
    return ("\n\n## Shared files (started with --allow-overlap)\n\n" + files + "\n\n"
            "Another group may land changes to these files first. Keep your edits to them minimal and local. "
            "Before your final PUSHREADY: `git fetch origin && git rebase origin/master`. Resolve any conflict "
            "so BOTH groups' intent survives (never drop the other group's change), re-run your relevant "
            "tests, and say in the PUSHREADY line whether the rebase was clean or what you resolved.\n")


def start(args):
    task_ids = [normalize_task(t) for t in args.tasks]
    if len(set(task_ids)) != len(task_ids):
        die("duplicate task ids in one group")
    files_by_task, owned, shared = preflight(task_ids, args.allow_overlap)

    slug = f"g-{task_ids[0].lower()}-{len(task_ids)}"
    first_title = task_title(resolve_task_file(task_ids[0]))
    branch = f"feature/{'-'.join(task_ids)}-{short_words(first_title)}"
    wave_id = f"{slug}-{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M}"  # time-unique: a re-start after nuke must not collide

    print(f"[dotask] bringing up container for {slug}...")
    task_sh("up", slug)

    checkout = TASKS_ROOT / sanitize(slug)
    group = {"slug": slug, "tasks": task_ids, "branch": branch, "owned_files": owned,
             "wave_id": wave_id, "capture": bool(args.capture), "headless": bool(args.headless),
             "shared_files": shared,
             "created_at": wave_profile.now_iso()}
    save_group(checkout, group)
    exclude_path = checkout / ".git" / "info" / "exclude"
    exclude_path.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude_path.read_text(encoding="utf-8") if exclude_path.exists() else ""
    if GROUP_FILE not in existing:
        with exclude_path.open("a", encoding="utf-8") as stream:
            stream.write(GROUP_FILE + "\n")

    wave_env = {**os.environ, "DOTASK_TASKS_ROOT": str(TASKS_ROOT)}
    task_flags = [flag for task_id in task_ids for flag in ("--task", task_id)]
    subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "wave_profile.py"), "init", "--wave", wave_id,
                   *task_flags, "--plan", str(MAIN_REPO / "docs" / "plans" / "PLAN.md"),
                   "--mode", "headless" if args.headless else "window"],
                  env=wave_env, check=True)

    kickoff_path = checkout / ".dotask-kickoff.md"
    kickoff = render_kickoff(task_ids, files_by_task, branch, group) + shared_files_section(shared)
    write_lf(kickoff_path, kickoff)

    flip_plan_status(task_ids)

    if args.headless:
        log_path = TASKS_ROOT / "profiles" / sanitize(slug) / "run.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as log:
            subprocess.Popen([bash(), "-c", HEADLESS_THEN_VERIFY, "dotask-headless", str(len(task_ids)),
                              (REPO_ROOT / "scripts" / "task.sh").as_posix(), slug, HEADLESS_INSTRUCTION,
                              bash_path(checkout / ".dotask-status"), " ".join(task_ids),
                              Path(sys.executable).as_posix(), Path(__file__).resolve().as_posix()],
                             env={**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT),
                                  "DOTASK_WAVE_ID": wave_id, "DOTASK_PHASE": "implementation"},
                             stdout=log, stderr=subprocess.STDOUT)
        print(f"slug: {slug}")
        print(f"branch: {branch}")
        print(f"headless log: {log_path}")
    else:
        task_sh("code", slug, "--prompt-file", kickoff_path.as_posix())
        print(f"slug: {slug}")
        print(f"branch: {branch}")
        print(f"window: VS Code attached to {cname(slug)} -- its Claude panel opens with "
             "`Implement /workspace/.dotask-kickoff.md` prefilled (~1 min on a first attach): press Enter. "
             "One task per conversation: /clear + resend between tasks.")
    return 0


# --- land ----------------------------------------------------------------------
def render_pr_body(group):
    criteria_note = ", ".join(f"{t}:C1.." for t in group["tasks"])
    return "\n".join([f"Tasks: {', '.join(group['tasks'])}", "",
                      f"Criteria are namespaced per task ({criteria_note}).",
                      f"Evidence: {LANDING_ROOT / 'evidence' / group['slug']}"])


def wait_for_ci(branch, head, interval=30, cap_minutes=30):
    deadline = time.time() + cap_minutes * 60
    while True:
        result = subprocess.run([tool("gh"), "run", "list", "--workflow", "Branch CI", "--branch", branch,
                                 "--limit", "20", "--json", "databaseId,headSha,status,conclusion"],
                                capture_output=True, text=True, check=True)
        runs = [r for r in json.loads(result.stdout or "[]") if r.get("headSha") == head]
        if runs and runs[0].get("status") == "completed":
            return runs[0].get("conclusion") or "unknown"
        if time.time() > deadline:
            return "timed_out"
        time.sleep(interval)


def ingest_transcripts(slug, group):
    dest_root = TASKS_ROOT / "profiles" / sanitize(slug) / "transcripts"
    dest_root.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([tool("docker"), "cp", f"{cname(slug)}:/home/dev/.claude/projects/-workspace",
                             str(dest_root)], capture_output=True, text=True, check=False)
    copied = dest_root / "-workspace"
    if result.returncode != 0 or not copied.is_dir():
        print("transcripts: none found")
        return
    env = {**os.environ, "DOTASK_TASKS_ROOT": str(TASKS_ROOT)}
    out_dir = TASKS_ROOT / "waves" / group["wave_id"] / "profiles"
    tasks_csv = ",".join(group["tasks"])
    for session in sorted(copied.glob("*.jsonl")):
        subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "wave_profile.py"), "ingest",
                       "--directory", str(out_dir), "--identity", f"worker-{session.stem}", "--wave",
                       group["wave_id"], "--tasks", tasks_csv, "--role", "worker", "--phase", "implementation",
                       "--transcript", str(session)], env=env, check=False)
    for agent in sorted(copied.glob("*/subagents/agent-*.jsonl")):
        meta_path = agent.with_suffix(".meta.json")
        role = "unknown-agent"
        if meta_path.is_file():
            try:
                role = json.loads(meta_path.read_text(encoding="utf-8")).get("agentType", role)
            except (OSError, ValueError):
                pass
        identity = f"worker-{agent.parent.parent.stem}-{agent.stem}"
        subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "wave_profile.py"), "ingest",
                       "--directory", str(out_dir), "--identity", identity, "--wave", group["wave_id"],
                       "--tasks", tasks_csv, "--role", role, "--phase", "implementation",
                       "--transcript", str(agent)], env=env, check=False)
    print(f"transcripts: ingested from {copied}")


def maybe_capture_and_gate(group, checkout, evidence_path):
    """Only called when the group was started with --capture (D4)."""
    controller = LANDING_ROOT / "controller"
    store = LANDING_ROOT / "receipts"
    common = ["--checkout", str(checkout), "--evidence", str(evidence_path), "--store", str(store)]
    gate = str(REPO_ROOT / "scripts" / "landing_gate.py")
    subprocess.run([sys.executable, gate, "capture", "--role", "reviewer", *common], check=True, cwd=str(controller))
    subprocess.run([sys.executable, gate, "capture", "--role", "proof-verifier", *common], check=True, cwd=str(controller))
    subprocess.run([sys.executable, gate, "check", *common], check=True, cwd=str(controller))
    result = subprocess.run([sys.executable, gate, "land", *common], capture_output=True, text=True,
                            cwd=str(controller), check=False)
    return result.stdout.strip() or ("landed" if result.returncode == 0 else "blocked")


def task_env(checkout):
    """The offset ports task.sh's alloc_offset wrote into <checkout>/.task-env."""
    values = {}
    for line in (Path(checkout) / ".task-env").read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep:
            values[key] = value
    return values


DEV_ACCOUNT_PRESETS = ("empty", "upload", "full")


def bring_up_stack(slug):
    """Start the group's app stack and return its frontend URL only once frontend + /api/health answer.
    task.sh owns the start + wait (shared with `task.sh test`); a timeout raises CalledProcessError."""
    task_sh("stack", slug, "--wait")
    ports = task_env(TASKS_ROOT / sanitize(slug))
    frontend = f"http://localhost:{ports['FRONTEND_PORT']}"
    print(f"stack ready: {frontend}")
    for preset in DEV_ACCOUNT_PRESETS:
        print(f"  dev account ({preset}): {frontend}/?dev_account={preset}")
    print(f"backend health: http://localhost:{ports['BACKEND_PORT']}/api/health")
    return frontend


def stack(args):
    bring_up_stack(args.slug)
    return 0


def git_head(checkout):
    return subprocess.run([tool("git"), "-C", str(checkout), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()


def mark_committed_tasks_completed(checkout, group):
    """Window groups never report task status, so the wave read 0 completed points (2026-10-08):
    every task with a `T<id>:` commit on the branch is completed work."""
    env = {**os.environ, "DOTASK_TASKS_ROOT": str(TASKS_ROOT)}
    for task_id in group["tasks"]:
        found = subprocess.run([tool("git"), "-C", str(checkout), "log", "--oneline", "origin/master..HEAD",
                                "--grep", f"^{task_id}[: ]"], capture_output=True, text=True, check=False).stdout
        if found.strip():
            subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "wave_profile.py"), "task", "--wave",
                            group["wave_id"], "--id", task_id, "--status", "completed"], env=env, check=False)


def run_preland_check(checkout):
    return subprocess.run([bash(), (REPO_ROOT / "scripts" / "dotask_preland_check.sh").as_posix(), bash_path(checkout)],
                          capture_output=True, text=True, check=False)


def land(args):
    slug = args.slug
    checkout = TASKS_ROOT / sanitize(slug)
    group_path = checkout / GROUP_FILE
    if not group_path.is_file():
        die(f"no group file at {group_path}; is {slug} a live /dotask group?")
    group = json.loads(group_path.read_text(encoding="utf-8"))
    branch = group["branch"]

    if not args.after_test:
        # Step 1: a human tests the running app before anything is pushed or a PR exists.
        check = run_preland_check(checkout)
        if check.returncode:
            die(f"pre-land hygiene check failed (fix, commit, re-run `/dotask land {slug}`):\n{check.stdout}{check.stderr}")
        frontend = bring_up_stack(slug)
        group["tested_head"] = git_head(checkout)
        save_group(checkout, group)
        print(f"WAITING ON USER: test {frontend} (HEAD {group['tested_head'][:9]}). When it works, run: "
              f"/dotask land {slug} --after-test")
        return 0

    head = git_head(checkout)
    tested = group.get("tested_head")
    if not tested:
        die(f"{slug} has no human-tested stack yet; run `/dotask land {slug}` first, test the app, then --after-test")
    if head != tested:
        die(f"HEAD changed since the test stack ({tested[:9]} -> {head[:9]}); re-run `/dotask land {slug}` "
            "to restart the stack on the new HEAD and test again")

    print(f"[dotask] pushing {branch}...")
    task_sh("push", slug)

    title = ", ".join(group["tasks"]) + ": " + task_title(resolve_task_file(group["tasks"][0]))
    # A file, not an argument (newlines survive Windows shims), outside the checkout (which must stay clean).
    with tempfile.TemporaryDirectory(prefix="dotask-pr-") as scratch:
        body_file = Path(scratch) / "body.md"
        body_file.write_text(render_pr_body(group), encoding="utf-8")
        pr_result = subprocess.run([tool("gh"), "pr", "create", "--title", title, "--body-file", str(body_file),
                                    "--head", branch, "--base", "master"], cwd=str(checkout),
                                   capture_output=True, text=True)
    if pr_result.returncode == 0:
        pr_url = pr_result.stdout.strip().splitlines()[-1]
        print(f"PR: {pr_url}")
    else:
        # A re-run of --after-test after a fix push (CI was red, HEAD moved, step 1 again):
        # the PR for this head branch already exists, and `gh pr create` refuses. Reuse it
        # instead of dying here, which skipped the CI verdict, evidence, notes and profile
        # steps (T13280 landing, 2026-10-22).
        existing = subprocess.run([tool("gh"), "pr", "view", branch, "--json", "url", "-q", ".url"],
                                  cwd=str(checkout), capture_output=True, text=True)
        pr_url = existing.stdout.strip().splitlines()[-1] if existing.stdout.strip() else ""
        if existing.returncode != 0 or not pr_url:
            die(f"gh pr create failed and no open PR found for {branch}: {pr_result.stderr.strip()[:400]}")
        print(f"PR: {pr_url} (existing)")
    pr_number = int(pr_url.rstrip("/").rsplit("/", 1)[-1])

    verdict = wait_for_ci(branch, head)
    print(f"CI verdict: {verdict}")

    evidence_dir = LANDING_ROOT / "evidence" / slug
    evidence_path = evidence_dir / "evidence.json"
    try:
        dotask_evidence.write_evidence(checkout, pr_number, evidence_dir, group["tasks"])
        print(f"evidence: {evidence_path}")
    except ValueError as exc:
        print(f"evidence: skipped ({exc})")

    notes = checkout / ".dotask-notes.md"
    if notes.is_file():  # gitignored, so nuke would lose the group's learnings
        archived = TASKS_ROOT / "waves" / group["wave_id"] / "notes.md"
        archived.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(notes, archived)
        print(f"notes: {archived}")

    ingest_transcripts(slug, group)
    mark_committed_tasks_completed(checkout, group)

    env = {**os.environ, "DOTASK_TASKS_ROOT": str(TASKS_ROOT)}
    subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "wave_profile.py"), "report",
                   "--wave", group["wave_id"]], env=env, check=False)
    profile_path = TASKS_ROOT / "waves" / group["wave_id"] / "profile.json"
    print(f"profile: {profile_path}")

    if group.get("capture"):
        print(f"gate: {maybe_capture_and_gate(group, checkout, evidence_path)}")
    else:
        print(f"WAITING ON USER: PR {pr_url} is {verdict}; evidence at {evidence_dir}. "
             "Capture + merge it yourself, or re-run `/dotask land` on a group started with --capture.")
    return 0


# --- autoland: verify -> fix -> verify, then push -----------------------------------
# After PUSHREADY a fresh verifier drives the running app against every acceptance criterion and
# the flows the diff touches. Failures go back to a fresh worker, and the result is verified from
# scratch. Only a clean verdict on the exact HEAD pushes (user decision, 2026-11-07); merging stays
# with the user. Any verdict that cannot be trusted stops the loop: it never counts as a pass.
VERIFY_FILE = ".dotask-verify.json"
MAX_FIX_ROUNDS = 3  # a flaky test or an unfixable bug must not burn usage forever
VERIFY_STATUSES = ("pass", "fail", "human")
BUG_SCOPES = ("group", "unrelated")
ACCEPTANCE_ITEM = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]")
BUG_SECTION = "### Bugs found by /dotask verify"
PLAN_TAIL_HEADING = "## Environment Configuration"
VERIFY_INSTRUCTION = """You are the independent verifier for this group, verify round {round}. You did not write this code.
Do not trust the worker's claims, qa/proof.json or .dotask-notes.md conclusions: observe behavior yourself.
Do NOT edit tracked files, commit, or change qa/proof.json. Keep every script you write under /tmp. HEAD is {head}.

The app stack was just restarted on this code: http://localhost:5173, backend :8000, dev accounts ?dev_account=empty|upload|full.

1. For EACH task ({tasks}), read the `## Acceptance Criteria` of its file under docs/plans/tasks and give EVERY criterion one entry, in order, named T<id>:C1, T<id>:C2, ...
2. Prove each criterion by observation. Use Playwright for anything a user can see (require('/workspace/src/frontend/node_modules/@playwright/test'), scripts under /tmp, chromium headless). Use the real API or the task's targeted tests only for what no user can see.
3. Read each criterion literally. Code that meets the intent but not the text is a `fail`, with that said in the evidence.
4. src/landing changes: this stack does not serve the landing site. Run `npm run build` in src/landing (`npm ci` first if node_modules is missing), then serve dist from a small node script under /tmp, mapping /x to x.html.
5. Regression pass: from `git diff origin/master...HEAD --stat`, exercise the flows this branch touches and look for anything broken that no criterion names.
6. Before believing a surprising result, confirm the served code is the code on disk. Pass an explicit long Bash timeout for builds, installs and e2e runs. Stop investigating a finding once you can state its steps; fixing is not your job.

Write /workspace/.dotask-verify.json, exactly:
{{"head": "{head}",
  "criteria": [{{"id": "T1:C1", "status": "pass|fail|human", "evidence": "what you observed"}}],
  "bugs": [{{"scope": "group|unrelated", "task": "T1", "title": "...", "steps": "...", "expected": "...", "actual": "..."}}]}}
`human` is only for what no automation can observe (a real card payment, a physical phone). Never use it to save effort.
A bug's scope is `group` if this branch caused it and `unrelated` if master has it too: check before deciding.
Then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} {head} verify round {round}` to /workspace/.dotask-status and stop. If you cannot run the checks at all, append `BLOCKED <reason>` instead."""
FIX_INSTRUCTION = """Independent verification of {head} found problems, listed in /workspace/.dotask-verify.json: every criterion with status `fail` and every bug with scope `group`. Ignore everything else in that file. All tasks already have commits, so do not start a new one.
Fix each finding at its root, failing test first, and run the relevant tests and lint. Commit with explicit paths, one commit per owning task, subject `T<id>: fix <what>`, ending with the Co-Authored-By line from the kickoff. Append what a later fix round needs to .dotask-notes.md.
A finding you believe is wrong: do not work around it. Append `BLOCKED <finding and why>` and stop.
Otherwise run `bash scripts/dotask_preland_check.sh`, then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} <new sha> fix round {round}` to /workspace/.dotask-status and stop."""


class UntrustedVerdict(Exception):
    pass


def acceptance_count(task_file):
    """Checkbox items in a task file's Acceptance Criteria: the floor a verdict must cover."""
    count, inside = 0, False
    for line in Path(task_file).read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside = line.lower().startswith("## acceptance")
        elif inside and ACCEPTANCE_ITEM.match(line):
            count += 1
    return count


def read_verdict(checkout, group, head):
    path = Path(checkout) / VERIFY_FILE
    try:
        verdict = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UntrustedVerdict(f"no readable {VERIFY_FILE}: {exc}") from exc
    if not isinstance(verdict, dict) or verdict.get("head") != head:
        raise UntrustedVerdict(f"verdict is not for HEAD {head[:9]}")
    criteria, bugs = verdict.get("criteria"), verdict.get("bugs")
    if not isinstance(criteria, list) or not isinstance(bugs, list):
        raise UntrustedVerdict("verdict needs `criteria` and `bugs` lists")
    for item in criteria:
        if item.get("status") not in VERIFY_STATUSES:
            raise UntrustedVerdict(f"{item.get('id')}: unknown status {item.get('status')!r}")
    for bug in bugs:
        if bug.get("scope") not in BUG_SCOPES or not bug.get("title"):
            raise UntrustedVerdict(f"bug needs a title and a scope of {BUG_SCOPES}: {bug}")
    for task_id in group["tasks"]:
        need = max(1, acceptance_count(resolve_task_file(task_id)))
        have = sum(1 for item in criteria if str(item.get("id", "")).startswith(f"{task_id}:"))
        if have < need:
            raise UntrustedVerdict(f"{task_id}: verdict covers {have} of {need} criteria")
    return verdict


def tracked_changes(checkout):
    return subprocess.run([tool("git"), "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"],
                          capture_output=True, text=True, check=True).stdout.strip()


def last_status(checkout):
    path = Path(checkout) / ".dotask-status"
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
    return lines[-1] if lines else ""


def append_status(checkout, text):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
    with (Path(checkout) / ".dotask-status").open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(f"{stamp} {text}\n")
    print(f"[dotask] {text}")


def dispatch(slug, group, phase, instruction):
    """One fresh `claude -p` in the group's container. True only if it ended on PUSHREADY."""
    env = {**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT),
           "DOTASK_WAVE_ID": group["wave_id"], "DOTASK_PHASE": phase, "DOTASK_TASK_IDS": ",".join(group["tasks"])}
    result = subprocess.run([bash(), (REPO_ROOT / "scripts" / "task.sh").as_posix(), "drive", slug, instruction],
                            env=env, check=False)
    return result.returncode == 0 and " PUSHREADY " in last_status(TASKS_ROOT / sanitize(slug))


def file_unrelated_bug(bug, group, head):
    """A bug this branch did not cause must not hold its PR up: file it as a TODO task instead.
    Returns the new id, or None if PLAN.md already names that title."""
    plan_path = MAIN_REPO / "docs" / "plans" / "PLAN.md"
    plan = plan_path.read_bytes().decode("utf-8")
    title = " ".join(str(bug["title"]).replace("|", "/").split())
    if f"[{title}](" in plan:
        return None
    tasks_dir = MAIN_REPO / "docs" / "plans" / "tasks"
    used = [int(found.group(1)) for found in (re.match(r"T(\d+)", p.name) for p in tasks_dir.rglob("T*.md")) if found]
    task_id = f"T{(max(used, default=0) // 10 + 1) * 10}"
    name = f"{task_id}-{'-'.join(re.findall(r'[a-z0-9]+', title.lower())[:6])}.md"
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    write_lf(tasks_dir / name, (
        f"# {task_id}: {title}\n\n**Status:** TODO\n**Impact:** 5\n**Complexity:** 3\n**Created:** {today}\n"
        f"**Updated:** {today}\n\n## Problem\n\nFound by the /dotask verifier on group {group['slug']} at {head[:9]}, "
        f"which judged it unrelated to that branch. Impact and complexity are unscored defaults.\n\n"
        f"**Steps:** {bug.get('steps', 'not recorded')}\n\n**Expected:** {bug.get('expected', 'not recorded')}\n\n"
        f"**Actual:** {bug.get('actual', 'not recorded')}\n\n## Acceptance Criteria\n\n- [ ] The steps above give the "
        f"expected result.\n\n## Context\n\n### Relevant Files (REQUIRED)\n\n- To be found.\n"))

    newline = "\r\n" if "\r\n" in plan else "\n"
    row = f"| {task_id} | [{title}](tasks/{name}) | 5 | 3 | 1.7 | TODO | [ ] | Filed by /dotask verify. |"
    lines = plan.replace("\r\n", "\n").split("\n")
    if BUG_SECTION in lines:
        at = lines.index(BUG_SECTION) + 1
        while at < len(lines) and (not lines[at].strip() or lines[at].startswith("|")):
            at += 1
        while not lines[at - 1].strip():
            at -= 1
        lines[at:at] = [row]
    else:
        at = lines.index(PLAN_TAIL_HEADING) if PLAN_TAIL_HEADING in lines else len(lines)
        lines[at:at] = [BUG_SECTION, "", "| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |",
                        "|---|---|---|---|---|---|---|---|", row, ""]
    plan_path.write_bytes(newline.join(lines).encode("utf-8"))
    return task_id


def verify_once(slug, group, checkout, head, round_number):
    """Stack up on HEAD, one fresh verifier. Returns its verdict; raises UntrustedVerdict if it cannot be used."""
    try:
        bring_up_stack(slug)
    except subprocess.CalledProcessError as exc:
        raise UntrustedVerdict(f"stack did not start (exit {exc.returncode})") from exc
    (checkout / VERIFY_FILE).unlink(missing_ok=True)
    finished = dispatch(slug, group, "qa", VERIFY_INSTRUCTION.format(
        round=round_number, head=head, tasks=", ".join(group["tasks"]), branch=group["branch"]))
    if not finished:
        raise UntrustedVerdict(f"verifier did not finish: {last_status(checkout)[:200]}")
    changed = tracked_changes(checkout)
    if git_head(checkout) != head or changed:
        raise UntrustedVerdict(f"verifier changed the tree: {git_head(checkout)[:9]} {changed[:200]}")
    verdict = read_verdict(checkout, group, head)
    archive = TASKS_ROOT / "waves" / group["wave_id"] / f"verify-round-{round_number}.json"
    archive.parent.mkdir(parents=True, exist_ok=True)
    archive.write_text(json.dumps(verdict, indent=2) + "\n", encoding="utf-8")
    return verdict


def autoland(args):
    slug = args.slug
    checkout = TASKS_ROOT / sanitize(slug)
    group_path = checkout / GROUP_FILE
    if not group_path.is_file():
        die(f"no group file at {group_path}; is {slug} a live /dotask group?")
    group = json.loads(group_path.read_text(encoding="utf-8"))
    status_path = checkout / ".dotask-status"
    status_text = status_path.read_text(encoding="utf-8") if status_path.is_file() else ""
    unfinished = [t for t in group["tasks"] if f"STAGE_DONE {t} commit" not in status_text]
    if unfinished:
        die(f"{slug} still has tasks without a commit line: {' '.join(unfinished)}")
    exclude_path = checkout / ".git" / "info" / "exclude"
    exclude_path.parent.mkdir(parents=True, exist_ok=True)
    if VERIFY_FILE not in (exclude_path.read_text(encoding="utf-8") if exclude_path.exists() else ""):
        with exclude_path.open("a", encoding="utf-8") as stream:
            stream.write(VERIFY_FILE + "\n")

    for fix_round in range(MAX_FIX_ROUNDS + 1):
        round_number = fix_round + 1
        head = git_head(checkout)
        check = run_preland_check(checkout)
        if check.returncode:  # hygiene is the worker's to fix; a browser pass on it would be wasted
            summary = f"pre-land check failed on {head[:9]}"
            write_lf(checkout / VERIFY_FILE, json.dumps({"head": head, "criteria": [], "bugs": [
                {"scope": "group", "title": "pre-land check failed", "actual": check.stdout + check.stderr}]}, indent=2) + "\n")
        else:
            try:
                verdict = verify_once(slug, group, checkout, head, round_number)
            except UntrustedVerdict as exc:
                append_status(checkout, f"VERIFY_BLOCKED round {round_number}: {exc}")
                return 1
            for bug in verdict["bugs"]:
                if bug["scope"] == "unrelated":
                    filed = file_unrelated_bug(bug, group, head)
                    print(f"[dotask] unrelated bug {bug['title']!r}: {filed or 'already filed'}")
            failed = [c.get("id") for c in verdict["criteria"] if c["status"] == "fail"]
            bugs = [b["title"] for b in verdict["bugs"] if b["scope"] == "group"]
            human = [c.get("id") for c in verdict["criteria"] if c["status"] == "human"]
            if not failed and not bugs:
                group["tested_head"] = head
                save_group(checkout, group)
                if human:
                    append_status(checkout, f"VERIFY_NEEDS_USER {head[:9]}: check {' '.join(human)}, "
                                            f"then run /dotask land {slug} --after-test")
                    return 0
                append_status(checkout, f"VERIFY_PASS {head[:9]} round {round_number}")
                return 0 if args.no_land else land(SimpleNamespace(slug=slug, after_test=True))
            summary = f"round {round_number} on {head[:9]}: failed {failed}, new bugs {bugs}"
        if fix_round == MAX_FIX_ROUNDS:
            append_status(checkout, f"VERIFY_EXHAUSTED after {MAX_FIX_ROUNDS} fix rounds; {summary}")
            return 1
        print(f"[dotask] {summary}; sending it back to a worker")
        if not dispatch(slug, group, "implementation", FIX_INSTRUCTION.format(
                head=head, branch=group["branch"], round=round_number)):
            append_status(checkout, f"VERIFY_BLOCKED fix round {round_number} did not finish: {last_status(checkout)[:200]}")
            return 1
        if git_head(checkout) == head:
            append_status(checkout, f"VERIFY_BLOCKED fix round {round_number} committed nothing")
            return 1
    return 1


# --- nextup ----------------------------------------------------------------------
# One group's tasks share a container and a notes file, so a bundle whose tasks touch the same
# code lets each fresh conversation start from what the previous task learned (2026-10-09).
def plan_todo_tasks():
    """TODO task ids in PLAN.md row order (PLAN order is priority order)."""
    ids = []
    for line in (MAIN_REPO / "docs" / "plans" / "PLAN.md").read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 6 and re.fullmatch(r"T\d+", cells[0]) and cells[5] == "TODO" and cells[0] not in ids:
            ids.append(cells[0])
    return ids


def nextup_candidates():
    """(candidates in PLAN order, {task: ["file (live group slug)"]} held back, [unresolvable notes])."""
    tasks_dir = MAIN_REPO / "docs" / "plans" / "tasks"
    groups = live_groups()
    candidates, held, skipped = [], {}, []
    for task_id in plan_todo_tasks():
        matches = sorted(tasks_dir.rglob(f"{task_id}-*.md"))
        if len(matches) != 1:
            skipped.append(f"{task_id}: {len(matches)} task files match {task_id}-*.md")
            continue
        path = matches[0]
        files = [f for f in relevant_files(path) if "/" in f]  # prose in backticks is not a file
        taken = [f"{name} (live group {g.get('slug')})"
                 for g in groups for name in sorted(set(files) & set(g.get("owned_files", [])))]
        if taken:
            held[task_id] = taken
            continue
        epic = path.parent.relative_to(tasks_dir).as_posix() if path.parent != tasks_dir else None
        candidates.append({"id": task_id, "title": task_title(path), "path": path.relative_to(MAIN_REPO).as_posix(),
                           "files": files, "epic": epic})
    return candidates, held, skipped


def nextup_bundles():
    """TODO tasks joined when they share a Relevant File or an epic folder (transitively). Tasks keep
    PLAN order inside a bundle; bundles rank by their first task's PLAN position."""
    candidates, _held, _skipped = nextup_candidates()
    root = list(range(len(candidates)))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i

    for i, a in enumerate(candidates):
        for j in range(i + 1, len(candidates)):
            b = candidates[j]
            if (a["epic"] and a["epic"] == b["epic"]) or set(a["files"]) & set(b["files"]):
                root[find(j)] = find(i)
    members = {}
    for i in range(len(candidates)):
        members.setdefault(find(i), []).append(candidates[i])
    bundles = []
    for rows in sorted(members.values(), key=lambda rs: candidates.index(rs[0])):
        owners = {}
        for row in rows:
            for name in row["files"]:
                owners.setdefault(name, []).append(row["id"])
        bundles.append({"tasks": [r["id"] for r in rows], "rows": rows,
                        "shared_files": {f: ids for f, ids in sorted(owners.items()) if len(ids) > 1},
                        "epics": sorted({r["epic"] for r in rows if r["epic"]})})
    return bundles


def nextup(args):
    _candidates, held, skipped = nextup_candidates()
    bundles = nextup_bundles()
    if not bundles:
        print("no startable TODO tasks in PLAN.md")
    for rank, bundle in enumerate(bundles[:args.limit], start=1):
        size = len(bundle["tasks"])
        too_big = "  [over 8: split by sub-area before starting]" if size > 8 else ""
        print(f"bundle {rank}: {size} task(s), epics: {', '.join(bundle['epics']) or '(none)'}{too_big}")
        for row in bundle["rows"]:
            print(f"  {row['id']}: {row['title']} -- {row['path']}")
            print(f"    files: {', '.join(row['files']) or '(none listed)'}")
        for name, ids in bundle["shared_files"].items():
            print(f"  shared: {name} ({', '.join(ids)})")
        print(f"  start: bash scripts/dotask.sh start {' '.join(bundle['tasks'])}")
    if len(bundles) > args.limit:
        print(f"(+{len(bundles) - args.limit} more bundle(s); --limit to see them)")
    for task_id, items in held.items():
        print(f"held: {task_id}: {', '.join(items)}")
    for note in skipped:
        print(f"skipped: {note}")
    return 0


# --- status ----------------------------------------------------------------------
def status(args):
    groups = sorted(TASKS_ROOT.glob(f"*/{GROUP_FILE}"))
    if not groups:
        print("no live /dotask groups")
        return 0
    for group_path in groups:
        try:
            group = json.loads(group_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        slug = group.get("slug", group_path.parent.name)
        running = "running" if container_running(slug) else "stopped"
        status_file = group_path.parent / ".dotask-status"
        last = ""
        if status_file.is_file():
            lines = [line for line in status_file.read_text(encoding="utf-8").splitlines() if line.strip()]
            last = lines[-1] if lines else ""
        print(f"{slug}\t{','.join(group.get('tasks', []))}\t{running}\t{last}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)

    begin = sub.add_parser("start")
    begin.add_argument("tasks", nargs="+")
    mode = begin.add_mutually_exclusive_group()
    mode.add_argument("--headless", dest="headless", action="store_true", default=True,
                      help="the default: one fresh background `claude -p` per task")
    mode.add_argument("--window", dest="headless", action="store_false",
                      help="open a VS Code window instead; you send /clear + the kickoff between tasks")
    begin.add_argument("--capture", action="store_true")
    begin.add_argument("--allow-overlap", action="store_true",
                       help="start even if files overlap a live group; the worker rebases before finishing")

    finish = sub.add_parser("land")
    finish.add_argument("slug")
    finish.add_argument("--after-test", action="store_true",
                        help="the human tested the stack `land <slug>` started: push, open the PR, wait for CI")

    auto = sub.add_parser("autoland", help="verify every criterion with Playwright, send failures back to a "
                                           "worker, push once clean")
    auto.add_argument("slug")
    auto.add_argument("--no-land", action="store_true", help="stop after a clean verdict; push nothing")

    app = sub.add_parser("stack")
    app.add_argument("slug")

    sub.add_parser("status")

    upcoming = sub.add_parser("nextup", help="bundle TODO tasks that share files or an epic folder, PLAN order")
    upcoming.add_argument("--limit", type=int, default=5)

    args = parser.parse_args(argv)
    try:
        return {"start": start, "land": land, "autoland": autoland, "stack": stack, "status": status,
                "nextup": nextup}[args.action](args)
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: {' '.join(str(p) for p in exc.cmd)} failed (exit {exc.returncode})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
