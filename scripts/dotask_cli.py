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
import contextlib
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
def task_file_matches(root, task_id):
    return sorted(m for m in (Path(root) / "docs" / "plans" / "tasks").rglob(f"{task_id}-*.md")
                  if not m.name.endswith("-design.md"))


def resolve_task_file(task_id):
    matches = task_file_matches(MAIN_REPO, task_id)
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


# L-tier (or an explicit "design gate") needs the owner to approve a Stage 2 design doc. Picking the
# option is a different ruling: g-t15370-1 (2026-11-09) started on "The owner chose this" and the
# worker blocked a minute later on the missing design.
DESIGN_GATED_TIER = re.compile(r"^\*\*Tier:\*\*\s*(?:L\b|.*design gate)", re.I)


def design_approval_missing(path):
    """Why a design-gated task can't start yet, or None. Approval is a recorded ruling in the sibling
    `T{id}-design.md`, or a line in the task file that names the design and records the ruling."""
    path = Path(path)
    lines = path.read_text(encoding="utf-8").splitlines()
    if not any(DESIGN_GATED_TIER.match(line) for line in lines):
        return None
    if any("design" in line.lower() and RULING_RECORDED.search(line) for line in lines):
        return None
    design = path.with_name(f"{path.name.split('-', 1)[0]}-design.md")
    if not design.exists():
        return f"design gate: no design doc {design.name}; the Architect writes it and the owner approves it"
    if any(RULING_RECORDED.search(line) for line in design.read_text(encoding="utf-8").splitlines()):
        return None
    return f"design gate: {design.name} has no owner approval yet (e.g. `**Status:** Approved (owner, <date>)`)"


def pending_decision(path):
    """The first line that makes this task wait on the user, or None: no such line, or a line that
    records the user's ruling (`(owner, 2026-11-07)`, `user picked C`, `USER PICK`, ...). An unchecked
    criterion like `- [ ] Owner has ruled A, B or C` is the gate itself, never the ruling. A
    design-gated tier also waits for an approved design doc."""
    design_gate = design_approval_missing(path)
    if design_gate:
        return design_gate
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
                             f"^{task_id}[: ]", "--format=%H %s", "--", ".", ":(exclude)docs/plans", ":(exclude).claude"],
                            capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        return []
    # A commit undone by a `git revert` on master is not work done: T15220 was reverted out of PR #717
    # and its restart was refused for the reverted commits (2026-11-08).
    reverts = subprocess.run([tool("git"), "-C", str(MAIN_REPO), "log", "origin/master", "--grep",
                              "This reverts commit", "--format=%B"],
                             capture_output=True, text=True, timeout=60, check=False)
    reverted = set(re.findall(r"This reverts commit ([0-9a-f]{40})", reverts.stdout))
    subject = re.compile(rf"\S+ {task_id}[: ]")
    return [f"{line[:9]}{line[40:]}" for line in result.stdout.splitlines()
            if subject.match(line) and line[:40] not in reverted]


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
def criteria_waiting_elsewhere(task_ids):
    """One line per acceptance criterion that names a task outside this group which has not landed
    (status not STAGING or DONE): its verifier may find the criterion unprovable until that task merges.
    T14960:C4 needed T14930's sport parameter while T14930 ran in another group, and the group stalled on
    it (g-t15280-3, 2026-11-08). A warning, not a refusal: the criterion may only mention the task."""
    lines = []
    live = {t: g.get("slug") for g in live_groups() for t in g.get("tasks", [])}
    for task_id in task_ids:
        for number, text in enumerate(acceptance_items(resolve_task_file(task_id)), start=1):
            for other in dict.fromkeys(re.findall(r"\bT\d+\b", text)):
                if other in task_ids:
                    continue
                files = [m for m in (MAIN_REPO / "docs" / "plans" / "tasks").rglob(f"{other}-*.md")
                         if not m.name.endswith("-design.md")]
                status = task_status(files[0]) if len(files) == 1 else None
                if status is None or status.split()[0] in ("STAGING", "DONE"):
                    continue
                where = f", running in live group {live[other]}" if other in live else ""
                lines.append(f"{task_id}:C{number} names {other} ({status}{where}), which has not landed; "
                             f"its verifier may not be able to prove it until {other} merges. Add {other} to "
                             "this group, wait for it, or re-scope the criterion.")
    return lines


def task_files_off_base(paths):
    """The checkout is cut from origin/<TASK_BASE or master> (task.sh), not from the main working copy, so a
    task file that exists only locally (filed or edited but not pushed) is not what the worker reads.
    g-t15410-4 (2026-11-09) blocked on T15730: its file was committed after the group's checkout was cut
    and the worker found no spec. Returns (missing, differs): rel paths absent from the base, and rel
    paths present there whose local copy differs (e.g. a ruling committed but not pushed)."""
    base = os.environ.get("TASK_BASE") or "master"
    fetch = subprocess.run([tool("git"), "-C", str(MAIN_REPO), "fetch", "-q", "origin", base],
                           capture_output=True, text=True, timeout=120, check=False)
    if fetch.returncode:
        print(f"WARNING: could not fetch origin/{base} ({fetch.stderr.strip()[:120]}); checking task files "
              "against the last fetched copy", file=sys.stderr)
    missing, differs = [], []
    for path in paths:
        rel = Path(path).resolve().relative_to(Path(MAIN_REPO).resolve()).as_posix()
        shown = subprocess.run([tool("git"), "-C", str(MAIN_REPO), "show", f"origin/{base}:{rel}"],
                               capture_output=True, timeout=60, check=False)
        if shown.returncode:
            missing.append(rel)
        elif shown.stdout.replace(b"\r\n", b"\n") != Path(path).read_bytes().replace(b"\r\n", b"\n"):
            differs.append(rel)
    return missing, differs


def preflight(task_ids, allow_overlap=False):
    files_by_task = {}
    waiting = {}  # task -> the line that makes it wait on the user
    paths = [resolve_task_file(task_id) for task_id in task_ids]
    missing, differs = task_files_off_base(paths)
    base = os.environ.get("TASK_BASE") or "master"
    if missing:
        die(f"these task files are not on origin/{base}, which the container checkout is cut from, so the "
            "worker would find no spec:\n" + "\n".join(f"  {rel}" for rel in missing) +
            f"\nPush them first (`git push origin {base}` from {MAIN_REPO}), then start.")
    for rel in differs:
        print(f"WARNING: {rel} differs from origin/{base}; the worker reads the origin copy. Push it first if "
              "the local change (a ruling, criteria) matters.", file=sys.stderr)
    for task_id, path in zip(task_ids, paths):
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
    for line in criteria_waiting_elsewhere(task_ids):
        print(f"WARNING: {line}", file=sys.stderr)
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


def flip_plan_status(task_ids, status="WIP", only_from=None):
    """Set the PLAN.md row and task-file status of task_ids (left uncommitted in the main checkout, like
    start's WIP flips). only_from limits it to rows currently in one of those statuses."""
    def allowed(current):
        return only_from is None or (current.split() or [""])[0] in only_from
    plan_path = MAIN_REPO / "docs" / "plans" / "PLAN.md"
    lines = plan_path.read_text(encoding="utf-8").splitlines(keepends=True)
    changed = False
    for i, line in enumerate(lines):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 6 and cells[0] in task_ids and cells[5] != status and allowed(cells[5]):
            cells[5] = status
            lines[i] = "| " + " | ".join(cells) + " |\n"
            changed = True
    if changed:
        plan_path.write_text("".join(lines), encoding="utf-8")
    for task_id in task_ids:
        matches = task_file_matches(MAIN_REPO, task_id)
        if len(matches) != 1:  # start's preflight already refused these; on merge, one bad id skips only itself
            print(f"WARNING: {task_id}: {len(matches)} task files match; status not set to {status}", file=sys.stderr)
            continue
        path = matches[0]
        text = path.read_text(encoding="utf-8")
        current = task_status(path) or ""
        if current != status and allowed(current):
            path.write_text(re.sub(r"\*\*Status:\*\*\s*\S.*", f"**Status:** {status}", text, count=1),
                            encoding="utf-8")


# A merged task is STAGING (CLAUDE.md Task Status Rule): merging deploys staging, which is the test phase.
# Nothing set it, so PR #734's four tasks still read WIP on the board after merge (owner, 2026-11-09).
STAGING_FROM = ("TODO", "WIP", "WAITING")


def mark_staging(tasks):
    """Idempotent; called for every merged group by `status` (running or stopped) and by on_merge."""
    if not tasks:
        return
    try:
        flip_plan_status(tasks, "STAGING", only_from=STAGING_FROM)
    except OSError as exc:  # never blocks freeing the group
        print(f"WARNING: could not set {', '.join(tasks)} to STAGING: {exc}", file=sys.stderr)


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
    for group in live_groups():  # a merged group's container would still count as owning its files
        merged = merged_pr(group.get("branch"))
        if merged:
            print(f"[dotask] {group.get('slug')}: {on_merge(group.get('slug'), merged)}")
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
    if group.get("skipped_checks"):
        lines += ["", "Not verified: no check proved these before the verify budget ran out (owner rule 2026-11-09):"]
        lines += [f"- {item['id']}: {item['text']}" for item in group["skipped_checks"]]
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


CI_RED = 4  # land's return when autoland asked it to hand red Branch CI back instead of stopping


def ci_failure_report(branch, head, log_lines=120):
    """The failed jobs of the Branch CI run for `head` and the tail of their failed-step logs, for a fix
    worker to start from. Never raises: a report it cannot fetch says so and names the command."""
    try:
        runs = json.loads(subprocess.run(
            [tool("gh"), "run", "list", "--workflow", "Branch CI", "--branch", branch, "--limit", "20",
             "--json", "databaseId,headSha"], capture_output=True, text=True, check=True).stdout or "[]")
        run_id = next(r["databaseId"] for r in runs if r.get("headSha") == head)
        jobs = json.loads(subprocess.run([tool("gh"), "run", "view", str(run_id), "--json", "jobs"],
                                         capture_output=True, text=True, check=True).stdout or "{}")
        failed = [j["name"] for j in jobs.get("jobs", []) if j.get("conclusion") == "failure"]
        # CI logs carry ANSI and unicode that Windows' default code page cannot decode; text=True then
        # returned stdout=None and the AttributeError below killed g-t15400-4's loop (PR #739, 2026-11-10).
        log = subprocess.run([tool("gh"), "run", "view", str(run_id), "--log-failed"],
                             capture_output=True, text=True, encoding="utf-8", errors="replace",
                             check=False).stdout or ""
    except (OSError, subprocess.SubprocessError, ValueError, StopIteration, KeyError) as exc:
        return f"Could not fetch the Branch CI run for {head[:9]} ({exc}); run `gh run list --branch {branch}`."
    tail = "\n".join(log.splitlines()[-log_lines:])
    return f"Run {run_id}, failed jobs: {', '.join(failed) or 'unknown'}.\nLast {log_lines} failed-step log lines:\n{tail}"


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


# A freshly started Vite dev server compiles each module on its first request, and the verifier's own
# browser and tests run beside it: on g-t15340-1 (2026-11-09) /api/health kept aborting and a cold load of
# `/` reached its play 15-45 s late, so verifiers read /home, investigated, and passed the 15-minute cap.
# One signed-in page load before the round pays the compile cost outside every verifier's budget.
WARM_STACK_SCRIPT = (
    "const {chromium} = require('/workspace/src/frontend/node_modules/@playwright/test');"
    "(async () => { const b = await chromium.launch(); const p = await b.newPage();"
    " await p.goto('http://localhost:5173/?dev_account=full', {timeout: 180000});"
    " await p.waitForLoadState('networkidle', {timeout: 180000}); await b.close(); })()"
    ".catch(e => { console.error(String(e).slice(0, 300)); process.exit(1); });")
WARM_STACK_SECONDS = 240


def warm_stack(slug):
    """Load the signed-in app once so Vite has compiled it before the first verifier starts. Never
    raises: a failed warm-up only means the first verifier pays the compile cost."""
    started = time.time()
    try:
        result = subprocess.run([tool("docker"), "exec", cname(slug), "node", "-e", WARM_STACK_SCRIPT],
                                capture_output=True, text=True, timeout=WARM_STACK_SECONDS)
        outcome = "ok" if result.returncode == 0 else f"failed: {result.stderr.strip()[:300]}"
    except (OSError, subprocess.SubprocessError) as exc:
        outcome = f"failed: {exc}"
    print(f"[dotask] stack warm-up {outcome} ({time.time() - started:.0f}s)", file=sys.stderr)


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

    title = ", ".join(group["tasks"]) + ": " + task_title(task_file_in(checkout, group["tasks"][0]))
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
    if verdict == "failure" and getattr(args, "fix_on_red", False):
        return CI_RED  # autoland turns the failed jobs into a fix round; evidence waits for a green head

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
# Worker-written checks (owner decision 2026-11-09). One fresh verifier per criterion still passed the 15-minute
# cap on most criteria (g-t15340-1: 9 of 12), mostly rebuilding Playwright setup the worker already had. So the
# worker who knows the code commits one check per criterion under CHECKS_DIR, the harness runs every check
# itself (no agent), and ONE reviewer per round reads each check against its criterion's text and flags a
# weak or missing one. Verification shares one budget per group; when it is spent the PR opens and lists
# what is unverified. The real gate is the staging check after merge, which runs the same checks.
CHECKS_DIR = "src/frontend/e2e/checks"
CHECK_KINDS = ("browser", "code", "human")
VERIFY_BUDGET_MINUTES = float(os.environ.get("DOTASK_VERIFY_BUDGET_MIN", "30"))
CHECK_COMMAND_SECONDS = 300  # one `code` check: a grep or a targeted test run
CHECK_SPEC_SECONDS = 900  # one task's browser checks in one Playwright run
BUDGET_SPENT = "not verified: the group's verify budget was spent (owner rule 2026-11-09)"
RECHECK_NOTE = ("This is a re-check after fix round {fix_round}; criteria not named here passed on the previous "
                "HEAD and carry forward. ")
# A fixer that disputed a finding stopped the whole loop as VERIFY_BLOCKED, and the owner had to rule on
# a flake by hand (g-t14940-1, 2026-11-08). The dispute now goes to a fresh reviewer first; only a
# finding the reviewer still upholds after reading the dispute reaches the owner.
DISPUTE_STEP = (" The fix worker disputed these findings instead of fixing them; re-examine each one fresh, deferring "
                "to neither side. Keep a finding only if you reproduce it on this HEAD; one that also happens on "
                "origin/master is an `unrelated` bug (run it there before deciding). Disputes: {disputes}")
BUGS_STEP = ("Re-run the steps of each of these bugs and list any still present under `bugs` with the same title "
             "(a fixed bug gets no entry): {titles}. ")
NO_BUGS_STEP = "Report a bug only if you see one while reading; there is no separate regression pass."
VERIFY_STATUSES = ("pass", "fail", "human")
BUG_SCOPES = ("group", "unrelated")
ACCEPTANCE_ITEM = re.compile(r"^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]")
# A top-level list item with no checkbox. About 30 TODO/WIP task files write their criteria this way;
# they parsed as zero items, so autoland invented one textless C1 and crashed indexing its text
# (g-t15380-1, 2026-11-09). Plain items count only when the section has no checkbox items at all.
ACCEPTANCE_PLAIN_ITEM = re.compile(r"^(?:[-*]|\d+\.)\s+")
BUG_SECTION = "### Bugs found by /dotask verify"
PLAN_TAIL_HEADING = "## Environment Configuration"
REVIEW_INSTRUCTION = """You review the acceptance checks of this group, verify round {round}. You did not write this code or these checks.
Do NOT edit tracked files, commit, or change qa/proof.json. Scripts of your own go under /tmp. HEAD is {head}.

The worker committed one check per acceptance criterion: `{checks_dir}/T<id>.checks.json` names each criterion's kind (`browser`: the test titled with its id in `{checks_dir}/T<id>.check.spec.js`; `code`: a shell command; `human`), and the harness has already run every check on this HEAD against the app stack (http://localhost:5173, backend :8000). Your job is to judge each check against its criterion, not to re-test the app.

1. {recheck}For each criterion below, read its check and the criterion's text in the task file under docs/plans/tasks.
   A check is `pass` only if it passed AND it would fail were the criterion false: it drives the real app (or the real code) the way the criterion says and asserts what the text says.
   A passing check that is weak is `fail`, with what it misses in the evidence: it asserts less than the text, mocks or stubs the behavior under test, sets up through a back door state the criterion says a user creates (an API POST where the text says the app writes it), or would pass on broken code.
   A failed or missing check is `fail`: restate its error. `human` only for what no automation can observe (a real card payment, a physical phone).
{criteria}
2. {bugs}
3. Read, don't explore. Run a check yourself only to settle a doubt, in the foreground with an explicit timeout (`bash scripts/dev-verify.sh e2e/checks/<file> --reporter=line --grep '<id>'`). You have {minutes:.0f} minutes in all.

Write /workspace/.dotask-verify.json, exactly, with every criterion above listed once:
{{"head": "{head}",
  "criteria": [{{"id": "T1:C1", "status": "pass|fail|human", "evidence": "why the check proves it, or what it misses"}}],
  "bugs": [{{"scope": "group|unrelated", "task": "T1", "title": "...", "steps": "...", "expected": "...", "actual": "..."}}]}}
A bug's scope is `group` if this branch caused it and `unrelated` if master has it too: check before deciding.
Then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} {head} verify round {round} review` to /workspace/.dotask-status and stop. If you cannot read the checks at all, append `BLOCKED <reason>` instead."""
# A fix round is one dispatch per owning task: fix, commit, next. One worker given every finding went
# straight to the hardest (T15220's export race), ran out of turns three times and committed nothing,
# so three finished fixes sat uncommitted for three hours (g-t15220-10, 2026-11-07).
FIX_INSTRUCTION = """Independent verification of {head} found problems, listed in /workspace/.dotask-verify.json. This dispatch fixes ONLY {scope}: {items}. Every other finding in that file gets its own dispatch after this one: do not touch it. All tasks already have commits, so do not start a new one.
Before your first code edit, append a `## {label} progress` checklist to .dotask-notes.md with one line per finding above (unless one with that exact heading is already there: then continue it), and tick each line as it is fixed: a dispatch can run out of turns, and the next worker resumes from that list. A progress checklist under any other heading is from another task or round: ignore it.
Fix each finding at its root, failing test first. A finding that a criterion's check is missing or weak is fixed by writing or strengthening that check in {checks_dir} (the kickoff's Checks rule) until it fails on broken code and passes on yours; a failing check means the code is wrong, not the check, unless you can show otherwise. Re-run only the tests that failed and the ones you wrote; a test that already passed on this code stays passed and is not run again (user rule, 2026-11-07). Lint the files you changed. Commit with explicit paths, subject `{subject}: fix <what>`, ending with the Co-Authored-By line from the kickoff. Append what a later fix round needs to .dotask-notes.md. If you changed a test named in qa/proof.json, update its entry (new red and green logs, new sha256), or landing cannot build the evidence.
A finding you believe is wrong (this branch did not cause it, it is a flake, or the verifier misread the criterion): do not work around it, and never edit a task file's Acceptance Criteria to make one pass: they are the user's. Commit any finished fix first, then append `<UTC yyyy-mm-ddTHH:MM> DISPUTED {label} <finding id or bug title>: <your evidence: what you ran on this branch and on origin/master, and what you saw>` to /workspace/.dotask-status and stop. A fresh verifier re-examines it with your evidence. Append `BLOCKED <reason>` only if you cannot work at all.
Otherwise run `bash scripts/dotask_preland_check.sh`, then append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY {branch} <new sha> {label}` to /workspace/.dotask-status and stop."""


class UntrustedVerdict(Exception):
    pass


def task_file_in(checkout, task_id):
    """The group branch's copy of a task file, falling back to master's. Rulings and amended criteria are
    committed on the branch, so reading master missed them: T14860's "verify on staging" ruling still
    stopped autoland (g-t15220-10, 2026-11-07). The branch is searched first, so another session's
    uncommitted file in the shared main checkout cannot collide with it (g-t15340-1, 2026-11-09: an
    untracked T15360-mobile-*.md next to the committed T15360 task)."""
    own = task_file_matches(checkout, task_id)
    if len(own) == 1:
        return own[0]
    main = resolve_task_file(task_id)
    try:
        branch_copy = Path(checkout) / main.relative_to(MAIN_REPO)
    except ValueError:
        return main
    return branch_copy if branch_copy.is_file() else main


def acceptance_lines(task_file):
    """The lines of a task file's `## Acceptance...` section(s)."""
    lines, inside = [], False
    for line in Path(task_file).read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside = line.lower().startswith("## acceptance")
        elif inside:
            lines.append(line)
    return lines


def acceptance_item_pattern(task_file):
    """Checkbox items when the Acceptance section has any, else its top-level plain list items."""
    if any(ACCEPTANCE_ITEM.match(line) for line in acceptance_lines(task_file)):
        return ACCEPTANCE_ITEM
    return ACCEPTANCE_PLAIN_ITEM


def acceptance_items(task_file):
    """The items of a task file's Acceptance Criteria, in order, as their text (see acceptance_item_pattern)."""
    pattern = acceptance_item_pattern(task_file)
    return [pattern.sub("", line).strip() for line in acceptance_lines(task_file) if pattern.match(line)]


def acceptance_count(task_file):
    """Checkbox items in a task file's Acceptance Criteria: the floor a verdict must cover."""
    return len(acceptance_items(task_file))


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
        need = max(1, acceptance_count(task_file_in(checkout, task_id)))
        have = sum(1 for item in criteria if str(item.get("id", "")).startswith(f"{task_id}:"))
        if have < need:
            raise UntrustedVerdict(f"{task_id}: verdict covers {have} of {need} criteria")
    return verdict


def tracked_changes(checkout):
    # rstrip, never strip: porcelain's first column is a space for an unstaged change, and stripping it
    # shifted the first path by one character, so " D qa/x.log" read as "a/x.log" and escaped the
    # TOOL_NOISE rule (g-t15260-1, 2026-11-08: "verifier changed the tree: D qa/red-...log").
    return subprocess.run([tool("git"), "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"],
                          capture_output=True, text=True, check=True).stdout.rstrip()


# What a verifier's own tooling rewrites without editing code: `npm install` churns package-lock.json and
# a landing build writes logs under qa/. Either one blocked a clean verdict as "verifier changed the tree"
# (g-t15280-3 and g-t14930-3, 2026-11-08). They are put back and the rest of the check stands.
TOOL_NOISE = (re.compile(r"(^|/)package-lock\.json$"), re.compile(r"^qa/"))


def porcelain_path(line):
    path = line[3:].strip()
    return path.split(" -> ")[-1].strip('"')


def split_tool_noise(changes):
    """(noise paths, the porcelain lines that are real edits) from `git status --porcelain` output."""
    noise, real = [], []
    for line in filter(str.strip, changes.splitlines()):
        path = porcelain_path(line)
        if any(pattern.search(path) for pattern in TOOL_NOISE):
            noise.append(path)
        else:
            real.append(line)
    return noise, "\n".join(real)


def restore_tool_noise(checkout, paths):
    if paths:
        subprocess.run([tool("git"), "-C", str(checkout), "checkout", "--", *paths],
                       capture_output=True, text=True, check=False)
        print(f"[dotask] put back tool output the verifier rewrote: {' '.join(paths)}", file=sys.stderr)


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

# Owner rule 2026-11-08: a verifier has a hard wall-clock cap, and one that does not come back in time
# is skipped, not waited on. g-t15240-2's single verify batch ran over two hours that day. The cap was 10
# minutes until 2026-11-09, when 5 of g-t15340-1's 8 one-criterion verifiers passed it (a cold load or a
# sign-out and back in takes longer to set up); the owner raised it to 15.
# Its criteria land as `skipped` and the PR body lists them as not verified. DOTASK_VERIFY_TIMEOUT_MIN
# overrides the cap.
VERIFY_TIMEOUT_MINUTES = float(os.environ.get("DOTASK_VERIFY_TIMEOUT_MIN", "15"))
PHASE_TIMEOUT_MINUTES = {"qa": VERIFY_TIMEOUT_MINUTES}


class DispatchTimedOut(Exception):
    """A dispatch passed its phase's wall-clock cap and was killed."""


# The container has no ps or pkill. The loop skips its own shell, whose command line names the pattern.
KILL_DISPATCH_SCRIPT = (r'for p in /proc/[0-9]*; do n=${p#/proc/}; [ "$n" = "$$" ] && continue; '
                        r'c=$(tr "\0" " " < "$p/cmdline" 2>/dev/null); '
                        r'case "$c" in *dotask-wave-profile*|*claude*) kill -9 "$n" 2>/dev/null;; esac; done')


def stop_dispatch(slug, process):
    """Kill a timed-out dispatch on both sides: the host process tree (task.sh, docker exec) and the
    `claude -p` run inside the container, which outlives a killed `docker exec`."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False)
    else:
        process.kill()
    with contextlib.suppress(subprocess.SubprocessError):
        process.wait(timeout=30)
    with contextlib.suppress(OSError, subprocess.SubprocessError, SystemExit):
        subprocess.run([tool("docker"), "exec", cname(slug), "bash", "-c", KILL_DISPATCH_SCRIPT],
                       capture_output=True, check=False, timeout=60)


def dispatch(slug, group, phase, instruction, task_ids=None, cap_minutes=None):
    """One fresh `claude -p` in the group's container. True only if it ended on PUSHREADY. `task_ids`
    names the task(s) this dispatch is for (the profile records it; default: the whole group).
    `cap_minutes` overrides the phase's wall-clock cap (the reviewer gets what is left of the budget)."""
    env = {**os.environ, "MAIN_REPO": bash_path(MAIN_REPO), "TASKS_ROOT": bash_path(TASKS_ROOT),
           "DOTASK_WAVE_ID": group["wave_id"], "DOTASK_PHASE": phase,
           "DOTASK_TASK_IDS": ",".join(task_ids or group["tasks"])}
    if "DOTASK_MAX_TURNS" not in os.environ and phase in PHASE_MAX_TURNS:
        env["DOTASK_MAX_TURNS"] = str(PHASE_MAX_TURNS[phase])
    process = subprocess.Popen([bash(), (REPO_ROOT / "scripts" / "task.sh").as_posix(), "drive", slug, instruction],
                               env=env)
    cap = cap_minutes if cap_minutes is not None else PHASE_TIMEOUT_MINUTES.get(phase)
    try:
        returncode = process.wait(timeout=cap * 60 if cap else None)
    except subprocess.TimeoutExpired:
        stop_dispatch(slug, process)
        raise DispatchTimedOut(f"{phase} dispatch passed its {cap:g}-minute cap") from None
    return returncode == 0 and " PUSHREADY " in last_status(TASKS_ROOT / sanitize(slug))


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


AUTH_RETRIES = int(os.environ.get("DOTASK_AUTH_RETRIES", "2"))
AUTH_RETRY_WAIT_S = int(os.environ.get("DOTASK_AUTH_RETRY_WAIT", "20"))


def auth_lost(checkout):
    return latest_run(checkout).get("outcome_class") == "auth_failed"


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
    attempt = auth_retries = 0
    while True:
        text = instruction + (RESUME_HINT if attempt or auth_retries else "")
        if task_ids is None:
            finished = dispatch(slug, group, "implementation", text)
        else:
            finished = dispatch(slug, group, "implementation", text, task_ids)
        if auth_lost(checkout) and auth_retries < AUTH_RETRIES:
            # A token refresh anywhere on the host revokes the token every container copied, mid-dispatch:
            # g-t15400-4 and g-t15410-4 died the same second the host refreshed (2026-11-09 00:46 UTC)
            # and their CLIs wrote back an empty credentials file. The next `task.sh drive` force-copies
            # the host's current login, so redispatching is the whole fix.
            auth_retries += 1
            handoff_note(checkout, label, latest_run(checkout))
            append_status(checkout, f"RESUMED {label} auth retry {auth_retries} of {AUTH_RETRIES}: credentials "
                                    "revoked mid-dispatch (host token refresh); re-seeding from the host login")
            time.sleep(AUTH_RETRY_WAIT_S)
            continue
        if not out_of_turns(checkout) or attempt == BUILD_RETRIES:
            break
        attempt += 1
        handoff_note(checkout, label, latest_run(checkout))
        append_status(checkout, f"RESUMED {label} dispatch {attempt + 1} of {BUILD_RETRIES + 1}: ran out of turns, "
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


# One driver per group. A launch that looked dead was relaunched while the first still ran, and two
# autolands raced on one checkout (g-t14930-3, 2026-11-08). The lock names its process; one whose
# process is gone is stale and taken over.
RUN_LOCK = ".dotask-run.lock"


def pid_alive(pid):
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)  # signal 0 only checks; on Windows os.kill would terminate, hence the branch above
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@contextlib.contextmanager
def run_lock(checkout, slug):
    if not Path(checkout).is_dir():  # the action itself reports the unknown group
        yield
        return
    path = Path(checkout) / RUN_LOCK
    exclude = Path(checkout) / ".git" / "info" / "exclude"
    if exclude.parent.is_dir() and RUN_LOCK not in (exclude.read_text(encoding="utf-8") if exclude.exists() else ""):
        with exclude.open("a", encoding="utf-8") as stream:
            stream.write(RUN_LOCK + "\n")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M")
    for _ in range(2):
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                holder = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                holder = {}
            if pid_alive(int(holder.get("pid") or 0)):
                die(f"{slug} is already being driven by process {holder['pid']} (since {holder.get('since', '?')}); "
                    f"watch its run.log instead of starting a second one. If that process is not dotask, delete {path}.")
            print(f"[dotask] taking over a stale lock from process {holder.get('pid', '?')}", file=sys.stderr)
            path.unlink(missing_ok=True)
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"pid": os.getpid(), "since": stamp}, stream)
        break
    try:
        yield
    finally:
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("pid") == os.getpid():
                path.unlink()
        except (OSError, ValueError):
            pass


def locked(action):
    """Wrap a resume/autoland entry point so the whole run holds the group's lock (resume calls autoland
    and land inside it; those inner calls go to the unwrapped functions)."""
    def run(args):
        with run_lock(TASKS_ROOT / sanitize(args.slug), args.slug):
            return action(args)
    return run


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
        # scratch and block on it (g-t15220-10, 2026-11-07), so the round continues first (tasks whose
        # fix already committed are skipped); once it commits, autoland's resume_focus picks up the
        # focused re-check.
        print(f"[dotask] fix round {fix_round} stopped with uncommitted work; continuing it")
        verdict = json.loads((checkout / VERIFY_FILE).read_text(encoding="utf-8"))
        fixed, skipped, disputed = run_fix_round(slug, group, checkout, fix_round, verdict, resuming=True)
        if disputed:
            group["disputes"] = disputed
            save_group(checkout, group)
        if not fixed and not disputed:
            append_status(checkout, f"VERIFY_BLOCKED fix round {fix_round} committed nothing on resume"
                                    f" (skipped: {' '.join(skipped) or 'none'})")
            return 1
    return autoland(SimpleNamespace(slug=slug, no_land=args.no_land))


def fix_units(group, verdict):
    """The round's findings grouped by owning task, in group order: [(task or None, [criterion ids],
    [bug titles])]. Findings no task in the group owns (a preland failure, a bug without a task) come
    last as one unit."""
    units = {}
    for item in verdict.get("criteria", []):
        if item.get("status") == "fail":
            task = str(item.get("id", "")).split(":")[0]
            units.setdefault(task if task in group["tasks"] else None, ([], []))[0].append(str(item["id"]))
    for bug in verdict.get("bugs", []):
        if bug.get("scope") == "group":
            task = bug.get("task")
            units.setdefault(task if task in group["tasks"] else None, ([], []))[1].append(str(bug["title"]))
    order = [t for t in group["tasks"] if t in units] + ([None] if None in units else [])
    return [(task, *units[task]) for task in order]


def stash_unfinished(checkout, label):
    """Park a skipped task's uncommitted changes so the next task and the verifier see a clean tree;
    the work stays in `git stash list` under the label."""
    if not tracked_changes(checkout):
        return None
    subprocess.run([tool("git"), "-C", str(checkout), "stash", "push", "-m", f"dotask: unfinished {label}"],
                   capture_output=True, text=True, check=False)
    return f"stashed as 'dotask: unfinished {label}'"


def run_fix_round(slug, group, checkout, round_number, verdict, resuming=False):
    """One dispatch per owning task: fix, commit, next. A task whose dispatch commits nothing is recorded
    (FIX_SKIPPED), its leftover changes stashed, and the round moves on: one hard finding cannot block
    the others. A task whose `PUSHREADY ... fix round N T<id>` line is already in the status file was
    fixed before a restart and is not dispatched again. A worker that ends on `DISPUTED <label> ...` instead
    of fixing is neither: its dispute goes to the next verifier. Returns ([fixed labels], [skipped labels],
    [disputes as {task, items, reason}])."""
    fixed, skipped, disputed = [], [], []
    head = git_head(checkout)
    dirty_from_before = resuming and bool(tracked_changes(checkout))
    for task, criteria, bugs in fix_units(group, verdict):
        name = task or "other"
        label = f"fix round {round_number} {name}"
        status_path = Path(checkout) / ".dotask-status"
        lines = status_path.read_text(encoding="utf-8").splitlines() if status_path.is_file() else []
        if any(" PUSHREADY " in line and line.rstrip().endswith(label) for line in lines):
            continue
        items = "; ".join([*criteria, *(f"bug: {title}" for title in bugs)])
        scope = f"{task}'s findings" if task else "the findings no single task owns"
        instruction = FIX_INSTRUCTION.format(head=head, scope=scope, items=items, label=label, checks_dir=CHECKS_DIR,
                                             subject=task or "<owning task id>", branch=group["branch"])
        if dirty_from_before:
            # Changes left by the interrupted dispatch may belong to any task: the first worker sorts them.
            handoff_note(checkout, label, latest_run(checkout))
            instruction += RESUME_HINT + " Commit only this task's part of it; leave the rest for later dispatches."
            dirty_from_before = False
        before = git_head(checkout)
        finished = dispatch_with_restarts(slug, group, checkout, label, instruction,
                                          task_ids=[task] if task else None)
        if finished and git_head(checkout) != before:
            fixed.append(name)
            continue
        last = last_status(checkout)
        if f" DISPUTED {label} " in f"{last} ":
            reason = last.split(f" DISPUTED {label}", 1)[1].strip()
            disputed.append({"task": name, "items": [*criteria, *bugs], "reason": reason[:1500]})
            if git_head(checkout) != before:
                fixed.append(name)  # a dispute after a committed partial fix: both stand
            stash_unfinished(checkout, label)
            continue
        skipped.append(name)
        parked = stash_unfinished(checkout, label)
        append_status(checkout, f"FIX_SKIPPED {label}: {'no commit' if finished else last_status(checkout)[:160]}"
                                + (f"; {parked}" if parked else ""))
    return fixed, skipped, disputed


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


def file_unrelated_bug(bug, group, head, found_by=None):
    """A bug this branch did not cause must not hold its PR up: file it as a TODO task instead. The
    staging check files its failures the same way, with `found_by` saying so. Returns the new id, or None
    if PLAN.md already names that title."""
    plan_path = MAIN_REPO / "docs" / "plans" / "PLAN.md"
    plan = plan_path.read_bytes().decode("utf-8")
    title = " ".join(str(bug["title"]).replace("|", "/").split())
    if f"[{title}](" in plan:
        return None
    tasks_dir = MAIN_REPO / "docs" / "plans" / "tasks"
    used = [int(found.group(1)) for found in (re.match(r"T(\d+)", p.name) for p in tasks_dir.rglob("T*.md")) if found]
    used += [int(n) for n in re.findall(r"^\| T(\d+) \|", plan, flags=re.M)]  # a row whose file is elsewhere
    task_id = f"T{(max(used, default=0) // 10 + 1) * 10}"
    name = f"{task_id}-{'-'.join(re.findall(r'[a-z0-9]+', title.lower())[:6])}.md"
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    write_lf(tasks_dir / name, (
        f"# {task_id}: {title}\n\n**Status:** TODO\n**Impact:** 5\n**Complexity:** 3\n**Created:** {today}\n"
        f"**Updated:** {today}\n\n## Problem\n\n"
        + (f"Found by {found_by} (group {group['slug']}, {head[:9]}). " if found_by else
           f"Found by the /dotask verifier on group {group['slug']} at {head[:9]}, which judged it unrelated to "
           "that branch. ")
        + "Impact and complexity are unscored defaults.\n\n"
        f"**Steps:** {bug.get('steps', 'not recorded')}\n\n**Expected:** {bug.get('expected', 'not recorded')}\n\n"
        f"**Actual:** {bug.get('actual', 'not recorded')}\n\n## Acceptance Criteria\n\n- [ ] The steps above give the "
        f"expected result.\n\n## Context\n\n### Relevant Files (REQUIRED)\n\n- To be found.\n"))

    newline = "\r\n" if "\r\n" in plan else "\n"
    source = "staging check" if found_by else "verify"
    row = f"| {task_id} | [{title}](tasks/{name}) | 5 | 3 | 1.7 | TODO | [ ] | Filed by /dotask {source}. |"
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
    plan_was_dirty = git_paths_dirty(MAIN_REPO, [plan_path])
    plan_path.write_bytes(newline.join(lines).encode("utf-8"))
    commit_filed_bug(task_id, title, [plan_path, tasks_dir / name], plan_was_dirty)
    return task_id


def git_paths_dirty(repo, paths):
    result = subprocess.run([tool("git"), "-C", str(repo), "status", "--porcelain", "--", *map(str, paths)],
                            capture_output=True, text=True, check=False)
    return result.returncode != 0 or bool(result.stdout.strip())


def commit_filed_bug(task_id, title, paths, plan_was_dirty):
    """Commit the filed task (its file and PLAN row, nothing else) to master in the main checkout at once.
    Left uncommitted, another session took the same id by hand (T15300, 2026-11-08) and a later
    plan commit swept the filed file in under an unrelated subject. A PLAN.md that already held
    someone's uncommitted edit is left alone: committing it would publish their half-done change."""
    repo = str(MAIN_REPO)
    branch = subprocess.run([tool("git"), "-C", repo, "rev-parse", "--abbrev-ref", "HEAD"],
                            capture_output=True, text=True, check=False)
    why = None
    if branch.returncode != 0:
        why = "the main checkout is not a git repository"
    elif branch.stdout.strip() != "master":
        why = f"the main checkout is on {branch.stdout.strip()}, not master"
    elif plan_was_dirty:
        why = "PLAN.md already had uncommitted edits"
    if why is None:
        subprocess.run([tool("git"), "-C", repo, "add", "--", *map(str, paths)], capture_output=True, check=False)
        done = subprocess.run([tool("git"), "-C", repo, "commit", "-m",
                               f"{task_id}: file {title} (found by /dotask verify)", "--", *map(str, paths)],
                              capture_output=True, text=True, check=False)
        if done.returncode == 0:
            print(f"[dotask] committed {task_id} to master in {repo} (not pushed)")
            return True
        why = f"git commit failed: {(done.stderr or done.stdout).strip()[:200]}"
    print(f"WARNING: filed {task_id} but did not commit it ({why}); commit its task file and PLAN row "
          "before anyone else takes an id", file=sys.stderr)
    return False


def criterion_ids(checkout, task_id):
    return [f"{task_id}:C{i + 1}" for i in range(max(1, acceptance_count(task_file_in(checkout, task_id))))]


def criterion_line(checkout, criterion):
    """A criterion id's text from its task file, or "" when the file has fewer items than the id."""
    task_id, number = criterion.split(":C")
    items = acceptance_items(task_file_in(checkout, task_id))
    return items[int(number) - 1] if int(number) <= len(items) else ""


def check_manifest(checkout, task_id):
    """{criterion id: {"kind": browser|code|human, ...}} from the task's committed checks file ({} if none)."""
    path = Path(checkout) / CHECKS_DIR / f"{task_id}.checks.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    criteria = data.get("criteria") if isinstance(data, dict) else None
    if isinstance(criteria, list):  # [{"id": "T1:C1", "kind": ...}]: g-t15370-1 lost two rounds reading it as {}
        criteria = {entry["id"]: entry for entry in criteria if isinstance(entry, dict) and entry.get("id")}
    return {str(k): v for k, v in criteria.items() if isinstance(v, dict)} if isinstance(criteria, dict) else {}


def container_run(slug, command, timeout, env=None, keep=2000):
    """(exit code or None on timeout, output) of a bash command in the group's container: the last
    `keep` chars, or all of it with keep=None (a file read back, e.g. a Playwright JSON report)."""
    argv = [tool("docker"), "exec"] + [f"-e{k}={v}" for k, v in (env or {}).items()] + [cname(slug), "bash", "-lc", command]
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, f"timed out after {timeout:.0f}s"
    except OSError as exc:
        return 1, str(exc)
    output = result.stdout + result.stderr
    return result.returncode, output[-keep:] if keep else output


def playwright_outcomes(report):
    """{spec title: (ok, first error line)} from a Playwright JSON report, every nested suite included."""
    found = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            error = ""
            for test in spec.get("tests", []):
                for result in test.get("results", []):
                    message = ((result.get("error") or {}).get("message") or "").strip()
                    if message and not error:
                        error = message.splitlines()[0][:400]
            found[spec.get("title", "")] = (bool(spec.get("ok")), error)
        for child in suite.get("suites", []):
            walk(child)
    for suite in report.get("suites", []):
        walk(suite)
    return found


def check_location(task_id, entry):
    if entry.get("kind") == "browser":
        return f"{CHECKS_DIR}/{task_id}.check.spec.js"
    if entry.get("kind") == "code":
        return f"command `{str(entry.get('command', ''))[:300]}`"
    return "declared human"


def run_browser_checks(slug, task_id, ids, timeout, staging=None):
    """{id: (status, detail)} for one task's browser checks, run in one Playwright process inside the
    container: against the group's stack via dev-verify.sh, or against `staging` ({"url", "api", "email"})."""
    report_path = f"/tmp/dotask-check-{task_id}.json"
    grep = "|".join(re.escape(i) for i in ids)
    spec = f"e2e/checks/{task_id}.check.spec.js"
    env = {"PLAYWRIGHT_JSON_OUTPUT_NAME": report_path}
    if staging:
        env.update({"E2E_BASE_URL": staging["url"], "E2E_API_BASE": staging["api"], "E2E_CHECK_EMAIL": staging["email"]})
        command = f"cd /workspace/src/frontend && npx playwright test {spec} --reporter=json --grep '{grep}'"
    else:
        command = f"cd /workspace && bash scripts/dev-verify.sh {spec} --reporter=json --grep '{grep}'"
    code, output = container_run(slug, f"rm -f {report_path}; {command}", timeout, env)
    if code is None:
        return {i: ("skipped", f"browser checks {output}") for i in ids}
    # keep=None: g-t15370-1's 16 KB report was cut to its last 2000 chars, and 9 passing tests read as fail.
    _code, raw = container_run(slug, f"cat {report_path}", 60, keep=None)
    try:
        outcomes = playwright_outcomes(json.loads(raw))
    except ValueError:
        return {i: ("fail", f"no Playwright report (exit {code}): {output[-600:]}") for i in ids}
    results = {}
    for criterion in ids:
        mine = [(ok, err) for title, (ok, err) in outcomes.items()
                if re.search(rf"(^|\W){re.escape(criterion)}(\W|$)", title)]
        if not mine:
            results[criterion] = ("missing", f"no test titled with {criterion} in {spec}")
        elif all(ok for ok, _ in mine):
            results[criterion] = ("pass", f"{len(mine)} test(s) passed")
        else:
            results[criterion] = ("fail", next(err for ok, err in mine if not ok) or "test failed")
    return results


def run_checks(slug, checkout, group, wanted, deadline):
    """{criterion id: {"status": pass|fail|missing|human|skipped, "where", "detail"}}: every check the
    worker committed for `wanted`, run by the harness itself (no agent). Past `deadline` the rest are
    skipped."""
    results = {}
    by_task = {}
    for criterion in wanted:
        by_task.setdefault(criterion.split(":")[0], []).append(criterion)
    for task_id, ids in by_task.items():
        manifest = check_manifest(checkout, task_id)
        browser = []
        for criterion in ids:
            entry = manifest.get(criterion)
            if not entry or entry.get("kind") not in CHECK_KINDS:
                results[criterion] = {"status": "missing", "where": f"{CHECKS_DIR}/{task_id}.checks.json",
                                      "detail": "no check declared for this criterion"}
                continue
            where = check_location(task_id, entry)
            left = deadline - time.time()
            if entry["kind"] == "human":
                results[criterion] = {"status": "human", "where": where, "detail": str(entry.get("why", ""))[:300]}
            elif entry.get("defer_to_staging"):
                # Owner ruling recorded in the task file: this browser check runs only after merge, on
                # staging (`staging-check` still runs it, since its kind stays browser). T15410:C1
                # (g-t15410-4, 2026-11-09) failed only because the container's dev server took ~10 s
                # to serve its own index.html under host load.
                results[criterion] = {"status": "human", "where": where,
                                      "detail": "deferred to the staging check by owner ruling: "
                                                + str(entry.get("defer_to_staging"))[:280]}
            elif left <= 0:
                results[criterion] = {"status": "skipped", "where": where, "detail": BUDGET_SPENT}
            elif entry["kind"] == "code":
                code, output = container_run(slug, f"cd /workspace && {entry.get('command', 'false')}",
                                             min(CHECK_COMMAND_SECONDS, left))
                status = "skipped" if code is None else "pass" if code == 0 else "fail"
                results[criterion] = {"status": status, "where": where,
                                      "detail": "exit 0" if status == "pass" else f"exit {code}: {output[-600:]}"}
            else:
                browser.append(criterion)
                results[criterion] = {"status": "skipped", "where": where, "detail": BUDGET_SPENT}
        left = deadline - time.time()
        if browser and left > 0:
            for criterion, (status, detail) in run_browser_checks(slug, task_id, browser,
                                                                   min(CHECK_SPEC_SECONDS, left)).items():
                results[criterion].update(status=status, detail=detail)
    return results


def budget_left_minutes(group):
    return VERIFY_BUDGET_MINUTES - group.get("verify_spent_s", 0) / 60


def spend_budget(group, checkout, seconds):
    group["verify_spent_s"] = group.get("verify_spent_s", 0) + seconds
    save_group(checkout, group)


def review_checks(slug, group, checkout, head, round_number, wanted, results, bugs, disputes, focus, minutes):
    """One reviewer dispatch for the round. Returns its verdict, or None if it passed its time or turns
    (what it was to judge then lands unverified). Raises UntrustedVerdict for a verdict it cannot use."""
    lines = "\n".join(f"   - {c}: {criterion_line(checkout, c)!r}. Check: {results[c]['where']}. "
                      f"Result: {results[c]['status']} ({results[c]['detail'][:300]})" for c in wanted)
    bugs_step = BUGS_STEP.format(titles="; ".join(
        f"{b['title']} (steps: {str(b.get('steps') or 'see the title')[:3000]})" for b in bugs)) if bugs else NO_BUGS_STEP
    if disputes:
        bugs_step += DISPUTE_STEP.format(disputes="; ".join(f"[{', '.join(d['items'])}] {d['reason']}" for d in disputes))
    instruction = REVIEW_INSTRUCTION.format(
        round=round_number, head=head, branch=group["branch"], checks_dir=CHECKS_DIR, criteria=lines, bugs=bugs_step,
        minutes=minutes, recheck=RECHECK_NOTE.format(fix_round=round_number - 1) if focus else "")
    finished = timed_out = False
    for attempt in range(VERIFY_ATTEMPTS):
        (checkout / VERIFY_FILE).unlink(missing_ok=True)
        try:
            finished = dispatch(slug, group, "qa", instruction, cap_minutes=minutes)
        except DispatchTimedOut:
            timed_out = True
            break
        # A transport failure (g-t15220-10, 2026-11-07: ENOTFOUND 7 minutes in) says nothing about the code.
        # A reviewer that wrote a BLOCKED status line instead of a verdict file also gets another go:
        # g-t15440-4 (2026-11-10) stopped the whole group that way, though the BLOCKED text itself named
        # two real failing criteria that the next review would have recorded as a verdict.
        retryable = "outcome=error" in last_status(checkout) or " BLOCKED " in last_status(checkout)
        if finished or not retryable or tracked_changes(checkout):
            break
        print(f"[dotask] reviewer dispatch errored or wrote BLOCKED (attempt {attempt + 1}); retrying", file=sys.stderr)
    ran_out = not finished and not timed_out and out_of_turns(checkout)
    noise, changed = split_tool_noise(tracked_changes(checkout))
    restore_tool_noise(checkout, noise)
    if git_head(checkout) != head or changed:
        raise UntrustedVerdict(f"reviewer changed the tree: {git_head(checkout)[:9]} {changed[:200]}")
    if timed_out or ran_out:
        why = f"passed its {minutes:.0f}-minute share of the budget" if timed_out else "ran out of turns"
        append_status(checkout, f"VERIFY_SKIPPED round {round_number} review: reviewer {why}; passing checks not reviewed")
        return None
    if not finished:
        raise UntrustedVerdict(f"reviewer did not finish: {last_status(checkout)[:200]}")
    verdict = read_verdict(checkout, group, head, criteria_ids=wanted)
    verdict["criteria"] = [c for c in verdict["criteria"] if str(c.get("id")) in wanted]
    return verdict


def verify_once(slug, group, checkout, head, round_number, focus=None):
    """The harness runs every check the worker committed for this round's criteria (all of them, or after
    a fix round only `focus`: the failed and skipped ones), then ONE reviewer judges each check against its
    criterion. Everything shares the group's verify budget; past it, what is left is `skipped`. A failed or
    missing check is a `fail` whatever the reviewer says. Returns the merged verdict, which lists every
    criterion (re-checked ones fresh, the rest carried forward); raises UntrustedVerdict if the review
    cannot be used."""
    wanted = list(focus["criteria"]) if focus else [c for t in group["tasks"] for c in criterion_ids(checkout, t)]
    bugs = list(focus["bugs"]) if focus else []
    disputes = list(group.get("disputes", []))
    merged = {"head": head, "criteria": [], "bugs": [], "skipped_steps": []}
    started, left = time.time(), budget_left_minutes(group)
    if left <= 0:
        merged["criteria"] = [{"id": c, "status": "skipped", "evidence": BUDGET_SPENT} for c in wanted]
        append_status(checkout, f"VERIFY_SKIPPED round {round_number}: verify budget spent; {' '.join(wanted)} not verified")
    else:
        try:
            try:
                bring_up_stack(slug)
            except subprocess.CalledProcessError as exc:
                raise UntrustedVerdict(f"stack did not start (exit {exc.returncode})") from exc
            warm_stack(slug)
            results = run_checks(slug, checkout, group, wanted, started + left * 60)
            remaining = left - (time.time() - started) / 60
            review = None
            if remaining > 1:
                review = review_checks(slug, group, checkout, head, round_number, wanted, results, bugs, disputes,
                                       focus, min(VERIFY_TIMEOUT_MINUTES, remaining))
            else:
                append_status(checkout, f"VERIFY_SKIPPED round {round_number} review: verify budget spent; "
                                        "passing checks not reviewed")
        finally:
            spend_budget(group, checkout, time.time() - started)
        judged = {str(c.get("id")): c for c in (review or {}).get("criteria", [])}
        for criterion in wanted:
            result = results[criterion]
            entry = judged.get(criterion, {})
            if result["status"] in ("fail", "missing"):
                evidence = f"check {result['status']} ({result['where']}): {result['detail']}"
                if entry.get("evidence"):
                    evidence += f" | reviewer: {entry['evidence']}"
                merged["criteria"].append({"id": criterion, "status": "fail", "evidence": evidence})
            elif result["status"] == "human" or entry.get("status") == "human":
                merged["criteria"].append({"id": criterion, "status": "human",
                                           "evidence": entry.get("evidence") or result["detail"]})
            elif result["status"] == "skipped" or not entry:
                why = result["detail"] if result["status"] == "skipped" else "check passed; the review did not finish"
                merged["criteria"].append({"id": criterion, "status": "skipped", "evidence": why})
            else:
                merged["criteria"].append({"id": criterion, "status": entry["status"],
                                           "evidence": f"check passed ({result['where']}); reviewer: {entry.get('evidence', '')}"})
        merged["bugs"] = (review or {}).get("bugs", [])
    if focus:
        # Every criterion stays in the verdict: the re-checked ones fresh, the rest as the previous
        # round saw them, marked with the HEAD that observation was made on.
        previous = focus["previous"]
        fresh = {str(c.get("id")): c for c in merged["criteria"]}
        ordered = []
        for item in previous["criteria"]:
            item_id = str(item.get("id"))
            ordered.append(fresh.pop(item_id) if item_id in fresh
                           else {**item, "carried_from": item.get("carried_from") or previous["head"]})
        merged["criteria"] = ordered + list(fresh.values())
    archive_dir = TASKS_ROOT / "waves" / group["wave_id"]
    archive_dir.mkdir(parents=True, exist_ok=True)
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
    return {"criteria": failed + skipped_ids(previous), "bugs": bugs, "previous": previous},         (max(rounds) if rounds else 1) + 1


def skipped_ids(verdict):
    return [c.get("id") for c in verdict.get("criteria", []) if c.get("status") == "skipped"]


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
            disputes, group["disputes"] = group.get("disputes", []), []
            save_group(checkout, group)
            upheld = [d for d in disputes if set(d["items"]) & {*failed, *bugs}]
            if upheld:
                # Worker and a fresh verifier disagree after each saw the other's evidence: the owner rules.
                append_status(checkout, f"VERIFY_NEEDS_USER {head[:9]}: the verifier upholds findings the fixer "
                                        "disputes: " + "; ".join(f"{', '.join(sorted(set(d['items']) & {*failed, *bugs}))}"
                                                                 f" (fixer: {d['reason'][:200]})" for d in upheld)
                                        + f". Rule in the task file, then /dotask resume {slug}")
                return 1
            # Staging is the real gate (owner decision 2026-11-09): a `human` criterion rides along in the
            # PR body as a staging check instead of stopping the push.
            deferred = [c.get("id") for c in verdict["criteria"] if c["status"] == "human"]
            human = []
            if not failed and not bugs:
                group["tested_head"] = head
                group["staging_checks"] = [{"id": c, "text": criterion_line(checkout, c)} for c in deferred]
                skipped = [c.get("id") for c in verdict["criteria"] if c["status"] == "skipped"]
                group["skipped_checks"] = [{"id": c, "text": criterion_line(checkout, c)} for c in skipped] + [
                    {"id": "Other check", "text": step} for step in verdict.get("skipped_steps", [])]
                skipped += [f"[{step}]" for step in verdict.get("skipped_steps", [])]
                save_group(checkout, group)
                if human:
                    append_status(checkout, f"VERIFY_NEEDS_USER {head[:9]}: check {' '.join(human)}, "
                                            f"then run /dotask land {slug} --after-test")
                    return 0
                staging_note = f"; check on staging after merge: {' '.join(deferred)}" if deferred else ""
                staging_note += f"; not verified: {' '.join(skipped)}" if skipped else ""
                append_status(checkout, f"VERIFY_PASS {head[:9]} round {round_number}{staging_note}")
                if args.no_land:
                    return 0
                code = land(SimpleNamespace(slug=slug, after_test=True, fix_on_red=True))
                if code != CI_RED:
                    return code
                # Red Branch CI after a clean verdict waited for a person to read the logs and push a
                # fix (PRs #720, #722, #723, 2026-11-08). It is a finding like any other.
                report = ci_failure_report(group["branch"], head)
                ci_bug = {"scope": "group", "task": None, "title": "Branch CI failed after a clean verdict",
                          "steps": f"On {head[:9]}, run each test that failed in this CI report on its own: {report}",
                          "expected": "Every applicable Branch CI job passes.", "actual": report}
                verdict = {**verdict, "bugs": [*verdict["bugs"], ci_bug]}
                write_lf(checkout / VERIFY_FILE, json.dumps(verdict, indent=2) + "\n")
                append_status(checkout, f"CI_RED {head[:9]}: Branch CI failed after VERIFY_PASS; sending it to a fix round")
                failed, bugs = [], [ci_bug["title"]]
            summary = f"round {round_number} on {head[:9]}: failed {failed}, new bugs {bugs}"
            # A criterion skipped at the cap gets another verifier in the re-check, or it would reach the
            # PR unverified although a fix round was running anyway (g-t15340-1, 2026-11-09).
            focus = {"criteria": failed + skipped_ids(verdict),
                     "bugs": [b for b in verdict["bugs"] if b["scope"] == "group"], "previous": verdict}
        if fix_round == MAX_FIX_ROUNDS:
            append_status(checkout, f"VERIFY_EXHAUSTED after {MAX_FIX_ROUNDS} fix rounds; {summary}")
            return 1
        print(f"[dotask] {summary}; sending it back to workers, one task at a time")
        verdict_now = json.loads((checkout / VERIFY_FILE).read_text(encoding="utf-8"))
        fixed, skipped, disputed = run_fix_round(slug, group, checkout, round_number, verdict_now)
        if disputed:  # the next verifier reads them (verify_once) and the check above settles them
            group["disputes"] = disputed
            save_group(checkout, group)
            print(f"[dotask] fix round {round_number}: disputed {' '.join(d['task'] for d in disputed)}; "
                  "a fresh verifier re-examines them")
        if not fixed and not disputed:
            append_status(checkout, f"VERIFY_BLOCKED fix round {round_number} committed nothing"
                                    f" (skipped: {' '.join(skipped) or 'none'})")
            return 1
        if skipped:  # their findings stay in the re-check and fail again unless another fix covered them
            print(f"[dotask] fix round {round_number}: fixed {' '.join(fixed)}; skipped {' '.join(skipped)}")
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
        matches = task_file_matches(MAIN_REPO, task_id)  # a T{id}-design.md is not a second task file
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
    # Verification cannot outlast the group's budget (owner rule 2026-11-09), so that is its upper bound.
    impl, ci = phase_minutes(records, "implementation"), DEFAULT_MINUTES["ci"]
    verify = max(0.0, budget_left_minutes(group))
    source = f"medians of {len(records)} timed dispatch(es)" if records else "defaults, no timed dispatch yet"
    left = [t for t in group["tasks"] if f"STAGE_DONE {t} commit" not in text]
    # A fix round is one worker dispatch per task with findings, then a re-check inside what is left of
    # the verify budget; counting one fix underestimated g-t15220-10 by an hour (2026-11-07).
    owners = findings_tasks(checkout, group) or group["tasks"][:1]
    fix_work = len(owners) * impl
    fix_round = fix_work + verify
    fix_parts = [f"fix {len(owners)} task(s) x {impl:.0f} min", f"re-check up to {verify:.0f} min (verify budget left)"]
    parts, verify_ahead = [], True
    if "VERIFY_PASS" in last:
        minutes, verify_ahead = ci, False
        parts.append(f"CI {ci:.0f} min")
    elif any(f" {word} " in f" {last} " or f" {word}" in last for word in STOP_WORDS) and " RESUMED " not in last:
        return None, None, f"stopped, needs a restart or a ruling: {last[:140]}"
    elif " RESUMED " in last and "fix round" in last.lower():
        # A fix dispatch restarted after running out of turns: the rest of the round, then the re-check.
        minutes = fix_round + ci
        parts += ["fix round (restarted)", *fix_parts, f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last and "verify round" in last:
        if verdict_has_findings(checkout):
            # The review is in and found problems: the fix round is running now.
            minutes = fix_round + ci
            parts += [*fix_parts, f"CI {ci:.0f} min"]
        else:
            minutes = ci
            parts.append(f"CI {ci:.0f} min")
    elif " PUSHREADY " in last and "fix round" in last:
        minutes = verify + ci
        parts += [fix_parts[1], f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last and (checkout / VERIFY_FILE).is_file():
        minutes = fix_round + ci  # a verdict with findings is on disk: the fix round is running
        parts += [*fix_parts, f"CI {ci:.0f} min"]
    elif " PUSHREADY " in last:
        minutes = verify + ci
        parts += [f"verify up to {verify:.0f} min", f"CI {ci:.0f} min"]
    else:
        minutes = len(left) * impl + verify + ci
        parts += [f"{len(left)} task(s) x {impl:.0f} min", f"verify up to {verify:.0f} min", f"CI {ci:.0f} min"]
    best = now + dt.timedelta(minutes=minutes)
    with_fix = best + dt.timedelta(minutes=fix_round) if verify_ahead else None
    return best, with_fix, f"{', '.join(parts)}; {source}"


def findings_tasks(checkout, group):
    """The group tasks the verdict on disk has findings for (failed criteria, group bugs), or []."""
    try:
        verdict = json.loads((Path(checkout) / VERIFY_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [task for task, _criteria, _bugs in fix_units(group, verdict) if task]


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
            mark_staging(group.get("tasks"))  # PR #734's container was already freed when status ran
            if running == "running":
                print(f"  {on_merge(slug, merged)}")
        elif running == "stopped":
            print(f"  eta: none (container stopped; `bash scripts/dotask.sh resume {slug}` continues it, "
                  f"`task.sh nuke {slug}` clears it)")
        else:
            print(f"  {eta_line({**group, 'slug': slug}, group_path.parent)}")
    return 0


# --- staging check after merge -------------------------------------------------
# Staging is the real gate (owner decision 2026-11-09): after a group's PR merges and staging has deployed
# the merge commit, the browser checks the worker committed run against staging, and each failure is filed
# as a bug task at once (T14980's staging miss and T15360's never-restoring resume point were both found
# only there). `code` checks prove code, which CI already ran, so they are not repeated.
STAGING = {"url": os.environ.get("DOTASK_STAGING_URL", "https://reel-ballers-staging.pages.dev"),
           "api": os.environ.get("DOTASK_STAGING_API", "https://reel-ballers-api-staging.fly.dev/api"),
           # A seeded staging account (e2e/STAGING-GATE.md lane B): dev preset accounts exist only in dev.
           "email": os.environ.get("DOTASK_STAGING_EMAIL", "e2e-gate@test.local")}
DEPLOY_WORKFLOWS = ("deploy-frontend.yml", "deploy-backend.yml")
STAGING_DONE, STAGING_STARTED = "STAGING_CHECK ", "STAGING_CHECK_STARTED "


def merge_commit(pr_number):
    result = subprocess.run([tool("gh"), "pr", "view", str(pr_number), "--json", "mergeCommit", "-q", ".mergeCommit.oid"],
                            capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else ""


def wait_for_staging_deploy(sha, cap_minutes=40, appear_minutes=5, interval=30):
    """'deployed', 'not deployed' (no deploy ran for this commit: it touched no app path), 'timed out', or
    'failed: <workflows>'. A run cancelled by a newer push counts once the newest run of that workflow
    has succeeded, since it deployed this commit too."""
    started = time.time()
    while True:
        runs = {}
        for workflow in DEPLOY_WORKFLOWS:
            listed = subprocess.run([tool("gh"), "run", "list", "--workflow", workflow, "--branch", "master", "--limit", "30",
                                     "--json", "headSha,status,conclusion"], capture_output=True, text=True, check=False)
            entries = json.loads(listed.stdout or "[]") if listed.returncode == 0 else []
            mine = [r for r in entries if r.get("headSha") == sha]
            if mine and mine[0].get("conclusion") == "cancelled" and entries:
                mine = entries[:1]  # superseded: the newest run carries this commit
            runs[workflow] = mine[0] if mine else None
        found = [r for r in runs.values() if r]
        waited = (time.time() - started) / 60
        if not found and waited > appear_minutes:
            return "not deployed"
        if found and all(r.get("status") == "completed" for r in found) and \
                (len(found) == len(DEPLOY_WORKFLOWS) or waited > appear_minutes):
            bad = [w for w, r in runs.items() if r and r.get("conclusion") != "success"]
            return f"failed: {' '.join(bad)}" if bad else "deployed"
        if waited > cap_minutes:
            return "timed out"
        time.sleep(interval)


def staging_check(args):
    """Run a merged group's browser checks against staging and file each failure as a bug task, then free
    the group's container."""
    slug = args.slug
    checkout = TASKS_ROOT / sanitize(slug)
    group = json.loads((checkout / GROUP_FILE).read_text(encoding="utf-8"))
    pr = merged_pr(group.get("branch"))
    if not pr:
        die(f"{slug}: no merged PR from {group.get('branch')}; the staging check runs after merge")
    sha = merge_commit(pr) or git_head(checkout)
    deploy = wait_for_staging_deploy(sha)
    if deploy.startswith("failed") or deploy == "timed out":
        append_status(checkout, f"STAGING_CHECK_BLOCKED PR #{pr}: staging deploy {deploy}; checks not run. "
                                f"Re-run: python scripts/dotask_cli.py staging-check {slug}")
        return 1
    task_sh("up", slug)
    ran, failed, skipped, filed = [], [], [], []
    for task_id in group["tasks"]:
        ids = [c for c, entry in check_manifest(checkout, task_id).items() if entry.get("kind") == "browser"]
        if not ids:
            continue
        for criterion, (state, detail) in run_browser_checks(slug, task_id, ids, CHECK_SPEC_SECONDS, STAGING).items():
            ran.append(criterion)
            if state == "skipped":
                skipped.append(criterion)
            elif state != "pass":
                failed.append(criterion)
                text = criterion_line(checkout, criterion)
                bug = {"title": f"Staging check failed: {criterion} {' '.join(text.split()[:10])}",
                       "steps": (f"After PR #{pr} merged ({sha[:9]}), run `npx playwright test e2e/checks/{task_id}.check.spec.js "
                                 f"--grep '{criterion}'` in src/frontend with E2E_BASE_URL={STAGING['url']} "
                                 f"E2E_API_BASE={STAGING['api']} E2E_CHECK_EMAIL={STAGING['email']}."),
                       "expected": text or criterion, "actual": f"{state}: {detail}"}
                filed.append(file_unrelated_bug(bug, group, sha, found_by=f"the staging check after PR #{pr} merged")
                             or "already filed")
    human = [item["id"] for item in group.get("staging_checks", [])]
    line = (f"{STAGING_DONE}PR #{pr} ({deploy}): {len(ran) - len(failed) - len(skipped)} of {len(ran)} browser checks "
            f"passed on staging")
    line += f"; failed {' '.join(failed)}, filed {' '.join(filed)}" if failed else ""
    line += f"; timed out {' '.join(skipped)}" if skipped else ""
    line += f"; still for a person on staging: {' '.join(human)}" if human else ""
    append_status(checkout, line)
    print(f"[dotask] {line}")
    print(f"[dotask] {slug}: {free_group(slug, pr)}")
    return 1 if failed else 0


def on_merge(slug, pr_number):
    """What a merged group needs next: its staging check (started detached; it frees the container when
    done), or, once that has run or when the group committed no browser checks, freeing the container."""
    checkout = TASKS_ROOT / sanitize(slug)
    status_path = checkout / ".dotask-status"
    text = status_path.read_text(encoding="utf-8") if status_path.is_file() else ""
    try:
        tasks = json.loads((checkout / GROUP_FILE).read_text(encoding="utf-8")).get("tasks", [])
    except (OSError, ValueError):
        tasks = []
    mark_staging(tasks)
    has_checks = any(e.get("kind") == "browser" for t in tasks for e in check_manifest(checkout, t).values())
    if STAGING_DONE in text or not has_checks:
        return free_group(slug, pr_number)
    if STAGING_STARTED in text:
        return f"staging check for PR #{pr_number} already started; it frees the container when done"
    log = (TASKS_ROOT / "profiles" / sanitize(slug)).joinpath("staging-check.log")
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as stream:  # the child keeps its own handle
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "staging-check", slug],
                         stdout=stream, stderr=subprocess.STDOUT, cwd=str(REPO_ROOT),
                         creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    append_status(checkout, f"{STAGING_STARTED}PR #{pr_number}")
    return f"staging check started for PR #{pr_number} (log {log}); it frees the container when done"


def free_group(slug, pr_number):
    """Stop a merged group's container and app stack; its checkout and files stay (`task.sh nuke` clears
    them). Owner rule 2026-11-08 ("we should do this on merge"): five merged groups kept their stacks
    running and slowed the three live ones on a 4-core host."""
    result = task_sh("down", slug, check=False, capture_output=True)
    if result.returncode:
        return f"could not stop the container of merged PR #{pr_number}: {(result.stderr or result.stdout).strip()[:200]}"
    return f"freed: container stopped (PR #{pr_number} merged; checkout kept, `task.sh nuke {slug}` clears it)"


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

    after_merge = sub.add_parser("staging-check", help="after merge: run the group's browser checks on staging, "
                                                       "file failures as bug tasks, free the container")
    after_merge.add_argument("slug")

    upcoming = sub.add_parser("nextup", help="bundle TODO tasks that share files or an epic folder, PLAN order")
    upcoming.add_argument("--limit", type=int, default=5)

    args = parser.parse_args(argv)
    try:
        return {"start": start, "land": land, "autoland": locked(autoland), "resume": locked(resume), "stack": stack,
                "status": status, "nextup": nextup, "staging-check": staging_check}[args.action](args)
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: {' '.join(str(p) for p in exc.cmd)} failed (exit {exc.returncode})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
