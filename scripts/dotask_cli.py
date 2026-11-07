"""Supervisorless /dotask: one GROUP (one or more tasks) = one container, one
checkout, one branch, one PR. There is no model supervisor process -- a group
runs headless by default (build_loop: one fresh `claude -p` per task, the
equivalent of /clear + resending the kickoff), or with --window the user talks
directly to the Claude session in the container (`task.sh code`). This module
does host-side bookkeeping and git/gh plumbing only; it never calls a model itself.

Commands (see scripts/dotask.sh, the thin bash entry point):
  python scripts/dotask_cli.py start [--window] [--capture] T1 [T2 ...]
  python scripts/dotask_cli.py stack <slug>              # app stack up + healthy, prints the URLs
  python scripts/dotask_cli.py land <slug>               # stack up for a human test; no push yet
  python scripts/dotask_cli.py land <slug> --after-test  # push, PR, CI, evidence (HEAD must be the tested one)
  python scripts/dotask_cli.py autoland <slug> [--no-land]  # verify -> fix -> verify, then push (headless runs this itself)
  python scripts/dotask_cli.py resume <slug> [--no-land]    # continue a headless group: build what is left, then autoland
  python scripts/dotask_cli.py status                       # one line per live group, with its ETA
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
# A worker that ran out of turns leaves its work uncommitted; the next conversation must not discard it.
RESUME_HINT = (" The working tree already holds uncommitted work on this task from a conversation that ran out "
               "of turns, and .dotask-notes.md ends with a handoff section for it: keep that work, verify it "
               "against the progress checklist, finish, run the relevant tests, and commit.")
# One group of ten tasks held eight passing tasks back behind one export bug at landing (g-t15220-10,
# 2026-11-07). Smaller groups land what passes sooner; a bigger bundle starts as several groups.
MAX_GROUP_TASKS = 4
# Extra dispatches for one task (or one fix round) after a dispatch ran out of turns with its work
# uncommitted. Three such stops were restarted by hand on g-t15220-10 (2026-11-07), one of them after
# an overnight gap; each had the code done and only the commit missing.
BUILD_RETRIES = 2


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


# A task that still waits on the user (a decision page, "the user picks", an owner ruling) cannot be
# worked headless: nobody is there to answer. g-t15220-10 (2026-11-07) carried two such tasks; one
# stalled and the other ruled for itself, and landing then took longer than building all ten tasks.
# The ruling must be in the task file, where the worker and the verifier read it.
DECISION_GATE = re.compile(r"decision page|\(decision\)|design-gated|WAITING ON USER"
                           r"|\b(?:user|owner) (?:picks|decides|rules|has ruled)\b", re.I)
RULING_RECORDED = re.compile(r"\b(?:user|owner)(?:'s)? (?:pick|picked|ruling|ruled|chose|choice|confirmed|agreed|approved)\b"
                             r"|\bUSER PICK\b|\bapproved \d{4}-\d{2}-\d{2}|\((?:user|owner), \d{4}-\d{2}-\d{2}\)", re.I)
UNCHECKED_ITEM = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\[ \]")


def pending_decision(path):
    """The first line that makes this task wait on the user, or None: no such line, or a line that
    records the user's ruling (`(owner, 2026-11-07)`, `user picked C`, `USER PICK`, ...). An unchecked
    criterion like `- [ ] Owner has ruled A, B or C` is the gate itself, never the ruling."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    if any(RULING_RECORDED.search(line) for line in lines if not UNCHECKED_ITEM.match(line)):
        return None
    return next((line.strip() for line in lines if DECISION_GATE.search(line)), None)


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
    waiting = {}  # task -> the line that makes it wait on the user
    for task_id in task_ids:
        path = resolve_task_file(task_id)
        status = task_status(path)
        if status not in ("TODO", "WIP"):
            die(f"{task_id} has PLAN.md status {status!r}, not TODO/WIP")
        commits = merged_commits(task_id)
        if commits:
            die(f"{task_id} already has commits on origin/master: {commits[0]}")
        gate = pending_decision(path)
        if gate:
            waiting[task_id] = gate
        files_by_task[task_id] = relevant_files(path)
    if waiting:
        lines = [f"  {task_id}: {line[:160]}" for task_id, line in waiting.items()]
        clear = [t for t in task_ids if t not in waiting]
        hint = f"Start the others now: /dotask {' '.join(clear)}" if clear else "Every task waits on the user."
        die("these tasks wait on a user ruling, which a headless worker cannot give:\n" + "\n".join(lines) +
            "\nAsk the user, record the answer in the task file under `## Ruling` (e.g. `**B** (owner, 2026-11-07)` "
            "plus the reasoning), commit it, then start.\n" + hint)
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
    if len(task_ids) > MAX_GROUP_TASKS and not getattr(args, "allow_large", False):
        first, rest = task_ids[:MAX_GROUP_TASKS], task_ids[MAX_GROUP_TASKS:]
        die(f"{len(task_ids)} tasks in one group: at landing one failing task holds back every other one "
            f"(g-t15220-10, 2026-11-07: one export bug held eight passing tasks). The cap is {MAX_GROUP_TASKS}.\n"
            f"Start /dotask {' '.join(first)} now and /dotask {' '.join(rest)} after it, or add --allow-large.")
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
            # `resume` is the whole headless run: the build loop, then autoland. The same command
            # continues a group that stopped, so nothing is special about the first launch.
            subprocess.Popen([Path(sys.executable).as_posix(), Path(__file__).resolve().as_posix(), "resume", slug],
                             env={**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT),
                                  "DOTASK_WAVE_ID": wave_id, "DOTASK_PHASE": "implementation"},
                             stdout=log, stderr=subprocess.STDOUT)
        print(f"slug: {slug}")
        print(f"branch: {branch}")
        print(f"headless log: {log_path}")
        print(eta_line(group, checkout))
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
    lines = [f"Tasks: {', '.join(group['tasks'])}", "",
             f"Criteria are namespaced per task ({criteria_note}).",
             f"Evidence: {LANDING_ROOT / 'evidence' / group['slug']}"]
    if group.get("staging_checks"):
        lines += ["", "Check on staging after merge (owner ruling in the task file; not verified before the push):"]
        lines += [f"- {item['id']}: {item['text']}" for item in group["staging_checks"]]
    return "\n".join(lines)


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
# the flows the diff touches. Failures go back to a fresh worker; the next verifier re-checks only
# what failed (plus the regression pass) on the new HEAD, and the earlier passes carry forward. Only a
# clean verdict on the exact HEAD pushes (user decision, 2026-11-07); merging stays with the user. Any
# verdict that cannot be trusted stops the loop: it never counts as a pass.
VERIFY_FILE = ".dotask-verify.json"
MAX_FIX_ROUNDS = 3  # a flaky test or an unfixable bug must not burn usage forever
VERIFY_ATTEMPTS = 2  # retries cover only a dispatch that errored out, never a bad verdict
# One verifier for 10 tasks (about 45 criteria) ran out of 120 turns (g-t15220-10, 2026-11-07), so each
# dispatch proves a few tasks and the last one also runs the regression pass.
VERIFY_BATCH = 3
REGRESSION_STEP = ("Regression pass: from `git diff origin/master...HEAD --stat`, exercise the flows this branch "
                   "touches and look for anything broken that no criterion names.")
NO_REGRESSION_STEP = "Skip the regression pass: another verifier dispatch runs it. Report bugs you happen to see."
FULL_SCOPE_STEP = ("For EACH task ({tasks}), read the `## Acceptance Criteria` of its file under docs/plans/tasks and "
                   "give EVERY criterion one entry, in order, named T<id>:C1, T<id>:C2, ...")
# After a fix round only what failed is re-checked: re-proving 40 passing criteria cost an hour per
# round on g-t15220-10 (2026-11-07). The regression pass still runs, and earlier passes carry forward.
FOCUSED_SCOPE_STEP = ("This is a re-check after fix round {fix_round}. Prove ONLY these criteria from the task files "
                      "under docs/plans/tasks, one entry each with the same id: {criteria}. {bugs_step}Every other "
                      "criterion passed on the previous HEAD and is not re-checked here; do not list it.")
BUGS_STEP = ("Re-run the steps of each of these bugs and list any still present under `bugs` with the same title "
             "(a fixed bug gets no entry): {titles}. ")
VERIFY_STATUSES = ("pass", "fail", "human")
BUG_SCOPES = ("group", "unrelated")
ACCEPTANCE_ITEM = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]")
BUG_SECTION = "### Bugs found by /dotask verify"
PLAN_TAIL_HEADING = "## Environment Configuration"
VERIFY_INSTRUCTION = """You are the independent verifier for this group, verify round {round}, batch {batch}. You did not write this code.
Do not trust the worker's claims, qa/proof.json or .dotask-notes.md conclusions: observe behavior yourself.
Do NOT edit tracked files, commit, or change qa/proof.json. Keep every script you write under /tmp. HEAD is {head}.

The app stack was just restarted on this code: http://localhost:5173, backend :8000, dev accounts ?dev_account=empty|upload|full.

1. {scope}
2. Prove each criterion by observation. Use Playwright for anything a user can see (require('/workspace/src/frontend/node_modules/@playwright/test'), scripts under /tmp, chromium headless). Use the real API or the task's targeted tests only for what no user can see.
3. Read each criterion literally. Code that meets the intent but not the text is a `fail`, with that said in the evidence.
4. src/landing changes: this stack does not serve the landing site. Run `npm run build` in src/landing (`npm ci` first if node_modules is missing), then serve dist from a small node script under /tmp, mapping /x to x.html.
5. {regression}
6. Before believing a surprising result, confirm the served code is the code on disk. Pass an explicit long Bash timeout for builds, installs and e2e runs. Stop investigating a finding once you can state its steps; fixing is not your job.

Write /workspace/.dotask-verify.json, exactly:
{{"head": "{head}",
  "criteria": [{{"id": "T1:C1", "status": "pass|fail|human", "evidence": "what you observed"}}],
  "bugs": [{{"scope": "group|unrelated", "task": "T1", "title": "...", "steps": "...", "expected": "...", "actual": "..."}}]}}
`human` is only for what no automation can observe (a real card payment, a physical phone). Never use it to save effort.
A bug's scope is `group` if this branch caused it and `unrelated` if master has it too: check before deciding.
Then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} {head} verify round {round} batch {batch}` to /workspace/.dotask-status and stop. If you cannot run the checks at all, append `BLOCKED <reason>` instead."""
FIX_INSTRUCTION = """Independent verification of {head} found problems, listed in /workspace/.dotask-verify.json: every criterion with status `fail` and every bug with scope `group`. Ignore everything else in that file. All tasks already have commits, so do not start a new one.
Before your first code edit, append a `## fix round {round} progress` checklist to .dotask-notes.md with one line per finding (unless one with that exact heading is already there: then continue it), and tick each line as it is fixed: a dispatch can run out of turns mid-round, and the next worker resumes from that list (g-t15220-10 fix round 1, 2026-11-07, stopped with 17 files changed and no list). A progress checklist under any other heading is from an earlier round or task: ignore it.
Commit as you go: as soon as one owning task's findings are fixed and their tests pass, commit that task (explicit paths), then move to the next. Work left uncommitted is lost to the next worker's verification when a dispatch runs out of turns (the same round ran out three times with nothing committed).
Fix each finding at its root, failing test first. Re-run only the tests that failed and the ones you wrote; a test that already passed on this code stays passed and is not run again (user rule, 2026-11-07). Lint the files you changed. Commit with explicit paths, one commit per owning task, subject `T<id>: fix <what>`, ending with the Co-Authored-By line from the kickoff. Append what a later fix round needs to .dotask-notes.md. If you changed a test named in qa/proof.json, update its entry (new red and green logs, new sha256), or landing cannot build the evidence.
A finding you believe is wrong: do not work around it. Never edit a task file's Acceptance Criteria to make one pass: they are the user's. Append `BLOCKED <finding and why>` and stop.
Otherwise run `bash scripts/dotask_preland_check.sh`, then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} <new sha> fix round {round}` to /workspace/.dotask-status and stop."""


class UntrustedVerdict(Exception):
    pass


def acceptance_items(task_file):
    """The checkbox items of a task file's Acceptance Criteria, in order, as their text."""
    items, inside = [], False
    for line in Path(task_file).read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside = line.lower().startswith("## acceptance")
        elif inside and ACCEPTANCE_ITEM.match(line):
            items.append(ACCEPTANCE_ITEM.sub("", line).strip())
    return items


def acceptance_count(task_file):
    """Checkbox items in a task file's Acceptance Criteria: the floor a verdict must cover."""
    return len(acceptance_items(task_file))


STAGING_WORD = re.compile(r"\bstaging\b", re.I)
CRITERION_REF = re.compile(r"\bC(\d+)\b")


def staging_deferred(task_file):
    """Criterion ids whose check the owner moved to staging after merge: a recorded ruling (see
    RULING_RECORDED) that says `staging` and names the criterion (`C2 ... verified on staging`), or
    sits right under it in the Acceptance Criteria. T14860:C2 (2026-11-07) needed two real GPU
    exports no sandbox has; the owner ruled "check on staging", and autoland still stopped for it."""
    task_id = re.match(r"T\d+", Path(task_file).name).group(0)
    deferred, inside, current = set(), False, 0
    for line in Path(task_file).read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside, current = line.lower().startswith("## acceptance"), 0
            continue
        if inside and ACCEPTANCE_ITEM.match(line):
            current += 1
        if not (STAGING_WORD.search(line) and RULING_RECORDED.search(line)):
            continue
        named = [int(n) for n in CRITERION_REF.findall(line)]
        if named:
            deferred.update(named)
        elif inside and current:
            deferred.add(current)
    return {f"{task_id}:C{n}" for n in sorted(deferred)}


def read_verdict(checkout, group, head, tasks=None, criteria_ids=None):
    """The verifier's file, checked before it is believed. Full verify: every task in `tasks` (default:
    the group) is covered as far as its task file counts. Focused re-check: every id in `criteria_ids`
    is present."""
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
    if criteria_ids is not None:
        have = {str(item.get("id", "")) for item in criteria}
        missing = [c for c in criteria_ids if c not in have]
        if missing:
            raise UntrustedVerdict(f"re-check verdict is missing {' '.join(missing)}")
        return verdict
    for task_id in tasks or group["tasks"]:
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


# task.sh dispatches with --max-turns 120 unless DOTASK_MAX_TURNS says otherwise. A verifier proving
# about 12 criteria used 118 of those 120 (g-t15220-10 batch 1, 2026-11-07), and the unbatched verifier
# before it ran out twice; a worker's 120 stays. An explicit DOTASK_MAX_TURNS wins for every phase.
PHASE_MAX_TURNS = {"qa": 200}


def dispatch(slug, group, phase, instruction, task_ids=None):
    """One fresh `claude -p` in the group's container. True only if it ended on PUSHREADY. `task_ids`
    names the task(s) this dispatch is for (the profile records it; default: the whole group)."""
    env = {**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT),
           "DOTASK_WAVE_ID": group["wave_id"], "DOTASK_PHASE": phase,
           "DOTASK_TASK_IDS": ",".join(task_ids or group["tasks"])}
    if "DOTASK_MAX_TURNS" not in os.environ and phase in PHASE_MAX_TURNS:
        env["DOTASK_MAX_TURNS"] = str(PHASE_MAX_TURNS[phase])
    result = subprocess.run([bash(), (REPO_ROOT / "scripts" / "task.sh").as_posix(), "drive", slug, instruction],
                            env=env, check=False)
    return result.returncode == 0 and " PUSHREADY " in last_status(TASKS_ROOT / sanitize(slug))


def latest_run(checkout):
    """The newest dispatch record the profiler wrote in the checkout: what the last dispatch did
    (`outcome_class`, `requests`), even when the worker left its own status lines on the way."""
    best = {}
    for path in (Path(checkout) / ".dotask-profile").glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if record.get("schema_version") == 2 and str(record.get("started_at") or "") >= str(best.get("started_at") or ""):
            best = record
    return best


def out_of_turns(checkout):
    return latest_run(checkout).get("outcome_class") == "budget_stop"


def handoff_note(checkout, label, record):
    """What a fresh conversation needs to pick up work a dispatch left uncommitted when it ran out of
    turns: the uncommitted files and a pointer to the worker's own progress checklist."""
    try:
        changes = subprocess.run([tool("git"), "-C", str(checkout), "status", "--porcelain"],
                                 capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        changes = "(git status unavailable)"
    listed = "\n".join(f"    {line}" for line in changes.splitlines()) or "    (none)"
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
    note = (f"\n## {label} handoff (host, {stamp})\n"
            f"- The previous conversation ran out of turns ({record.get('requests', '?')} requests) before "
            f"committing. Its work is in the tree, uncommitted:\n{listed}\n"
            f"- Continue from the `## {label} progress` checklist above if there is one: verify each unchecked "
            f"item against the tree and do not redo the checked ones. A checklist under any other heading is from "
            f"an earlier round or task: ignore it. If there is none, write `## {label} progress` first. Keep the "
            f"uncommitted changes, verify them, finish, run the relevant tests, and commit each finished task "
            f"before starting the next.\n")
    path = Path(checkout) / ".dotask-notes.md"
    existing = path.read_bytes().decode("utf-8") if path.is_file() else ""
    write_lf(path, existing + note)


def dispatch_with_restarts(slug, group, checkout, label, instruction, task_ids=None):
    """A worker dispatch, repeated up to BUILD_RETRIES times while it keeps running out of turns: each
    restart gets a handoff note and the resume hint. Returns the last dispatch's result (True only if
    it ended on PUSHREADY, as `dispatch` reports)."""
    finished = False
    for attempt in range(BUILD_RETRIES + 1):
        text = instruction + (RESUME_HINT if attempt else "")
        if task_ids is None:
            finished = dispatch(slug, group, "implementation", text)
        else:
            finished = dispatch(slug, group, "implementation", text, task_ids)
        if not out_of_turns(checkout) or attempt == BUILD_RETRIES:
            break
        handoff_note(checkout, label, latest_run(checkout))
        append_status(checkout, f"RESUMED {label} dispatch {attempt + 2} of {BUILD_RETRIES + 1}: ran out of turns, "
                                "handoff written to .dotask-notes.md")
    return finished


# --- build loop (headless): one fresh dispatch per task ----------------------------------------
def next_task(checkout, group):
    text = (Path(checkout) / ".dotask-status").read_text(encoding="utf-8") \
        if (Path(checkout) / ".dotask-status").is_file() else ""
    return next((t for t in group["tasks"] if f"STAGE_DONE {t} commit" not in text), None), text


def build_loop(slug, group, checkout):
    """The kickoff's one-task-per-conversation protocol with no human between tasks: each dispatch
    names its task (a worker left to derive it trusted a stale BLOCKED line, 2026-11-07) and must end
    on that task's commit line (continue) or PUSHREADY (done, 0). Anything else stops with 1: BLOCKED,
    CONFLICT (another task's criterion would become false; the user rules), DISPATCH_FAILED, ... A
    dispatch that ran out of turns is restarted with a handoff (dispatch_with_restarts). No PUSHREADY
    after the last commit is 3."""
    eta = EtaReporter(group, checkout)
    while True:
        task, text = next_task(checkout, group)
        if task is None:
            return 0 if " PUSHREADY " in text else 3
        eta.report()
        dispatch_with_restarts(slug, group, checkout, task, f"{HEADLESS_INSTRUCTION} Your task is {task}.",
                               task_ids=[task])
        last = last_status(checkout)
        if " PUSHREADY " in last:
            return 0
        if f" STAGE_DONE {task} commit" in last:
            continue
        why = ("needs the user's ruling (another task's criterion would become false)" if " CONFLICT " in last
               else "stopped")
        print(f"[dotask] headless {why} after {task}: {last}", file=sys.stderr)
        return 1


def resume(args):
    """Continue a headless group from wherever it stopped: the build loop for every task without a
    commit line, then autoland (which itself resumes a fix round's focused re-check). `start --headless`
    launches exactly this, so a restart after a crash, a BLOCKED answer or a host reboot is the same command."""
    slug = args.slug
    checkout = TASKS_ROOT / sanitize(slug)
    group_path = checkout / GROUP_FILE
    if not group_path.is_file():
        die(f"no group file at {group_path}; is {slug} a live /dotask group?")
    group = json.loads(group_path.read_text(encoding="utf-8"))
    task, _text = next_task(checkout, group)
    done = len(group["tasks"]) - len([t for t in group["tasks"] if f"STAGE_DONE {t} commit" not in _text])
    print(f"[dotask] resume {slug}: {done} of {len(group['tasks'])} task(s) committed"
          + (f", next {task}" if task else ", building done"))
    code = build_loop(slug, group, checkout)
    if code:
        return code
    fix_round = interrupted_fix_round(checkout, group)
    if fix_round:
        # The fix round stopped with its work uncommitted. autoland would verify that dirty tree from
        # scratch and block on it (g-t15220-10, 2026-11-07), so the round continues first; once it
        # commits, autoland's resume_focus picks up the focused re-check.
        head = git_head(checkout)
        print(f"[dotask] fix round {fix_round} stopped with uncommitted work; continuing it")
        handoff_note(checkout, f"fix round {fix_round}", latest_run(checkout))
        finished = dispatch_with_restarts(slug, group, checkout, f"fix round {fix_round}",
                                          FIX_INSTRUCTION.format(head=head, branch=group["branch"], round=fix_round)
                                          + RESUME_HINT)
        if not finished or git_head(checkout) == head:
            append_status(checkout, f"VERIFY_BLOCKED fix round {fix_round} did not finish on resume: "
                                    f"{last_status(checkout)[:200]}")
            return 1
    return autoland(SimpleNamespace(slug=slug, no_land=args.no_land))


def interrupted_fix_round(checkout, group):
    """The fix round to continue, or None: the last verdict has findings and was made on HEAD (so its
    fix has not committed), the tree holds tracked changes, and the last dispatch was a worker that ran
    out of turns or ended without its PUSHREADY. The round number is the newest archived verify round
    on that HEAD."""
    try:
        verdict = json.loads((Path(checkout) / VERIFY_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    findings = [c for c in verdict.get("criteria", []) if c.get("status") == "fail"] + \
               [b for b in verdict.get("bugs", []) if b.get("scope") == "group"]
    run = latest_run(checkout)
    if not findings or verdict.get("head") != git_head(checkout) or not tracked_changes(checkout) \
            or run.get("phase") != "implementation" or run.get("outcome_class") == "success":
        return None
    rounds = [int(m.group(1)) for p in (TASKS_ROOT / "waves" / group["wave_id"]).glob("verify-round-*.json")
              if (m := re.fullmatch(r"verify-round-(\d+)\.json", p.name))
              and json.loads(p.read_text(encoding="utf-8")).get("head") == verdict.get("head")]
    return max(rounds) if rounds else 1


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


def verify_once(slug, group, checkout, head, round_number, focus=None):
    """Stack up on HEAD, then fresh verifiers a few tasks at a time. After a fix round `focus` names the
    previous verdict's failed criteria and group bugs (and carries that verdict): only those are
    re-checked, plus the regression pass, and the rest of the previous verdict carries forward.
    Returns the merged verdict, which lists every criterion; raises UntrustedVerdict if any batch
    cannot be used."""
    try:
        bring_up_stack(slug)
    except subprocess.CalledProcessError as exc:
        raise UntrustedVerdict(f"stack did not start (exit {exc.returncode})") from exc
    if focus:
        tasks = [t for t in group["tasks"] if any(c.startswith(f"{t}:") for c in focus["criteria"])
                 or any(b.get("task") == t for b in focus["bugs"])]
        tasks = tasks or group["tasks"][-1:]  # a bug the verifier left without a task is still re-run
    else:
        tasks = list(group["tasks"])
    queue = [tasks[i:i + VERIFY_BATCH] for i in range(0, len(tasks), VERIFY_BATCH)]
    merged = {"head": head, "criteria": [], "bugs": []}
    archive_dir = TASKS_ROOT / "waves" / group["wave_id"]
    archive_dir.mkdir(parents=True, exist_ok=True)
    number = 0
    while queue:
        batch = queue.pop(0)
        number += 1
        label = f"{number} of {number + len(queue)}"
        last = not queue
        wanted = None
        if focus:
            wanted = [c for c in focus["criteria"] if c.split(":")[0] in batch]
            bugs = [b for b in focus["bugs"]
                    if b.get("task") in batch or (last and b.get("task") not in group["tasks"])]
            bugs_step = BUGS_STEP.format(titles="; ".join(str(b["title"]) for b in bugs)) if bugs else ""
            scope = FOCUSED_SCOPE_STEP.format(fix_round=round_number - 1, criteria=", ".join(wanted) or "(none)",
                                              bugs_step=bugs_step)
        else:
            scope = FULL_SCOPE_STEP.format(tasks=", ".join(batch))
        instruction = VERIFY_INSTRUCTION.format(
            round=round_number, batch=label, head=head, scope=scope, branch=group["branch"],
            regression=REGRESSION_STEP if last else NO_REGRESSION_STEP)
        for attempt in range(VERIFY_ATTEMPTS):
            (checkout / VERIFY_FILE).unlink(missing_ok=True)
            finished = dispatch(slug, group, "qa", instruction)
            # A transport failure (g-t15220-10, 2026-11-07: ENOTFOUND 7 minutes in) says nothing about the code.
            if finished or "outcome=error" not in last_status(checkout) or tracked_changes(checkout):
                break
            print(f"[dotask] verifier dispatch errored (attempt {attempt + 1}); retrying", file=sys.stderr)
        if not finished and out_of_turns(checkout) and len(batch) > 1:
            # A batch of three tasks (about 12 criteria) still ran out of 120 turns (g-t15220-10 batch 3,
            # 2026-11-07). A verifier has nothing to hand off, so its tasks are proved one at a time.
            print(f"[dotask] verifier batch {label} ran out of turns; proving its tasks one at a time",
                  file=sys.stderr)
            queue[0:0] = [[t] for t in batch]
            continue
        if not finished:
            raise UntrustedVerdict(f"verifier batch {label} did not finish: {last_status(checkout)[:200]}")
        changed = tracked_changes(checkout)
        if git_head(checkout) != head or changed:
            raise UntrustedVerdict(f"verifier changed the tree: {git_head(checkout)[:9]} {changed[:200]}")
        verdict = read_verdict(checkout, group, head, tasks=batch, criteria_ids=wanted)
        (archive_dir / f"verify-round-{round_number}-batch-{number}.json").write_text(
            json.dumps(verdict, indent=2) + "\n", encoding="utf-8")
        merged["criteria"] += verdict["criteria"]
        merged["bugs"] += verdict["bugs"]
    if focus:
        # Every criterion stays in the verdict: the re-checked ones fresh, the rest as the previous
        # verifier saw them, marked with the HEAD that observation was made on.
        previous = focus["previous"]
        fresh = {str(c.get("id")): c for c in merged["criteria"]}
        ordered = []
        for item in previous["criteria"]:
            item_id = str(item.get("id"))
            ordered.append(fresh.pop(item_id) if item_id in fresh
                           else {**item, "carried_from": item.get("carried_from") or previous["head"]})
        merged["criteria"] = ordered + list(fresh.values())
    # The fix worker reads the whole round's findings from this one file.
    write_lf(checkout / VERIFY_FILE, json.dumps(merged, indent=2) + "\n")
    (archive_dir / f"verify-round-{round_number}.json").write_text(json.dumps(merged, indent=2) + "\n",
                                                                  encoding="utf-8")
    return merged


def is_ancestor(checkout, older, newer):
    return subprocess.run(["git", "-C", str(checkout), "merge-base", "--is-ancestor", older, newer],
                          capture_output=True).returncode == 0


def resume_focus(checkout, group, head):
    """(focus, round) to pick up a stopped autoland after its fix round: the last verdict failed, was
    made on an ancestor of HEAD, and HEAD has moved since. Otherwise (None, 1): a full verify. Without
    this a restart re-ran every criterion (g-t15220-10, 2026-11-07: 4 batches, about 3 hours)."""
    path = checkout / VERIFY_FILE
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, 1
    seen = str(previous.get("head") or "")
    failed = [c.get("id") for c in previous.get("criteria", []) if c.get("status") == "fail"]
    bugs = [b for b in previous.get("bugs", []) if b.get("scope") == "group"]
    if not seen or seen == head or not (failed or bugs) or not previous.get("criteria"):
        return None, 1
    if not is_ancestor(checkout, seen, head):
        return None, 1
    rounds = [int(m.group(1)) for p in (TASKS_ROOT / "waves" / group["wave_id"]).glob("verify-round-*.json")
              if (m := re.fullmatch(r"verify-round-(\d+)\.json", p.name))
              and json.loads(p.read_text(encoding="utf-8")).get("head") == seen]
    return {"criteria": failed, "bugs": bugs, "previous": previous}, (max(rounds) if rounds else 1) + 1


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

    # After a failed round: what the next verifier re-checks. A restart after a fix round resumes it.
    focus, first_round = resume_focus(checkout, group, git_head(checkout))
    if focus:
        print(f"[dotask] resuming at round {first_round}: re-checking {focus['criteria']} and "
              f"{len(focus['bugs'])} bug(s) from {focus['previous']['head'][:9]}")
    staging = set().union(*(staging_deferred(resolve_task_file(t)) for t in group["tasks"]))
    eta = EtaReporter(group, checkout)
    for fix_round in range(first_round - 1, MAX_FIX_ROUNDS + 1):
        round_number = fix_round + 1
        head = git_head(checkout)
        eta.report()
        check = run_preland_check(checkout)
        if check.returncode:  # hygiene is the worker's to fix; a browser pass on it would be wasted
            summary = f"pre-land check failed on {head[:9]}"
            write_lf(checkout / VERIFY_FILE, json.dumps({"head": head, "criteria": [], "bugs": [
                {"scope": "group", "title": "pre-land check failed", "actual": check.stdout + check.stderr}]}, indent=2) + "\n")
        else:
            try:
                verdict = verify_once(slug, group, checkout, head, round_number, focus)
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
            # A `human` criterion the owner already ruled "check on staging" is answered: it rides
            # along in the PR body instead of stopping the push.
            deferred = [c for c in human if c in staging]
            human = [c for c in human if c not in staging]
            if not failed and not bugs:
                group["tested_head"] = head
                group["staging_checks"] = [
                    {"id": c, "text": acceptance_items(resolve_task_file(c.split(":")[0]))[int(c.split(":C")[1]) - 1]}
                    for c in deferred]
                save_group(checkout, group)
                if human:
                    append_status(checkout, f"VERIFY_NEEDS_USER {head[:9]}: check {' '.join(human)}, "
                                            f"then run /dotask land {slug} --after-test")
                    return 0
                staging_note = f"; check on staging after merge: {' '.join(deferred)}" if deferred else ""
                append_status(checkout, f"VERIFY_PASS {head[:9]} round {round_number}{staging_note}")
                return 0 if args.no_land else land(SimpleNamespace(slug=slug, after_test=True))
            summary = f"round {round_number} on {head[:9]}: failed {failed}, new bugs {bugs}"
            focus = {"criteria": failed, "bugs": [b for b in verdict["bugs"] if b["scope"] == "group"],
                     "previous": verdict}
        if fix_round == MAX_FIX_ROUNDS:
            append_status(checkout, f"VERIFY_EXHAUSTED after {MAX_FIX_ROUNDS} fix rounds; {summary}")
            return 1
        print(f"[dotask] {summary}; sending it back to a worker")
        if not dispatch_with_restarts(slug, group, checkout, f"fix round {round_number}",
                                      FIX_INSTRUCTION.format(head=head, branch=group["branch"], round=round_number)):
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
    """(candidates in PLAN order, {task: ["file (live group slug)"]} held back, [unresolvable notes],
    {task: gating line} waiting on a user ruling)."""
    tasks_dir = MAIN_REPO / "docs" / "plans" / "tasks"
    groups = live_groups()
    candidates, held, skipped, decisions = [], {}, [], {}
    for task_id in plan_todo_tasks():
        matches = sorted(tasks_dir.rglob(f"{task_id}-*.md"))
        if len(matches) != 1:
            skipped.append(f"{task_id}: {len(matches)} task files match {task_id}-*.md")
            continue
        path = matches[0]
        gate = pending_decision(path)
        if gate:
            decisions[task_id] = gate
            continue
        files = [f for f in relevant_files(path) if "/" in f]  # prose in backticks is not a file
        taken = [f"{name} (live group {g.get('slug')})"
                 for g in groups for name in sorted(set(files) & set(g.get("owned_files", [])))]
        if taken:
            held[task_id] = taken
            continue
        epic = path.parent.relative_to(tasks_dir).as_posix() if path.parent != tasks_dir else None
        candidates.append({"id": task_id, "title": task_title(path), "path": path.relative_to(MAIN_REPO).as_posix(),
                           "files": files, "epic": epic})
    return candidates, held, skipped, decisions


def nextup_bundles():
    """TODO tasks joined when they share a Relevant File or an epic folder (transitively). Tasks keep
    PLAN order inside a bundle; bundles rank by their first task's PLAN position."""
    candidates, _held, _skipped, _decisions = nextup_candidates()
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
    _candidates, held, skipped, decisions = nextup_candidates()
    bundles = nextup_bundles()
    if not bundles:
        print("no startable TODO tasks in PLAN.md")
    for rank, bundle in enumerate(bundles[:args.limit], start=1):
        size = len(bundle["tasks"])
        too_big = (f"  [over {MAX_GROUP_TASKS}: one group per start line below, in order]"
                   if size > MAX_GROUP_TASKS else "")
        print(f"bundle {rank}: {size} task(s), epics: {', '.join(bundle['epics']) or '(none)'}{too_big}")
        for row in bundle["rows"]:
            print(f"  {row['id']}: {row['title']} -- {row['path']}")
            print(f"    files: {', '.join(row['files']) or '(none listed)'}")
        for name, ids in bundle["shared_files"].items():
            print(f"  shared: {name} ({', '.join(ids)})")
        for i in range(0, size, MAX_GROUP_TASKS):
            print(f"  start: bash scripts/dotask.sh start {' '.join(bundle['tasks'][i:i + MAX_GROUP_TASKS])}")
    if len(bundles) > args.limit:
        print(f"(+{len(bundles) - args.limit} more bundle(s); --limit to see them)")
    for task_id, items in held.items():
        print(f"held: {task_id}: {', '.join(items)}")
    for task_id, line in decisions.items():
        print(f"decision: {task_id}: {line[:160]}")
    for note in skipped:
        print(f"skipped: {note}")
    return 0


# --- ETA ---------------------------------------------------------------------------
# An ETA goes with every status (user decision, 2026-11-07), and a move of more than ETA_SHIFT_MINUTES
# is reported as a change. Defaults are g-t15220-10's medians; a group's own timed dispatches replace
# them as they accumulate. The estimate is for the PR, not the merge: merging stays with the user.
DEFAULT_MINUTES = {"implementation": 25, "qa": 35, "ci": 8}
ETA_SHIFT_MINUTES = 15
STOP_WORDS = ("VERIFY_BLOCKED", "VERIFY_EXHAUSTED", "VERIFY_NEEDS_USER", "BLOCKED", "CONFLICT", "DISPATCH_FAILED",
              "ENDED_WITHOUT_STATUS", "AUTH_DEAD", "PHASE_VIOLATION")
BATCH_PROGRESS = re.compile(r"verify round \d+ batch (\d+) of (\d+)")


def run_records(slug):
    """This group's dispatch records (task.sh archives them to profiles/<slug>/), oldest first."""
    records = []
    for path in sorted((TASKS_ROOT / "profiles" / sanitize(slug)).glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if record.get("schema_version") == 2 and record.get("duration_seconds") is not None:
            records.append(record)
    return records


def phase_minutes(records, phase):
    """Median minutes of this group's finished dispatches in `phase`, else the default."""
    done = sorted(r["duration_seconds"] / 60 for r in records
                  if r.get("phase") == phase and r.get("outcome_class") == "success")
    return done[len(done) // 2] if done else DEFAULT_MINUTES[phase]


def estimate(group, checkout, now=None):
    """(best, with_one_fix_round, basis): when the PR should open if nothing fails, when it should open
    if one fix round is needed (None once no verify is ahead), and what the numbers rest on. A stopped
    group returns (None, None, why)."""
    now = now or dt.datetime.now().astimezone()
    _next, text = next_task(checkout, group)
    lines = [line for line in text.splitlines() if line.strip()]
    last = lines[-1] if lines else ""
    records = run_records(group["slug"])
    impl, batch, ci = (phase_minutes(records, "implementation"), phase_minutes(records, "qa"),
                       DEFAULT_MINUTES["ci"])
    source = f"medians of {len(records)} timed dispatch(es)" if records else "defaults, no timed dispatch yet"
    left = [t for t in group["tasks"] if f"STAGE_DONE {t} commit" not in text]
    batches = -(-len(group["tasks"]) // VERIFY_BATCH)
    fix_round = impl + batch  # one worker dispatch, then one focused re-check batch
    parts, verify_ahead = [], True
    if "VERIFY_PASS" in last:
        minutes, verify_ahead = ci, False
        parts.append(f"CI {ci:.0f} min")
    elif any(f" {word} " in f" {last} " or f" {word}" in last for word in STOP_WORDS) and " RESUMED " not in last:
        return None, None, f"stopped, needs a restart or a ruling: {last[:140]}"
    elif " RESUMED " in last and "fix round" in last.lower():
        # A fix dispatch restarted after running out of turns: the rest of the round, then the re-check.
        minutes = fix_round + ci
        parts += [f"fix round (restarted) {impl:.0f} min", f"1 re-check batch {batch:.0f} min", f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last and "verify round" in last:
        found = BATCH_PROGRESS.search(last)
        remaining = int(found.group(2)) - int(found.group(1)) if found else batches
        if remaining == 0 and verdict_has_findings(checkout):
            # The last batch is in and found problems: the fix round is running now.
            minutes = fix_round + ci
            parts += [f"fix round {impl:.0f} min", f"1 re-check batch {batch:.0f} min", f"CI {ci:.0f} min"]
        else:
            minutes = remaining * batch + ci
            parts += [f"{remaining} verify batch(es) x {batch:.0f} min", f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last and "fix round" in last:
        minutes = batch + ci
        parts += [f"1 re-check batch {batch:.0f} min", f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last and (checkout / VERIFY_FILE).is_file():
        minutes = fix_round + ci  # a verdict with findings is on disk: the fix round is running
        parts += [f"fix round {fix_round:.0f} min", f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last:
        minutes = batches * batch + ci
        parts += [f"{batches} verify batch(es) x {batch:.0f} min", f"CI {ci:.0f} min"]
    else:
        minutes = len(left) * impl + batches * batch + ci
        parts += [f"{len(left)} task(s) x {impl:.0f} min", f"{batches} verify batch(es) x {batch:.0f} min",
                  f"CI {ci:.0f} min"]
    best = now + dt.timedelta(minutes=minutes)
    with_fix = best + dt.timedelta(minutes=fix_round) if verify_ahead else None
    return best, with_fix, f"{', '.join(parts)}; {source}"


def verdict_has_findings(checkout):
    try:
        verdict = json.loads((Path(checkout) / VERIFY_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return any(c.get("status") == "fail" for c in verdict.get("criteria", [])) or \
        any(b.get("scope") == "group" for b in verdict.get("bugs", []))


def clock(when, now):
    return f"{when:%H:%M}" if when.date() == now.date() else f"{when:%a %H:%M}"


def eta_line(group, checkout, now=None):
    now = now or dt.datetime.now().astimezone()
    best, with_fix, basis = estimate(group, checkout, now)
    if best is None:
        return f"eta: none ({basis})"
    line = f"eta: PR about {clock(best, now)}"
    if with_fix:
        line += f" ({clock(with_fix, now)} with one fix round)"
    return f"{line} -- {basis}"


class EtaReporter:
    """Prints the ETA at a milestone when it is new or moved by more than ETA_SHIFT_MINUTES, naming
    the earlier figure, so the run log shows every change and not every tick."""

    def __init__(self, group, checkout):
        self.group, self.checkout, self.last = group, checkout, None

    def report(self):
        now = dt.datetime.now().astimezone()
        best, _with_fix, _basis = estimate(self.group, self.checkout, now)
        if best is None:
            return
        moved = self.last is None or abs((best - self.last).total_seconds()) > ETA_SHIFT_MINUTES * 60
        if moved:
            was = f" (was {clock(self.last, now)})" if self.last is not None else ""
            print(f"[dotask] {eta_line(self.group, self.checkout, now)}{was}", flush=True)
            self.last = best


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
        if not group.get("tasks"):
            continue
        # An estimate only means something for a group that is moving: a merged PR is done (its
        # group file outlives it until nuke), and a stopped container runs nothing.
        merged = merged_pr(group.get("branch"))
        if merged:
            print(f"  eta: done -- PR #{merged} merged")
        elif running == "stopped":
            print(f"  eta: none (container stopped; `bash scripts/dotask.sh resume {slug}` continues it, "
                  f"`task.sh nuke {slug}` clears it)")
        else:
            print(f"  {eta_line({**group, 'slug': slug}, group_path.parent)}")
    return 0


def merged_pr(branch):
    """The number of a merged PR from `branch`, or None (none, or gh unavailable)."""
    if not branch:
        return None
    try:
        result = subprocess.run([tool("gh"), "pr", "list", "--head", branch, "--state", "merged", "--json", "number",
                                 "--jq", ".[0].number"], capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError, SystemExit):
        return None
    number = result.stdout.strip()
    return number if result.returncode == 0 and number.isdigit() else None


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
    begin.add_argument("--allow-large", action="store_true",
                       help=f"start more than {MAX_GROUP_TASKS} tasks as one group anyway")

    carry_on = sub.add_parser("resume", help="continue a headless group: build what has no commit line, then autoland")
    carry_on.add_argument("slug")
    carry_on.add_argument("--no-land", action="store_true", help="stop after a clean verdict; push nothing")

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
        return {"start": start, "land": land, "autoland": autoland, "resume": resume, "stack": stack,
                "status": status, "nextup": nextup}[args.action](args)
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: {' '.join(str(p) for p in exc.cmd)} failed (exit {exc.returncode})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
