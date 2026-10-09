"""Wave accounting for /dotask. Never calls a model.

Observed:    per-request usage from Claude stream-json or on-disk transcripts, CLI result
             totals, wall-clock timings measured by this wrapper and scripts/task.sh.
Estimated:   values labelled "estimate" (model time, context tokens from tool output size).
Unavailable: subscription quota unless an operator records a snapshot (`quota`).
Token totals are API usage counts, never subscription quota.

Commands (supervisor):
  init     --wave W --task T1 --task T2       freeze points (PLAN.md Cmplx unless --points)
  task     --wave W --id T1 --status merged   record task status (points never change)
  batch    --wave W --id B1 --tasks T1,T2 --reason "..."
  quota    --wave W --when before|after --used-percent N --resets-at ISO --source "..."
  ingest-supervisor --wave W                  import supervisor + its subagent transcripts
  close    --wave W
  report   --wave W                           write C:/work/tasks/waves/W/profile.json
Worker dispatch (task.sh drive runs this inside the container):
  run --directory .dotask-profile --status-file .dotask-status --wave W --tasks T1 --phase P
      --model sonnet --effort medium --max-turns 120 -- [-c] "<instruction>"
"""
import argparse
from collections import Counter
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

SCHEMA_VERSION = 2
WAVE_MODES = ("supervised", "window", "headless")  # which coverage records a wave can produce
TASKS_ROOT = Path(os.environ.get("DOTASK_TASKS_ROOT", "C:/work/tasks"))
REPO_ROOT = Path(__file__).resolve().parents[1]
TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
RESULT_KEYS = {"inputTokens": "input_tokens", "outputTokens": "output_tokens",
               "cacheCreationInputTokens": "cache_creation_input_tokens",
               "cacheReadInputTokens": "cache_read_input_tokens"}
PHASE_CATEGORIES = {"design": "design/root-cause", "implementation": "implementation", "qa": "tests/QA",
                    "reviewer": "review/proof", "proof-verifier": "review/proof",
                    "integration": "integration/rework", "supervisor": "coordination",
                    "exploration": "exploration"}
ROLE_CATEGORIES = {"architect": "design/root-cause", "expert": "design/root-cause",
                   "code-expert": "exploration", "Explore": "exploration",
                   "implementor": "implementation", "refactor": "implementation", "migration": "implementation",
                   "tester": "tests/QA", "reviewer": "review/proof", "proof-verifier": "review/proof",
                   "merge-reviewer": "review/proof", "supervisor": "coordination"}
OPUS_ROLES = {"architect", "expert"}
WORKER_PHASES = ("design", "implementation", "qa")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
HEADLESS_RUN_NOTE = (
    " Headless run: execute every command in the foreground (a backgrounded command or "
    "ScheduleWakeup ends this dispatch). Append each status line in the same shell command as "
    "the stage's last action, not as a separate call."
)
CHECKPOINTS = {
    "design": "Perform design/root-cause only. Write a reusable specification under docs/ and append "
              "DESIGN_READY or BLOCKED to .dotask-status. Do not edit source or tests, implement, or run QA."
              + HEADLESS_RUN_NOTE,
    "implementation": "Implement the approved specification and targeted red/green checks only. Append "
                      "IMPL_READY or BLOCKED to .dotask-status and stop; the supervisor dispatches QA "
                      "separately. Do not run your own code review; the supervisor captures it at landing."
                      + HEADLESS_RUN_NOTE,
    "qa": "Perform QA/evidence only against the task criteria. Write qa/proof.json per the schema in the "
         "kickoff. Finish with PUSHREADY or BLOCKED in .dotask-status." + HEADLESS_RUN_NOTE,
}
DESIGN_WRITABLE = ("docs/", ".dotask")
QUOTA_TEXT = re.compile(r"usage limit|session limit|rate limit|limit reached|out of (extra )?usage", re.I)
SAFE_ID = re.compile(r"[A-Za-z0-9._-]+")


# --- parsing -----------------------------------------------------------------
def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def as_dict(value):
    return value if isinstance(value, dict) else {}


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def blocks(message):
    content = as_dict(message).get("content")
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def parse_line(line):
    try:
        value = json.loads(line)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def load_events(path):
    """Events (dicts only) and the count of non-empty lines that were not JSON objects."""
    events, malformed = [], 0
    with Path(path).open(encoding="utf-8", errors="replace") as stream:
        for line in stream:
            if not line.strip():
                continue
            event = parse_line(line)
            if event is None:
                malformed += 1
            else:
                events.append(event)
    return events, malformed


def session_of(event):
    # stream-json uses session_id; on-disk transcripts use sessionId.
    return event.get("session_id") or event.get("sessionId")


def model_name(name):
    return re.sub(r"\[.*\]$", "", name) if isinstance(name, str) and name else "unknown"


def usage_of(raw):
    raw = as_dict(raw)
    return {key: number(raw.get(key)) for key in TOKEN_KEYS}


def result_usage(model_usage):
    totals = {}
    for model, raw in as_dict(model_usage).items():
        add(totals.setdefault(model_name(model), zero()), {key: number(as_dict(raw).get(src)) for src, key in RESULT_KEYS.items()})
    return totals


def zero():
    return dict.fromkeys(TOKEN_KEYS, 0)


def add(target, usage):
    for key in TOKEN_KEYS:
        target[key] = target.get(key, 0) + usage.get(key, 0)
    return target


def normalize_task(task):
    match = re.fullmatch(r"[tT](\d+)(?:[-_].*)?", task.strip())
    return "T" + match.group(1) if match else task.strip()


# --- summaries ---------------------------------------------------------------
def classify(results, events):
    """(outcome, complete, outcome_class) from the last CLI result, if any."""
    if not results:
        return "interrupted", False, "interrupted"
    last = results[-1]
    subtype = last.get("subtype") or "unknown"
    errored = bool(last.get("is_error")) or subtype != "success"
    text = last.get("result") if isinstance(last.get("result"), str) else ""
    # CLI-generated error turns: model "<synthetic>", an "error" code, and the message text
    # (observed on 2.1.280: error "authentication_failed", result subtype "success" + is_error).
    synthetic = [e for e in events if e.get("type") == "assistant"
                 and as_dict(e.get("message")).get("model") == "<synthetic>"]
    codes = " ".join(str(e.get("error") or "") for e in synthetic)
    synthetic_text = " ".join(b["text"] for e in synthetic for b in blocks(e.get("message")) if isinstance(b.get("text"), str))
    if QUOTA_TEXT.search(text) or (errored and (QUOTA_TEXT.search(synthetic_text) or "rate_limit" in codes)):
        return subtype, False, "quota_exhausted"
    if errored and "authentication" in codes:
        return subtype, False, "auth_failed"
    if subtype == "error_max_turns":
        return subtype, False, "budget_stop"
    return subtype, not errored, "error" if errored else "success"


ORIENTATION_PATH = re.compile(r"CLAUDE\.md|/\.claude/|\.claude/|dotask-kickoff|knowledge|docs/plans")
BOOKKEEPING_PATH = re.compile(r"\bqa/|\.dotask-status")
BOOKKEEPING_COMMAND = re.compile(r"\.dotask-status|\bqa/|git (status|log|diff|show|branch|merge-base)")
TEST_COMMAND = re.compile(r"vitest|playwright|pytest|dev-verify|eslint")
EXPLORE_COMMAND = re.compile(r"\bgrep\b|\bsed\b|\bfind\b|\bcat\b")


def classify_request_activity(blocks_list):
    """Heuristic label for a request from its FIRST tool_use block (or 'final-text' if none)."""
    tool_blocks = [b for b in blocks_list if b.get("type") == "tool_use"]
    if not tool_blocks:
        return "final-text"
    first = tool_blocks[0]
    name = first.get("name") or ""
    params = as_dict(first.get("input"))
    if name in ("Bash", "PowerShell"):
        command = str(params.get("command", ""))
        # Test first: red/green runs redirect into qa/ logs, which once counted them as bookkeeping
        # (25 of 39 "bookkeeping" requests in the 2026-10-08 g-t12110-8 group were test runs).
        if TEST_COMMAND.search(command):
            return "test"
        if BOOKKEEPING_COMMAND.search(command):
            return "bookkeeping"
        if EXPLORE_COMMAND.search(command):
            return "exploration"
        return "exploration"
    if name == "Read":
        path = str(params.get("file_path") or params.get("path") or "")
        if BOOKKEEPING_PATH.search(path):
            return "bookkeeping"
        if ORIENTATION_PATH.search(path):
            return "orientation"
        return "exploration"
    if name in ("Grep", "Glob"):
        return "exploration"
    if name in ("Edit", "Write", "NotebookEdit"):
        path = str(params.get("file_path") or "")
        if BOOKKEEPING_PATH.search(path):
            return "bookkeeping"
        return "edit"
    return "exploration"


def activity_tokens_of(requests):
    """Per activity: request count and input/output totals (cache reads folded into input_total)."""
    out = {}
    for request in requests:
        entry = out.setdefault(request.get("activity") or "unclassified",
                                {"requests": 0, "input_total": 0, "output": 0})
        entry["requests"] += 1
        usage = request["usage"]
        entry["input_total"] += usage["input_tokens"] + usage["cache_creation_input_tokens"] + usage["cache_read_input_tokens"]
        entry["output"] += usage["output_tokens"]
    return out


def summarize(events):
    requests, sessions, results, unidentified = {}, set(), [], 0
    for event in events:
        if session_of(event):
            sessions.add(session_of(event))
        if event.get("type") == "result":
            results.append(event)
            continue
        message = as_dict(event.get("message"))
        if event.get("type") != "assistant" or not isinstance(message.get("usage"), dict):
            continue
        if message.get("model") == "<synthetic>":
            continue  # CLI-generated error text, not an API request
        key = message.get("id") or event.get("uuid")
        if not key:
            unidentified += 1  # surfaced in coverage; cannot be deduplicated safely
            continue
        if key:
            # A response is emitted once per content block with the same usage; keep the last.
            requests[key] = {"session_id": session_of(event), "message_id": key,
                             "model": model_name(message.get("model")), "usage": usage_of(message["usage"]),
                             "activity": classify_request_activity(blocks(event.get("message")))}
    models = {}
    for request in requests.values():
        add(models.setdefault(request["model"], zero()), request["usage"])
    result_models = {}
    for result in results:
        for model, usage in result_usage(result.get("modelUsage")).items():
            add(result_models.setdefault(model, zero()), usage)
    outcome, complete, outcome_class = classify(results, events)
    summary = {"sessions": sorted(sessions), "requests": len(requests), "models": models,
               "request_records": list(requests.values()), "result_models": result_models,
               "activity_tokens": activity_tokens_of(requests.values()),
               "complete": complete, "outcome": outcome, "outcome_class": outcome_class,
               "unidentified_requests": unidentified}
    if results:
        # CLI-reported nested-agent counts: an observed check on child-record coverage.
        summary.update(subagent_stats=results[-1].get("subagent_stats"),
                       terminal_reason=results[-1].get("terminal_reason"))
    return summary


def reconcile(observed, reported):
    """Compare CLI result totals with observed per-request usage for one dispatch."""
    if not reported:
        return {"status": "no_result_totals", "residual": {}}
    residual = {}
    for model in set(observed) | set(reported):
        diff = {k: reported.get(model, {}).get(k, 0) - observed.get(model, {}).get(k, 0) for k in TOKEN_KEYS}
        if any(diff.values()):
            residual[model] = diff
    positive = any(v > 0 for diff in residual.values() for v in diff.values())
    status = "matched" if not residual else "result_exceeds_requests" if positive else "requests_exceed_result"
    return {"status": status, "residual": residual,
            "method": "CLI result modelUsage minus observed request usage (parent + forwarded agents); "
                      "not added to totals until resume semantics are validated live"}


def normalize_command(command):
    """Stable label for a shell command: first real segment, flags and arguments generalized."""
    lines = command.strip().splitlines()
    segments = [s.strip() for s in re.split(r"&&|\|\||;|\|", lines[0] if lines else "") if s.strip()]
    segments = [s for s in segments if not re.match(r"(cd|export|set|source|\.)\s", s)] or segments
    tokens = []
    for token in segments[0].split() if segments else []:
        if not tokens and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=\S*", token):
            continue  # environment prefix
        if token.startswith("-"):
            continue
        if re.search(r"\.(sh|py|js|cjs|mjs|ts)$", token):
            token = re.split(r"[\\/]", token)[-1]
        elif re.search(r"[\\/:]", token) or token.startswith(("'", '"', "$", "<")):
            token = "<arg>"
        elif re.fullmatch(r"[0-9a-fA-F]{7,}|\d+", token):
            token = "<n>"
        tokens.append(token)
        if len(tokens) == 3:
            break
    return " ".join(tokens) or "<empty>"


def tool_label(block):
    name = block.get("name") or "unknown"
    params = as_dict(block.get("input"))
    if name in ("Bash", "PowerShell"):
        return f"{name}: {normalize_command(str(params.get('command', '')))}"
    if name in ("Agent", "Task"):
        return f"{name}: {params.get('subagent_type') or 'general-purpose'}"
    if name == "Skill":
        return f"Skill: {params.get('skill', '?')}"
    return name


def result_chars(block):
    content = block.get("content")
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        return sum(len(b["text"]) for b in content if isinstance(b, dict) and isinstance(b.get("text"), str))
    return 0


def tool_activity(timed, limit=40):
    """Per tool label: calls, result size, and wall time between tool_use and tool_result."""
    pending, stats = {}, {}
    for event, at in timed:
        for block in blocks(event.get("message")):
            if block.get("type") == "tool_use" and block.get("id"):
                pending[block["id"]] = (tool_label(block), at)
            elif block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                label, start = pending.pop(block["tool_use_id"])
                entry = stats.setdefault(label, {"count": 0, "result_chars": 0, "wall_seconds": 0.0, "timed": 0, "errors": 0})
                entry["count"] += 1
                entry["result_chars"] += result_chars(block)
                entry["errors"] += bool(block.get("is_error"))
                if start is not None and at is not None and at >= start:
                    entry["wall_seconds"] = round(entry["wall_seconds"] + at - start, 3)
                    entry["timed"] += 1
    for label, _ in pending.values():
        stats.setdefault(label, {"count": 0, "result_chars": 0, "wall_seconds": 0.0, "timed": 0, "errors": 0})
        stats[label]["unfinished"] = stats[label].get("unfinished", 0) + 1
    ranked = sorted(stats.items(), key=lambda kv: (kv[1]["count"], kv[1]["result_chars"]), reverse=True)
    return dict(ranked[:limit])


# --- worker dispatch ---------------------------------------------------------
def validate_passthrough(args):
    """Only resume flags and instruction text pass through; the wrapper owns every other flag."""
    args = list(args)
    if args and args[0] == "--":
        args = args[1:]
    allowed, prompts, index = [], 0, 0
    while index < len(args):
        arg = args[index]
        if arg in ("-c", "--continue"):
            allowed.append(arg)
        elif arg in ("-r", "--resume"):
            if index + 1 >= len(args) or args[index + 1].startswith("-"):
                raise ValueError("--resume needs a session id")
            allowed += [arg, args[index + 1]]
            index += 1
        elif arg.startswith("-"):
            raise ValueError(f"flag {arg!r} is not allowed; model, effort, turns, output, tools and "
                             "settings are owned by the wrapper (use DOTASK_* variables)")
        else:
            allowed.append(arg)
            prompts += 1
        index += 1
    if not prompts:
        raise ValueError("an instruction prompt is required")
    return allowed


def supports_flag(claude, flag):
    """Reads --help (no model call). Older worker images lack newer flags."""
    try:
        out = subprocess.run(claude + ["--help"], capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return flag in out.stdout


def build_command(claude, args, forwarding):
    command = claude + ["-p", "--model", args.model, "--effort", args.effort, "--max-turns", str(args.max_turns),
                        "--output-format", "stream-json", "--verbose"]
    if forwarding:
        command.append("--forward-subagent-text")
    if getattr(args, "tools", None):
        command += ["--tools", args.tools]
    return command + ["--append-system-prompt", CHECKPOINTS[args.phase]]


def git_lines(*command):
    result = subprocess.run(["git", *command], capture_output=True, text=True, encoding="utf-8",
                            errors="replace", timeout=60)
    if result.returncode:
        raise OSError(result.stderr.strip() or f"git {command[0]} failed")
    return {line for line in result.stdout.splitlines() if line}


def dirty_paths(head):
    return git_lines("diff", "--name-only", head) | git_lines("ls-files", "--others", "--exclude-standard")


def merged_task_commits(task):
    """origin/master commit subjects for `task` (CLAUDE.md: every tracked commit starts with
    the task id), or None if the check itself could not run (e.g. no origin remote offline)."""
    try:
        result = subprocess.run(["git", "log", "origin/master", "--grep", f"^{task}[: ]", "--oneline"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
                                check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode:
        return None
    return [line for line in result.stdout.splitlines() if line.strip()]


def design_snapshot():
    try:
        head = next(iter(git_lines("rev-parse", "HEAD")))
        return {"head": head, "dirty": dirty_paths(head)}
    except (OSError, StopIteration, subprocess.SubprocessError) as exc:
        return {"error": str(exc)}


def design_violations(snapshot):
    """Source paths changed by a design-phase dispatch (docs/ and .dotask* are allowed)."""
    if "head" not in snapshot:
        return None
    changed = dirty_paths(snapshot["head"]) - snapshot["dirty"]
    return sorted(p for p in changed if not p.startswith(DESIGN_WRITABLE))


def best_effort(what, function, *args):
    """Bookkeeping I/O around a dispatch: a failure warns but never changes the worker's exit code."""
    try:
        function(*args)
    except OSError as exc:
        print(f"[wave_profile] WARNING: {what} not written: {exc!r}", file=sys.stderr)


def append_status(path, text):
    with Path(path).open("a", encoding="utf-8") as stream:
        stream.write(f"{time.strftime('%Y-%m-%dT%H:%M', time.gmtime())} {text}\n")


def base_record(args, run_id):
    return {"schema_version": SCHEMA_VERSION, "run_id": run_id, "wave_id": args.wave,
            "task_ids": [normalize_task(t) for t in args.tasks.split(",") if t.strip()],
            "role": args.role, "phase": args.phase, "category": PHASE_CATEGORIES.get(args.phase, "unknown"),
            "category_method": "dispatch phase", "requested_model": args.model, "effort": args.effort,
            "escalation_reason": args.reason, "source": "task.sh drive stream-json", "updated_at": now_iso()}


def child_records(parent, timed):
    """Nested agents seen in the parent stream; agents with no forwarded events are kept as gaps.

    Grouping by parent_tool_use_id is restricted to ids that are KNOWN agent tool_use ids
    (gathered in a first pass). A tool_progress heartbeat or any other event can carry
    parent_tool_use_id set to a plain Bash tool's id -- without this restriction that creates
    a phantom child "agent" record for a tool call that never spawned anything.
    """
    agents, finished, groups = {}, {}, {}
    for event, _ in timed:
        for block in blocks(event.get("message")):
            if block.get("type") == "tool_use" and block.get("name") in ("Agent", "Task") and block.get("id"):
                agents[block["id"]] = {"input": as_dict(block.get("input")), "parent": event.get("parent_tool_use_id")}
    for event, at in timed:
        for block in blocks(event.get("message")):
            if block.get("type") == "tool_result" and block.get("tool_use_id"):
                finished[block["tool_use_id"]] = bool(block.get("is_error"))
        if event.get("parent_tool_use_id") in agents:
            groups.setdefault(event["parent_tool_use_id"], []).append((event, at))
    children = []
    for agent_id in sorted(agents):
        meta = agents.get(agent_id, {})
        params = meta.get("input", {})
        role = params.get("subagent_type") or ("general-purpose" if agent_id in agents else "unknown-agent")
        events = groups.get(agent_id, [])
        child = {"schema_version": SCHEMA_VERSION, "run_id": f"{parent['run_id']}-{agent_id}",
                 "parent_run_id": f"{parent['run_id']}-{meta['parent']}" if meta.get("parent") else parent["run_id"],
                 "agent_id": agent_id, "wave_id": parent["wave_id"], "task_ids": parent["task_ids"],
                 "role": role, "dispatch_phase": parent["phase"], "category": ROLE_CATEGORIES.get(role, "unknown"),
                 "category_method": "agent role" if role in ROLE_CATEGORIES else "unknown: role not mapped",
                 "requested_model": params.get("model") or "agent default (see observed models)",
                 "source": "forwarded in parent stream", "updated_at": now_iso(),
                 **summarize([e for e, _ in events]), "tool_activity": tool_activity(events),
                 "usage_forwarded": bool(events)}
        done = agent_id in finished
        child["complete"] = done and not finished[agent_id]
        child["outcome"] = child["outcome_class"] = ("error" if finished[agent_id] else "success") if done else "interrupted"
        children.append(child)
    return children


def opus_models(models):
    return sorted(m for m in models if "opus" in m.lower())


def policy_violations(record, children):
    found = []
    if record["phase"] != "design" and opus_models(record["models"]):
        found.append(f"top-level {record['phase']} dispatch used {opus_models(record['models'])}")
    for child in children:
        if opus_models(child["models"]) and child["role"] not in OPUS_ROLES:
            found.append(f"nested {child['role']} used {opus_models(child['models'])}")
    return found


# --- exact usage from on-disk transcripts (stream-json under-reports some output_tokens) ---
def project_transcripts_dir(cwd=None):
    base = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(cwd or Path.cwd()))
    return base / slug


def transcript_request_records(path):
    """message_id -> {model, usage} read directly from one on-disk transcript file."""
    events, _ = load_events(path)
    out = {}
    for event in events:
        message = as_dict(event.get("message"))
        if event.get("type") != "assistant" or not isinstance(message.get("usage"), dict):
            continue
        if message.get("model") == "<synthetic>":
            continue
        key = message.get("id") or event.get("uuid")
        if key:
            out[key] = {"model": model_name(message.get("model")), "usage": usage_of(message["usage"])}
    return out


def max_merge_usage(a, b):
    return {key: max(a.get(key, 0), b.get(key, 0)) for key in TOKEN_KEYS}


def merge_request_records(records, transcript_records):
    """Field-wise MAX per message id between stream `records` and `transcript_records`.

    A stale stream snapshot is only ever lower than the transcript's final value, never
    higher, so taking the max per field is safe regardless of which source ran first.
    Returns (merged_records, raised) where `raised` is True iff any field actually moved.
    """
    merged, raised = {r["message_id"]: dict(r) for r in records}, False
    for key, transcript in transcript_records.items():
        if key in merged:
            before = merged[key]["usage"]
            after = max_merge_usage(before, transcript["usage"])
            raised = raised or after != before
            merged[key]["usage"] = after
        else:
            merged[key] = {"session_id": None, "message_id": key, "model": transcript["model"],
                           "usage": transcript["usage"], "activity": "unclassified"}
            raised = True
    return list(merged.values()), raised


def recompute_from_requests(record):
    models = {}
    for request in record["request_records"]:
        add(models.setdefault(request["model"], zero()), request["usage"])
    record.update(models=models, requests=len(record["request_records"]),
                  activity_tokens=activity_tokens_of(record["request_records"]))


def agent_transcript_path(subagents_dir, agent_id):
    """A subagent transcript named by tool_use id, or matched via its .meta.json toolUseId."""
    direct = subagents_dir / f"agent-{agent_id}.jsonl"
    if direct.is_file():
        return direct
    for meta_path in subagents_dir.glob("agent-*.meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if meta.get("toolUseId") == agent_id:
            return meta_path.parent / (meta_path.name[: -len(".meta.json")] + ".jsonl")
    return None


def apply_transcript_usage(record, children, cwd=None):
    """Replace stream usage with transcript-observed usage (max-merged) when available."""
    project = project_transcripts_dir(cwd)
    raised_any = False
    for session in record.get("sessions") or []:
        main = project / f"{session}.jsonl"
        if main.is_file():
            try:
                record["request_records"], raised = merge_request_records(
                    record["request_records"], transcript_request_records(main))
            except OSError:
                continue
            raised_any = raised_any or raised
            recompute_from_requests(record)
        subagents = project / session / "subagents"
        if not subagents.is_dir():
            continue
        for child in children:
            agent_path = agent_transcript_path(subagents, child["agent_id"])
            if agent_path is None:
                continue
            try:
                child["request_records"], raised = merge_request_records(
                    child.get("request_records", []), transcript_request_records(agent_path))
            except OSError:
                continue
            if raised:
                raised_any = True
                recompute_from_requests(child)
            child["usage_source"] = "stream+transcript" if raised else "stream"
    record["usage_source"] = "stream+transcript" if raised_any else "stream"


def finish(record, root, timed, malformed):
    events = [e for e, _ in timed]
    whole = summarize(events)
    parent = [(e, t) for e, t in timed if not e.get("parent_tool_use_id")]
    record.update(summarize([e for e, _ in parent]))
    record.update(reconciliation=reconcile(whole["models"], whole["result_models"]),
                  tool_activity=tool_activity(parent), malformed_lines=malformed)
    children = child_records(record, timed)
    apply_transcript_usage(record, children)
    record["nested_agents"] = [c["run_id"] for c in children]
    record["policy_violations"] = policy_violations(record, children)
    for child in children:
        write_json(root / (child["run_id"] + ".json"), child)


def run(args):
    passthrough = validate_passthrough(args.passthrough)
    claude = json.loads(args.claude_json)
    root = Path(args.directory)
    root.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    raw, record_path = root / (run_id + ".jsonl"), root / (run_id + ".json")
    forwarding = supports_flag(claude, "--forward-subagent-text")
    command = build_command(claude, args, forwarding) + passthrough
    status = Path(args.status_file) if args.status_file else None
    status_size = status.stat().st_size if status and status.exists() else 0
    snapshot = design_snapshot() if args.phase == "design" else None
    started = time.time()
    record = {**base_record(args, run_id), "started_at": now_iso(), "outcome": "running", "complete": False,
              "outcome_class": "running", "subagent_text_forwarding": forwarding, "raw_log": raw.name}
    best_effort("start record", write_json, record_path, record)  # a killed wrapper still leaves a record
    code, timed, malformed, process = 1, [], 0, None
    try:
        with raw.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
            for line in process.stdout:
                log.write(line)
                log.flush()
                event = parse_line(line)
                if event is None:
                    malformed += bool(line.strip())
                    continue
                timed.append((event, time.time()))
                if event.get("type") == "result":
                    print(json.dumps({"outcome": event.get("subtype"), "result": event.get("result"),
                                      "session_id": event.get("session_id")}), flush=True)
            code = process.wait()
    except OSError as exc:
        record["launch_error"] = str(exc)
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()
    record.update(exit_code=code, duration_seconds=round(time.time() - started, 3), updated_at=now_iso())
    try:
        finish(record, root, timed, malformed)
    except Exception as exc:  # noqa: BLE001 - accounting must never change the dispatch outcome
        record["profiling_error"] = repr(exc)
        record["outcome"], record["outcome_class"] = "profiling_error", "unknown"
        print(f"[wave_profile] WARNING: profiling failed: {exc!r}", file=sys.stderr)
    if snapshot is not None:
        try:
            violations = design_violations(snapshot)
        except (OSError, subprocess.SubprocessError) as exc:
            violations = None
            snapshot = {"error": str(exc)}
        record["design_check"] = ("unavailable: " + snapshot["error"]) if violations is None else "checked"
        if violations:
            record["policy_violations"] = record.get("policy_violations", []) + [f"design phase changed {violations}"]
            if status:
                best_effort("status line", append_status, status,
                            f"PHASE_VIOLATION design changed source: {' '.join(violations[:10])}")
            code = code or 3
    if status and (not status.exists() or status.stat().st_size == status_size):
        if code or record.get("outcome_class") != "success":
            line = f"DISPATCH_FAILED phase={args.phase} exit={code} outcome={record.get('outcome_class')}"
        else:
            line = f"ENDED_WITHOUT_STATUS phase={args.phase}"
        best_effort("status line", append_status, status, line)
    best_effort("run record", write_json, record_path, record)
    print(json.dumps({"run_id": run_id, "exit_code": code, "outcome_class": record.get("outcome_class"),
                      "requests": record.get("requests"), "policy_violations": record.get("policy_violations", [])}),
          flush=True)
    return code


def capture_record(session, wave, task_ids, role, model, exit_code, response=None, outcome=None):
    """Usage record for a landing_gate capture: CLI result totals (no per-request detail)."""
    record = {"schema_version": SCHEMA_VERSION, "run_id": session, "session_id": session,
              "wave_id": wave if wave and SAFE_ID.fullmatch(wave) else "unassigned",
              "task_ids": [normalize_task(t) for t in task_ids or [] if isinstance(t, str)],
              "role": role, "phase": role, "category": "review/proof", "category_method": "landing capture role",
              "requested_model": model, "effort": "medium", "exit_code": exit_code,
              "source": "landing_gate capture (CLI result totals)", "updated_at": now_iso()}
    response = as_dict(response)
    if response:
        outcome_name, complete, outcome_class = classify([response], [])
        models = result_usage(response.get("modelUsage"))
        record.update(models=models, complete=complete, outcome=outcome_name, outcome_class=outcome_class,
                      usage_missing=not models)
    else:
        record.update(models={}, complete=False, outcome=outcome or "failed", outcome_class="error", usage_missing=True)
    return record


# --- transcripts -------------------------------------------------------------
def ingest_file(path, base, since=None, until=None):
    events, malformed = load_events(path)
    kept, excluded = [], 0
    for event in events:
        at = parse_time(event.get("timestamp"))
        if at is not None and ((since and at < since) or (until and at > until)):
            excluded += 1
            continue
        kept.append((event, at))
    times = [t for _, t in kept if t is not None]
    record = {**base, **summarize([e for e, _ in kept]), "tool_activity": tool_activity(kept),
              "malformed_lines": malformed, "window_excluded_records": excluded,
              "active_span_seconds": round(max(times) - min(times), 3) if times else None,
              "updated_at": now_iso()}
    # Transcripts carry no CLI result: completion is not observable from them.
    record.update(complete=None, outcome="transcript", outcome_class="transcript")
    return record


def ingest(args):
    if not SAFE_ID.fullmatch(args.identity):
        raise ValueError("identity must match [A-Za-z0-9._-]+")
    base = {"schema_version": SCHEMA_VERSION, "run_id": args.identity, "wave_id": args.wave,
            "task_ids": [normalize_task(t) for t in args.tasks.split(",") if t.strip()],
            "role": args.role, "phase": args.phase,
            "category": ROLE_CATEGORIES.get(args.role) or PHASE_CATEGORIES.get(args.phase, "unknown"),
            "category_method": "explicit assignment", "requested_model": "not recorded (see observed models)",
            "source": f"transcript {Path(args.transcript).name}"}
    write_json(Path(args.directory) / (args.identity + ".json"),
               ingest_file(args.transcript, base, parse_time(args.since), parse_time(args.until)))


def transcripts_dir():
    base = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(REPO_ROOT)).lower()
    for candidate in base.iterdir() if base.is_dir() else []:
        if candidate.name.lower() == slug:
            return candidate
    raise ValueError(f"no transcript directory for {REPO_ROOT} under {base}")


def discover_sessions(project, wave, since):
    """Top-level transcripts touched since the wave began that mention the wave id."""
    found = []
    for path in sorted(project.glob("*.jsonl")):
        if since and path.stat().st_mtime < since:
            continue
        if wave in path.read_text(encoding="utf-8", errors="replace"):
            found.append(path.stem)
    return found


def ingest_supervisor(args):
    manifest_path = wave_dir(args.wave) / "manifest.json"
    manifest = load_manifest(manifest_path)
    since, until = parse_time(manifest.get("created_at")), parse_time(manifest.get("closed_at"))
    project = Path(args.project_dir) if args.project_dir else transcripts_dir()
    sessions = args.session or discover_sessions(project, args.wave, since)
    out = wave_dir(args.wave) / "profiles"
    task_ids = [t["id"] for t in manifest.get("tasks", [])]
    written = []
    for session in sessions:
        base = {"schema_version": SCHEMA_VERSION, "wave_id": args.wave, "task_ids": task_ids,
                "requested_model": "session setting (see observed models)",
                "contamination": "the session may contain unrelated work inside the wave window"}
        main = project / f"{session}.jsonl"
        if not main.exists():
            raise ValueError(f"no transcript {main}")
        run_id = f"supervisor-{session}"
        record = ingest_file(main, {**base, "run_id": run_id, "role": "supervisor", "phase": "supervisor",
                                    "category": "coordination", "category_method": "supervisor session",
                                    "source": f"transcript {main.name}"}, since, until)
        write_json(out / (run_id + ".json"), record)
        written.append(run_id)
        for agent in sorted((project / session / "subagents").glob("agent-*.jsonl")):
            meta_path = agent.with_suffix(".meta.json")
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
            role = meta.get("agentType") or "unknown-agent"
            child_id = f"{run_id}-{agent.stem}"
            child = ingest_file(agent, {**base, "run_id": child_id, "parent_run_id": run_id, "role": role,
                                        "phase": "supervisor", "category": ROLE_CATEGORIES.get(role, "unknown"),
                                        "category_method": "agent role" if role in ROLE_CATEGORIES else "unknown: role not mapped",
                                        "source": f"subagent transcript {agent.name}"}, since, until)
            if child["requests"]:
                write_json(out / (child_id + ".json"), child)
                written.append(child_id)
    manifest["supervisor_session_ids"] = sorted(set(manifest.get("supervisor_session_ids", [])) | set(sessions))
    write_json(manifest_path, manifest)
    print(json.dumps({"sessions": sessions, "records": written}))


# --- manifest ----------------------------------------------------------------
def wave_dir(wave):
    if not SAFE_ID.fullmatch(wave):
        raise ValueError("wave id must match [A-Za-z0-9._-]+")
    return TASKS_ROOT / "waves" / wave


def load_manifest(path):
    if not Path(path).exists():
        raise ValueError(f"no manifest at {path}; run: python scripts/wave_profile.py init --wave <id> --task T...")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def plan_points(path):
    """PLAN.md Cmplx column by task id (a provisional estimate, not story points)."""
    points = {}
    if not Path(path).exists():
        return points
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and re.fullmatch(r"T\d+", cells[0]) and cells[3].isdigit():
            points[cells[0]] = int(cells[3])
    return points


def points_digest(tasks):
    frozen = sorted((t["id"], t.get("points"), t.get("points_source")) for t in tasks if not t.get("added_after_start"))
    return hashlib.sha256(json.dumps(frozen).encode()).hexdigest()


def init(args):
    path = wave_dir(args.wave) / "manifest.json"
    if path.exists():
        raise ValueError(f"{path} exists; points are frozen at init")
    overrides = {}
    for item in args.points or []:
        task, _, value = item.partition("=")
        overrides[normalize_task(task)] = int(value)
    allowed_existing = {normalize_task(t) for t in args.allow_existing or []}
    plan = plan_points(args.plan)
    tasks = []
    for task in dict.fromkeys(normalize_task(t) for t in args.task):
        if task not in allowed_existing:
            commits = merged_task_commits(task)
            if commits:
                raise ValueError(f"{task} already has commits on origin/master (pass --allow-existing {task} "
                                 f"to dispatch it anyway): {commits[0]}")
        if task in overrides:
            points, source = overrides[task], "story points (operator)"
        elif task in plan:
            points, source = plan[task], "PLAN.md Cmplx (provisional estimate, not story points)"
        else:
            points, source = None, "unavailable"
        tasks.append({"id": task, "points": points, "points_source": source, "status": "planned",
                      "history": [{"status": "planned", "at": now_iso()}]})
    manifest = {"schema_version": SCHEMA_VERSION, "wave_id": args.wave, "created_at": now_iso(), "closed_at": None,
                "tasks": tasks, "points_digest": points_digest(tasks), "batches": [],
                "mode": args.mode,
                "quota": {"snapshots": [], "exclusive_account_use": args.exclusive},
                "supervisor_session_ids": [], "missing_coverage": [], "notes": []}
    write_json(path, manifest)
    print(json.dumps({"manifest": str(path), "tasks": tasks}, indent=2))


def update_manifest(wave, change):
    path = wave_dir(wave) / "manifest.json"
    manifest = load_manifest(path)
    change(manifest)
    write_json(path, manifest)


def task_status(args):
    task_id = normalize_task(args.id)

    def change(manifest):
        task = next((t for t in manifest["tasks"] if t["id"] == task_id), None)
        if task is None:
            if not args.add:
                raise ValueError(f"{task_id} is not in the wave; pass --add (it will be flagged as added after start)")
            task = {"id": task_id, "points": args.add_points, "points_source": "added after start",
                    "added_after_start": True, "history": []}
            manifest["tasks"].append(task)
        task["status"] = args.status
        task["history"].append({"status": args.status, "at": now_iso(), "note": args.note})
    update_manifest(args.wave, change)


def batch(args):
    def change(manifest):
        manifest["batches"].append({"id": args.id, "tasks": [normalize_task(t) for t in args.tasks.split(",")],
                                    "reason": args.reason, "at": now_iso()})
    update_manifest(args.wave, change)


def quota(args):
    def change(manifest):
        manifest.setdefault("quota", {}).setdefault("snapshots", []).append(
            {"when": args.when, "observed_at": now_iso(), "used_percent": args.used_percent,
             "resets_at": args.resets_at, "source": args.source})
    update_manifest(args.wave, change)


def close(args):
    update_manifest(args.wave, lambda manifest: manifest.update(closed_at=now_iso()))


def note(args):
    def change(manifest):
        manifest.setdefault("notes", []).append({"at": now_iso(), "text": args.text})
    update_manifest(args.wave, change)


# --- report ------------------------------------------------------------------
def default_directories(wave, landing_store):
    directories = [wave_dir(wave) / "profiles", TASKS_ROOT / "profiles", *TASKS_ROOT.glob("*/.dotask-profile")]
    store = landing_store or os.environ.get("DOTASK_LANDING_STORE")
    if store:
        directories.append(Path(store) / "profiles")
    return directories


def collect(directories):
    records, raw_logs, meta = {}, [], []
    for directory in {Path(d).resolve() for d in directories if Path(d).is_dir()}:
        for path in directory.rglob("*.json"):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(record, dict) or not record.get("run_id") or "wave_id" not in record:
                continue
            record["source_file"] = str(path)
            previous = records.get(record["run_id"])
            rank = (record.get("outcome") != "running", record.get("updated_at") or "")
            if previous is None or rank > (previous.get("outcome") != "running", previous.get("updated_at") or ""):
                records[record["run_id"]] = record
        raw_logs += [p for p in directory.rglob("*.jsonl") if p.name != "meta.jsonl"]
        for path in directory.rglob("meta.jsonl"):
            events, _ = load_events(path)
            meta += events
    return records, raw_logs, meta


def revive_running(record):
    """A wrapper that never finished: re-read usage from its raw log (nested agents not split)."""
    raw = Path(record["source_file"]).with_name(record["run_id"] + ".jsonl")
    if raw.exists():
        events, malformed = load_events(raw)
        record.update(summarize(events), malformed_lines=malformed)
    record.update(outcome="wrapper did not finish", outcome_class="interrupted", complete=False,
                  stale_running="usage re-read from raw log; nested agents not split")


def record_bucket(record, abandoned_ids):
    """Which meta_tokens bucket a run belongs to, before any bookkeeping/orientation split."""
    if record.get("role") == "supervisor":
        return "supervisor"
    if record.get("category") == "review/proof":
        return "captures"
    ids = record.get("task_ids") or []
    if ids and all(t in abandoned_ids for t in ids):
        return "abandoned_task_runs"
    return "productive"


def meta_tokens_report(bucket_usage):
    return {**bucket_usage,
            "method": "heuristic attribution: role=supervisor -> supervisor; category=review/proof -> "
                      "captures; every task_id on the run abandoned -> abandoned_task_runs; otherwise each "
                      "request's first tool_use (Read of CLAUDE.md/.claude//kickoff/knowledge/docs/plans, "
                      "or .dotask-status/git status-log-diff-show-branch-merge-base/qa writes) pulls it "
                      "into worker_orientation/worker_bookkeeping out of productive; productive is the rest"}


def aggregate(args):
    wave = args.wave
    manifest = load_manifest(Path(args.manifest) if args.manifest else wave_dir(wave) / "manifest.json")
    directories = default_directories(wave, args.landing_store) + [Path(d) for d in args.directories]
    records, raw_logs, meta_events = collect(directories)
    known = set(records)
    # `ingest` names a record worker-<session> but keeps the raw file name in its source.
    ingested = {r["source"].removeprefix("transcript ") for r in records.values()
                if str(r.get("source") or "").startswith("transcript ")}
    # land copies each group's transcripts to profiles/<slug>/transcripts/; a group's wave id is
    # <slug>-<timestamp>, so another group's transcripts are never this wave's orphans.
    raw_logs = [p for p in raw_logs if "transcripts" not in p.parts
                or wave.startswith(p.parts[p.parts.index("transcripts") - 1] + "-")]
    included = [r for r in records.values() if r["wave_id"] == wave]
    for record in included:
        if record.get("outcome") == "running":
            revive_running(record)
    excluded = Counter(r["wave_id"] for r in records.values() if r["wave_id"] != wave)

    totals, by_model, categories = zero(), {}, {}
    seen_sessions, duplicates, superseded, credited = set(), 0, [], {}
    abandoned_ids = {t["id"] for t in manifest.get("tasks", []) if t.get("status") == "abandoned"}
    bucket_usage = {name: zero() for name in
                    ("supervisor", "captures", "abandoned_task_runs", "worker_bookkeeping", "worker_orientation", "productive")}

    def credit(record, model, usage):
        add(totals, usage)
        add(by_model.setdefault(model, zero()), usage)
        add(categories.setdefault(record["category"], {}).setdefault(model, zero()), usage)
        add(record.setdefault("_counted", {}).setdefault(model, zero()), usage)

    def credit_bucket(bucket, usage, activity=None):
        target = {"bookkeeping": "worker_bookkeeping", "orientation": "worker_orientation"}.get(activity, bucket) \
            if bucket == "productive" else bucket
        add(bucket_usage[target], usage)

    # Deterministic first-wins: worker stream records, then other request-level sources, by run id.
    request_level = sorted((r for r in included if "request_records" in r),
                           key=lambda r: (r.get("source") != "task.sh drive stream-json", r["run_id"]))
    totals_only = [r for r in included if "request_records" not in r]
    for record in request_level:
        bucket = record_bucket(record, abandoned_ids)
        for request in record["request_records"]:
            key = request["message_id"]
            if key in credited:
                duplicates += 1
                # T-shared transcripts/stream can both carry the same message id; the LATER
                # observation is only ever >= the earlier one in every field, so max-merge
                # (never first-wins/sum) and credit just the newly-revealed delta, if any.
                previous = credited[key]
                merged_usage = max_merge_usage(previous["usage"], request["usage"])
                delta = {k: merged_usage[k] - previous["usage"][k] for k in TOKEN_KEYS}
                if any(delta.values()):
                    credit(record, previous["model"], delta)
                    credit_bucket(bucket, delta, request.get("activity"))
                    previous["usage"] = merged_usage
                continue
            credited[key] = {"model": request["model"], "usage": dict(request["usage"])}
            if request.get("session_id"):
                seen_sessions.add(request["session_id"])
            credit(record, request["model"], request["usage"])
            credit_bucket(bucket, request["usage"], request.get("activity"))
    for record in totals_only:
        if record.get("session_id") in seen_sessions:
            superseded.append(record["run_id"])
            continue
        bucket = record_bucket(record, abandoned_ids)
        for model, usage in as_dict(record.get("models")).items():
            u = usage_of(usage)
            credit(record, model, u)
            credit_bucket(bucket, u)

    def ranked(key):
        sums = {cat: sum(key(u) for u in models.values()) for cat, models in categories.items()}
        return [{"category": cat, "tokens": value} for cat, value in sorted(sums.items(), key=lambda kv: kv[1], reverse=True)[:3]]

    residual = {}
    for record in included:
        for model, diff in as_dict(as_dict(record.get("reconciliation")).get("residual")).items():
            add(residual.setdefault(model, zero()), {k: max(v, 0) for k, v in diff.items()})

    tasks = manifest.get("tasks", [])
    merged = [t for t in tasks if t.get("status") == "merged"]
    completed = [t for t in tasks if t.get("status") in ("completed", "merged")]
    merged_points = sum(t.get("points") or 0 for t in merged)
    per_task, shared = {}, zero()
    for record in included:
        counted = record.get("_counted", {})
        ids = record.get("task_ids") or []
        target = per_task.setdefault(ids[0], zero()) if len(ids) == 1 else shared
        for usage in counted.values():
            add(target, usage)

    report = {
        "schema_version": SCHEMA_VERSION, "wave_id": wave, "generated_at": now_iso(),
        "measurement": {
            "observed": "tokens (per API request, deduplicated by message id), models, agent runs, "
                        "exit codes, wall-clock step and tool timings",
            "estimated": "model_time_seconds_estimate, automation est_context_tokens",
            "operator_supplied": "points, task statuses, quota snapshots",
            "not_measured": "subscription quota consumption per agent; hidden reasoning content"},
        "wave": manifest,
        "tokens": totals,
        "models": by_model,
        "categories": categories,
        "top_categories": ranked(lambda u: u["output_tokens"]),
        "top_categories_by_uncached_input": ranked(lambda u: u["input_tokens"] + u["cache_creation_input_tokens"]),
        "category_method": "dispatch phase or agent role; ranked by output tokens (model-specific, cache reads excluded)",
        "agents": [agent_summary(r) for r in sorted(included, key=lambda r: r.get("started_at") or r.get("updated_at") or "")],
        "points": points_section(manifest, tasks, completed, merged, merged_points, totals, by_model),
        "context_growth": {r["run_id"]: growth for r in included
                           if (growth := context_growth(r.get("request_records") or []))},
        "per_task_tokens": {"by_task": per_task, "shared_or_unattributed": shared,
                            "method": "runs dispatched for exactly one task; batched/supervisor runs are shared"},
        "quota": quota_section(manifest),
        "meta": meta_section(wave, meta_events, included),
        "meta_tokens": meta_tokens_report(bucket_usage),
        "automation_candidates": automation_section(included),
        "coverage": {
            "runs": len(included), "complete_runs": sum(r.get("complete") is True for r in included),
            "incomplete_runs": [r["run_id"] for r in included if r.get("complete") is False],
            "missing": coverage_missing(manifest, included, merged),
            "duplicate_requests_skipped": duplicates, "superseded_totals_records": superseded,
            "stale_running": [r["run_id"] for r in included if r.get("stale_running")],
            "unforwarded_nested_agents": [r["run_id"] for r in included if r.get("usage_forwarded") is False],
            "nested_agent_count_mismatch": {
                r["run_id"]: {"cli_spawned": as_dict(r.get("subagent_stats")).get("spawned"), "records": len(r.get("nested_agents") or [])}
                for r in included if isinstance(as_dict(r.get("subagent_stats")).get("spawned"), int)
                and as_dict(r.get("subagent_stats"))["spawned"] != len(r.get("nested_agents") or [])},
            "usage_missing": [r["run_id"] for r in included if r.get("usage_missing")],
            "profiling_errors": {r["run_id"]: r["profiling_error"] for r in included if r.get("profiling_error")},
            "malformed_lines": sum(r.get("malformed_lines") or 0 for r in included),
            "unidentified_requests_not_counted": sum(r.get("unidentified_requests") or 0 for r in included),
            "reconciliation": dict(Counter(as_dict(r.get("reconciliation")).get("status") for r in included if r.get("reconciliation"))),
            "result_only_residual_not_in_totals": residual,
            "excluded_other_waves": dict(excluded),
            "orphan_raw_logs": sorted(str(p) for p in raw_logs if p.stem not in known and p.name not in ingested),
            "policy_violations": {r["run_id"]: r["policy_violations"] for r in included if r.get("policy_violations")},
            "operator_notes": manifest.get("missing_coverage", [])},
    }
    output = Path(args.output) if args.output else wave_dir(wave) / "profile.json"
    write_json(output, report)
    print(json.dumps({"profile": str(output), "runs": len(included), "tokens": totals,
                      "missing": report["coverage"]["missing"]}, indent=2))


def agent_summary(record):
    return {key: record.get(key) for key in (
        "run_id", "parent_run_id", "role", "phase", "dispatch_phase", "category", "requested_model", "effort",
        "task_ids", "outcome", "outcome_class", "complete", "exit_code", "duration_seconds", "active_span_seconds",
        "subagent_text_forwarding", "policy_violations", "source")} | {
        "observed_models": sorted(as_dict(record.get("models"))), "tokens_counted": record.get("_counted", {})}


def context_growth(requests):
    """Input context per request, in transcript order: one long session re-reads a growing prefix."""
    sizes = [r["usage"]["input_tokens"] + r["usage"]["cache_creation_input_tokens"] + r["usage"]["cache_read_input_tokens"]
             for r in requests]
    if not sizes:
        return None
    return {"requests": len(sizes), "first": sizes[0], "last": sizes[-1], "peak": max(sizes),
            "mean": sum(sizes) // len(sizes)}


def points_section(manifest, tasks, completed, merged, merged_points, totals, by_model):
    unknown = [t["id"] for t in tasks if t.get("points") is None]
    completed_points = sum(t.get("points") or 0 for t in completed)
    return {
        "frozen_digest_matches": points_digest(tasks) == manifest.get("points_digest"),
        "sources": sorted({t.get("points_source") for t in tasks}),
        "planned": sum(t.get("points") or 0 for t in tasks),
        "completed": completed_points,
        "tokens_per_completed_point": {k: round(v / completed_points, 1) for k, v in totals.items()} if completed_points else None,
        "merged": merged_points,
        "added_after_start": [t["id"] for t in tasks if t.get("added_after_start")],
        "unknown_points": unknown,
        "tokens_per_merged_point": {k: round(v / merged_points, 1) for k, v in totals.items()} if merged_points else None,
        "output_tokens_per_merged_point_by_model": {m: round(u["output_tokens"] / merged_points, 1) for m, u in by_model.items()} if merged_points else None,
        "denominator_note": "all wave usage (including failed and unmerged work) divided by merged points"}


def quota_section(manifest):
    section = as_dict(manifest.get("quota"))
    snapshots = section.get("snapshots") or []
    before = next((s for s in snapshots if s.get("when") == "before"), None)
    after = next((s for s in reversed(snapshots) if s.get("when") == "after"), None)
    delta, status = None, "unavailable: no before/after snapshot recorded"
    if before and after:
        if not (isinstance(before.get("used_percent"), (int, float)) and isinstance(after.get("used_percent"), (int, float))):
            status = "unavailable: snapshot lacks used_percent"
        elif before.get("resets_at") != after.get("resets_at"):
            status = "not comparable: snapshots are in different reset windows"
        else:
            delta, status = round(after["used_percent"] - before["used_percent"], 2), "observed (operator snapshots)"
    return {"before": before, "after": after, "delta_percent_points": delta, "status": status,
            "contamination": "operator asserted exclusive account use" if section.get("exclusive_account_use")
            else "account-wide meter: includes any concurrent non-wave usage",
            "ignored_manifest_delta": section.get("delta"),
            "note": "per-agent quota is never inferred from token proportions"}


def meta_section(wave, events, included):
    steps = {}
    for event in events:
        if event.get("wave_id") != wave:
            continue
        entry = steps.setdefault(event.get("step", "unknown"), {"count": 0, "total_seconds": 0.0, "max_seconds": 0.0, "failures": 0})
        seconds = number(event.get("seconds"))
        entry["count"] += 1
        entry["total_seconds"] = round(entry["total_seconds"] + seconds, 3)
        entry["max_seconds"] = max(entry["max_seconds"], seconds)
        entry["failures"] += event.get("exit_code") not in (0, None)
    dispatch = sum(number(r.get("duration_seconds")) for r in included if r.get("source") == "task.sh drive stream-json")
    tools = sum(s.get("wall_seconds", 0) for r in included if r.get("source") == "task.sh drive stream-json"
                for s in as_dict(r.get("tool_activity")).values())
    return {"host_steps": steps,
            "dispatch_wall_seconds": round(dispatch, 3),
            "top_level_tool_wall_seconds": round(tools, 3),
            "model_time_seconds_estimate": round(max(dispatch - tools, 0), 3),
            "method": "host_steps measured by task.sh; tool time = tool_use to tool_result arrival; "
                      "model time estimate = dispatch wall minus top-level tool time"}


def automation_section(included):
    merged = {}
    for record in included:
        for label, stats in as_dict(record.get("tool_activity")).items():
            entry = merged.setdefault(label, {"count": 0, "runs": 0, "result_chars": 0, "wall_seconds": 0.0, "roles": set()})
            entry["count"] += stats.get("count", 0)
            entry["runs"] += 1
            entry["result_chars"] += stats.get("result_chars", 0)
            entry["wall_seconds"] = round(entry["wall_seconds"] + stats.get("wall_seconds", 0), 3)
            entry["roles"].add(record.get("role") or "?")

    def view(label, entry):
        return {"label": label, "count": entry["count"], "runs": entry["runs"], "result_chars": entry["result_chars"],
                "est_context_tokens": entry["result_chars"] // 4, "wall_seconds": entry["wall_seconds"],
                "roles": sorted(entry["roles"])}
    commands = [view(k, v) for k, v in merged.items() if k.startswith(("Bash:", "PowerShell:")) and v["count"] >= 3]
    commands.sort(key=lambda v: (v["count"] * max(v["est_context_tokens"], 1)), reverse=True)
    mix = sorted((view(k, v) for k, v in merged.items()), key=lambda v: v["count"], reverse=True)
    return {"repeated_commands": commands[:10], "tool_mix": mix[:15],
            "method": "heuristic: normalized command labels repeated 3+ times; est_context_tokens = result chars / 4 "
                      "(estimate of tool output added to context, re-read as cache on later turns)"}


def coverage_missing(manifest, included, merged):
    """Gaps for what this wave's mode actually produces: a window group has no supervisor and no
    headless dispatch, so neither is missing; a manifest without a mode predates the field (supervised)."""
    mode = manifest.get("mode") or "supervised"
    missing = []
    if mode == "supervised" and not any(r.get("role") == "supervisor" for r in included):
        missing.append("supervisor transcript not ingested (python scripts/wave_profile.py ingest-supervisor --wave <id>)")
    if merged and not any(r.get("role") in ("reviewer", "proof-verifier") for r in included):
        missing.append("no landing capture usage for merged tasks (run landing_gate capture with DOTASK_WAVE_ID set)")
    if mode != "window" and not any(r.get("source") == "task.sh drive stream-json" for r in included):
        missing.append("no worker dispatch records for this wave (DOTASK_WAVE_ID unset on drive?)")
    if any(r.get("subagent_text_forwarding") is False for r in included):
        missing.append("some dispatches ran on a CLI without --forward-subagent-text; nested usage may be absent")
    return missing


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(value, indent=2, default=sorted), encoding="utf-8")
    for attempt in range(5):
        try:
            temp.replace(path)
            return
        except PermissionError:  # Windows: target briefly open by a concurrent reader
            if attempt == 4:
                raise
            time.sleep(0.1 * (attempt + 1))


# --- CLI ---------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    collect_cmd = sub.add_parser("run")
    collect_cmd.add_argument("--directory", required=True)
    collect_cmd.add_argument("--status-file")
    collect_cmd.add_argument("--wave", required=True)
    collect_cmd.add_argument("--tasks", required=True)
    collect_cmd.add_argument("--role", default="worker")
    collect_cmd.add_argument("--phase", default="implementation", choices=WORKER_PHASES)
    collect_cmd.add_argument("--model", choices=["sonnet", "opus"], required=True)
    collect_cmd.add_argument("--effort", default="medium", choices=EFFORTS)
    collect_cmd.add_argument("--reason", default="")
    collect_cmd.add_argument("--max-turns", type=int, default=120)
    collect_cmd.add_argument("--tools", help="experiment: comma-separated tool allowlist (DOTASK_TOOLS); unset by default")
    collect_cmd.add_argument("--claude-json", default='["claude"]', help=argparse.SUPPRESS)
    collect_cmd.add_argument("passthrough", nargs=argparse.REMAINDER)
    transcript = sub.add_parser("ingest")
    for flag in ["directory", "identity", "wave", "tasks", "role", "phase", "transcript"]:
        transcript.add_argument("--" + flag, required=True)
    transcript.add_argument("--since")
    transcript.add_argument("--until")
    supervisor = sub.add_parser("ingest-supervisor")
    supervisor.add_argument("--wave", required=True)
    supervisor.add_argument("--session", action="append")
    supervisor.add_argument("--project-dir")
    start = sub.add_parser("init")
    start.add_argument("--wave", required=True)
    start.add_argument("--task", action="append", required=True)
    start.add_argument("--points", action="append", help="T123=5 (story points; overrides PLAN.md Cmplx)")
    start.add_argument("--plan", default=str(REPO_ROOT / "docs/plans/PLAN.md"))
    start.add_argument("--exclusive", action="store_true", help="no other Claude usage on the account during the wave")
    start.add_argument("--mode", choices=WAVE_MODES, default="supervised",
                       help="window (user drives a VS Code session), headless (task.sh run), or supervised (legacy)")
    start.add_argument("--allow-existing", action="append",
                       help="dispatch this task even though origin/master already has a commit for it")
    status = sub.add_parser("task")
    status.add_argument("--wave", required=True)
    status.add_argument("--id", required=True)
    status.add_argument("--status", required=True,
                        choices=["planned", "wip", "blocked", "completed", "merged", "abandoned", "removed-from-batch"])
    status.add_argument("--note")
    status.add_argument("--add", action="store_true")
    status.add_argument("--add-points", type=int)
    group = sub.add_parser("batch")
    group.add_argument("--wave", required=True)
    group.add_argument("--id", required=True)
    group.add_argument("--tasks", required=True)
    group.add_argument("--reason", required=True)
    meter = sub.add_parser("quota")
    meter.add_argument("--wave", required=True)
    meter.add_argument("--when", choices=["before", "after"], required=True)
    meter.add_argument("--used-percent", type=float)
    meter.add_argument("--resets-at")
    meter.add_argument("--source", required=True)
    end = sub.add_parser("close")
    end.add_argument("--wave", required=True)
    annotate = sub.add_parser("note")
    annotate.add_argument("--wave", required=True)
    annotate.add_argument("--text", required=True)
    report = sub.add_parser("report")
    report.add_argument("--wave", required=True)
    report.add_argument("--manifest")
    report.add_argument("--output")
    report.add_argument("--landing-store")
    report.add_argument("directories", nargs="*")
    args = parser.parse_args(argv)
    try:
        if args.action == "run":
            if not SAFE_ID.fullmatch(args.wave):
                parser.error("wave id must match [A-Za-z0-9._-]+")
            if args.model == "opus" and (not args.reason or args.phase != "design"):
                parser.error("Opus requires --phase design and a design/root-cause --reason")
            if not 1 <= args.max_turns <= 500:
                parser.error("--max-turns must be between 1 and 500")
            if args.tools and not re.fullmatch(r"[A-Za-z]+(,[A-Za-z]+)*", args.tools):
                parser.error("--tools must be a comma list of [A-Za-z]+ tool names")
            try:
                validate_passthrough(args.passthrough)
            except ValueError as exc:
                parser.error(str(exc))
            return run(args)
        {"ingest": ingest, "ingest-supervisor": ingest_supervisor, "init": init, "task": task_status,
         "batch": batch, "quota": quota, "close": close, "note": note, "report": aggregate}[args.action](args)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
