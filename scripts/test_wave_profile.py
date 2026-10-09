"""Wave profiler behaviour against synthetic Claude stream-json and transcripts (no model calls)."""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave_profile as profile

FAKE_CLAUDE = r'''
import json, os, sys
argv = sys.argv[1:]
if "--help" in argv:
    print("--model  --forward-subagent-text" if os.environ.get("FAKE_FORWARD") == "1" else "--model")
    sys.exit(0)
Path = __import__("pathlib").Path
Path(os.environ["FAKE_ARGV"]).write_text(json.dumps(argv))
if os.environ.get("FAKE_TOUCH"):
    Path(os.environ["FAKE_TOUCH"]).write_text("edited")
for line in Path(os.environ["FAKE_EVENTS"]).read_text().splitlines():
    print(line, flush=True)
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
'''


def assistant(message_id, output, session="S", model="claude-sonnet-x", parent=None, content=None, **usage):
    event = {"type": "assistant", "session_id": session,
             "message": {"id": message_id, "model": model, "content": content or [{"type": "text", "text": "x"}],
                         "usage": {"input_tokens": usage.get("inp", 5), "output_tokens": output,
                                   "cache_read_input_tokens": usage.get("cr", 0),
                                   "cache_creation_input_tokens": usage.get("cw", 0)}}}
    if parent:
        event["parent_tool_use_id"] = parent
    return event


def agent_call(tool_id, role, parent=None, model=None):
    params = {"subagent_type": role, "prompt": "p", **({"model": model} if model else {})}
    event = assistant("m-" + tool_id, 1, content=[{"type": "tool_use", "id": tool_id, "name": "Agent", "input": params}])
    if parent:
        event["parent_tool_use_id"] = parent
    return event


def tool_result(tool_id, text="ok", parent=None, error=False):
    event = {"type": "user", "session_id": "S", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tool_id, "content": text, "is_error": error}]}}
    if parent:
        event["parent_tool_use_id"] = parent
    return event


def bash(tool_id, command):
    return assistant("m-" + tool_id, 1, content=[{"type": "tool_use", "id": tool_id, "name": "Bash", "input": {"command": command}}])


def result(subtype="success", model_usage=None, text="done"):
    return {"type": "result", "subtype": subtype, "session_id": "S", "is_error": subtype != "success",
            "result": text, "modelUsage": model_usage or {}}


class Dispatch(unittest.TestCase):
    """`run` drives a fake claude executable exactly as task.sh drive does."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.dispatches = 0
        self.status = self.root / ".dotask-status"
        fake = self.root / "fake_claude.py"
        fake.write_text(FAKE_CLAUDE)
        self.claude = json.dumps([sys.executable, str(fake)])
        self.env = {"FAKE_ARGV": str(self.root / "argv.json"), "FAKE_EVENTS": str(self.root / "events.jsonl"),
                    "FAKE_FORWARD": "1", "FAKE_EXIT": "0"}

    def dispatch(self, lines, phase="implementation", model="sonnet", reason="", passthrough=("--", "do it"),
                 tools=None, **env):
        self.dispatches += 1
        self.directory = self.root / f"profile{self.dispatches}"
        (self.root / "events.jsonl").write_text("\n".join(line if isinstance(line, str) else json.dumps(line) for line in lines) + "\n")
        args = SimpleNamespace(directory=str(self.directory), status_file=str(self.status), wave="w", tasks="t7",
                               role="worker", phase=phase, model=model, effort="medium", reason=reason, max_turns=120,
                               claude_json=self.claude, passthrough=list(passthrough), tools=tools)
        with patch.dict(os.environ, {**self.env, **env}), contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            code = profile.run(args)
        records = {r["run_id"]: r for r in (json.loads(p.read_text()) for p in self.directory.glob("*.json"))}
        parent = next(r for r in records.values() if "parent_run_id" not in r)
        return code, parent, [r for r in records.values() if "parent_run_id" in r]

    def status_lines(self):
        return self.status.read_text().splitlines() if self.status.exists() else []

    def test_wrapper_owns_flags_and_omits_unsupported_forwarding(self):
        self.dispatch([assistant("m1", 3), result()], passthrough=("--", "-c", "continue"))
        argv = json.loads((self.root / "argv.json").read_text())
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet")
        self.assertEqual(argv[argv.index("--max-turns") + 1], "120")
        self.assertIn("--forward-subagent-text", argv)
        self.assertEqual(argv[-2:], ["-c", "continue"])
        _, parent, _ = self.dispatch([assistant("m2", 3), result()], FAKE_FORWARD="0")
        self.assertNotIn("--forward-subagent-text", json.loads((self.root / "argv.json").read_text()))
        self.assertFalse(parent["subagent_text_forwarding"])

    def test_controlled_or_unknown_flags_are_rejected(self):
        for bad in (["--model", "opus", "x"], ["--fallback-model", "opus", "x"], ["--agents", "{}", "x"],
                    ["--settings", "{}", "x"], ["-c"], []):
            with self.assertRaises(ValueError, msg=bad):
                profile.validate_passthrough(bad)
        self.assertEqual(profile.validate_passthrough(["--", "fix --model handling"]), ["fix --model handling"])

    def test_malformed_records_never_change_the_dispatch_outcome(self):
        code, parent, _ = self.dispatch([assistant("m1", 10), {"type": "system", "message": None},
                                         '"just a string"', "{", result()])
        self.assertEqual(code, 0)
        self.assertEqual(parent["models"]["claude-sonnet-x"]["output_tokens"], 10)
        self.assertEqual(parent["malformed_lines"], 2)
        self.assertNotIn("profiling_error", parent)

    def test_profiling_crash_is_recorded_not_propagated(self):
        with patch.object(profile, "finish", side_effect=RuntimeError("boom")):
            code, parent, _ = self.dispatch([assistant("m1", 10), result()])
        self.assertEqual(code, 0)
        self.assertIn("boom", parent["profiling_error"])

    def test_bookkeeping_io_failure_keeps_the_worker_exit_code(self):
        (self.root / "events.jsonl").write_text(json.dumps(assistant("m1", 3)) + "\n" + json.dumps(result()) + "\n")
        self.status.mkdir()  # appending a status line now raises an OSError
        args = SimpleNamespace(directory=str(self.root / "pd"), status_file=str(self.status), wave="w", tasks="t7",
                               role="worker", phase="implementation", model="sonnet", effort="medium", reason="",
                               max_turns=120, claude_json=self.claude, passthrough=["--", "go"])
        with patch.dict(os.environ, self.env), patch.object(profile, "write_json", side_effect=OSError("disk full")), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(profile.run(args), 0)
        self.assertIn("not written", err.getvalue())

    def test_nested_agents_are_split_linked_and_completed(self):
        code, parent, children = self.dispatch([
            agent_call("toolu_A", "implementor"),
            agent_call("toolu_B", "expert", parent="toolu_A"),
            assistant("g1", 50, model="claude-opus-x", parent="toolu_B"),
            tool_result("toolu_B", parent="toolu_A"),
            assistant("c1", 20, parent="toolu_A"),
            tool_result("toolu_A"),
            agent_call("toolu_C", "reviewer"),
            assistant("p2", 7), result()])
        by_agent = {c["agent_id"]: c for c in children}
        self.assertEqual(by_agent["toolu_B"]["parent_run_id"], by_agent["toolu_A"]["run_id"])
        self.assertTrue(by_agent["toolu_A"]["complete"] and by_agent["toolu_B"]["complete"])
        self.assertEqual(by_agent["toolu_B"]["category"], "design/root-cause")
        self.assertEqual(by_agent["toolu_B"]["requested_model"], "agent default (see observed models)")
        self.assertNotIn("exit_code", by_agent["toolu_B"])
        self.assertFalse(by_agent["toolu_C"]["usage_forwarded"])  # spawned, never forwarded: a visible gap
        self.assertEqual(parent["policy_violations"], [])  # expert on Opus is a sanctioned escalation
        self.assertNotIn("claude-opus-x", parent["models"])

    def test_opus_outside_design_roles_is_flagged(self):
        _, parent, _ = self.dispatch([agent_call("toolu_A", "tester"),
                                      assistant("c1", 9, model="claude-opus-x", parent="toolu_A"), result()])
        self.assertTrue(any("tester" in v for v in parent["policy_violations"]))

    def test_budget_and_quota_stops_are_not_success_and_leave_a_status_line(self):
        code, parent, _ = self.dispatch([assistant("m1", 3), result("error_max_turns")], FAKE_EXIT="1")
        self.assertEqual((code, parent["complete"], parent["outcome_class"]), (1, False, "budget_stop"))
        self.assertIn("DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop", self.status_lines()[-1])
        _, parent, _ = self.dispatch([result("success", text="Claude AI usage limit reached|1760000000")])
        self.assertEqual(parent["outcome_class"], "quota_exhausted")
        # Shape observed from CLI 2.1.280 without credentials: subtype success + is_error.
        auth = {"type": "assistant", "error": "authentication_failed", "is_api_error_message": True, "session_id": "S",
                "message": {"id": "4d42", "model": "<synthetic>", "content": [{"type": "text", "text": "Not logged in"}],
                            "usage": {"input_tokens": 0, "output_tokens": 0}}}
        cli_result = {**result(text="Not logged in · Please run /login"), "is_error": True,
                      "subagent_stats": {"spawned": 0}, "terminal_reason": "api_error"}
        code, parent, _ = self.dispatch([auth, cli_result], FAKE_EXIT="1")
        self.assertEqual((parent["outcome_class"], parent["requests"], parent["models"]), ("auth_failed", 0, {}))
        self.assertEqual(parent["terminal_reason"], "api_error")

    def test_worker_status_line_suppresses_wrapper_line(self):
        self.status.write_text("2026-10-08T10:00 STAGE_DONE plan\n")
        self.dispatch([assistant("m1", 3), result()])
        self.assertEqual(self.status_lines()[-1].split(" ", 1)[1], "ENDED_WITHOUT_STATUS phase=implementation")
        with open(self.status, "a") as stream:
            stream.write("2026-10-08T10:05 IMPL_READY\n")
        size = self.status.stat().st_size
        script = f"open({str(self.status)!r}, 'a').write('2026-10-08T10:06 IMPL_READY again\\n')"
        with patch.object(profile, "build_command", return_value=[sys.executable, "-c", script]):
            self.dispatch([])
        self.assertTrue(self.status_lines()[-1].endswith("IMPL_READY again"))
        self.assertGreater(self.status.stat().st_size, size)

    def test_reconciliation_reports_result_only_usage(self):
        usage = {"claude-sonnet-x": {"inputTokens": 5, "outputTokens": 10},
                 "claude-haiku-x": {"inputTokens": 900, "outputTokens": 40}}
        _, parent, _ = self.dispatch([assistant("m1", 10), result(model_usage=usage)])
        self.assertEqual(parent["reconciliation"]["status"], "result_exceeds_requests")
        self.assertEqual(parent["reconciliation"]["residual"]["claude-haiku-x"]["input_tokens"], 900)

    def test_design_phase_source_edit_is_a_violation(self):
        repo = self.root / "repo"
        (repo / "src").mkdir(parents=True)
        (repo / "src" / "a.py").write_text("a = 1\n")
        for command in (["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"]):
            subprocess.run(["git", "-C", str(repo), *command], check=True, capture_output=True)
        cwd = os.getcwd()
        os.chdir(repo)
        try:
            code, parent, _ = self.dispatch([assistant("m1", 3), result()], phase="design", model="opus",
                                            reason="root cause", FAKE_TOUCH=str(repo / "src" / "a.py"))
            self.assertEqual(code, 3)
            self.assertIn("src/a.py", " ".join(parent["policy_violations"]))
            self.assertIn("PHASE_VIOLATION", self.status_lines()[-1])
            code, parent, _ = self.dispatch([assistant("m2", 3), result()], phase="design", model="opus",
                                            reason="root cause", FAKE_TOUCH=str(repo / "docs-spec.md"))
        finally:
            os.chdir(cwd)
        self.assertEqual(code, 3)  # a new untracked file outside docs/ is still source

    def test_opus_cli_guard(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            profile.main(["run", "--directory", str(self.root / "p"), "--wave", "w", "--tasks", "t",
                          "--phase", "implementation", "--model", "opus", "--reason", "x", "--", "go"])

    def test_heartbeat_tool_progress_never_creates_a_phantom_child_record(self):
        """A tool_progress event carrying parent_tool_use_id of a plain Bash call must not
        be grouped into a child "agent" record (only real Agent/Task tool_use ids group)."""
        _, _, children = self.dispatch([
            bash("toolu_bash", "ls"),
            {"type": "tool_progress", "session_id": "S", "parent_tool_use_id": "toolu_bash", "message": {}},
            tool_result("toolu_bash"),
            assistant("m1", 5), result()])
        self.assertEqual(children, [])

    def test_dotask_tools_passthrough_is_optional(self):
        self.dispatch([assistant("m1", 3), result()], tools="Read,Bash")
        argv = json.loads((self.root / "argv.json").read_text())
        self.assertEqual(argv[argv.index("--tools") + 1], "Read,Bash")
        self.dispatch([assistant("m2", 3), result()])
        self.assertNotIn("--tools", json.loads((self.root / "argv.json").read_text()))

    def test_tools_flag_is_validated(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            profile.main(["run", "--directory", str(self.root / "p3"), "--wave", "w", "--tasks", "t",
                          "--phase", "implementation", "--model", "sonnet", "--tools", "bad flag", "--", "go"])

    def test_transcript_usage_overrides_understated_stream_usage(self):
        """stream-json under-reports some output_tokens; the on-disk transcript is authoritative.
        A higher transcript value for the SAME message id must win (field-wise max)."""
        config_dir = self.root / "claudecfg"
        slug = re.sub(r"[^A-Za-z0-9]", "-", os.getcwd())
        project = config_dir / "projects" / slug
        project.mkdir(parents=True)
        (project / "S.jsonl").write_text(json.dumps(assistant("m1", 500, session="S")) + "\n")
        code, parent, _ = self.dispatch([assistant("m1", 10), result()], CLAUDE_CONFIG_DIR=str(config_dir))
        self.assertEqual(code, 0)
        self.assertEqual(parent["models"]["claude-sonnet-x"]["output_tokens"], 500)
        self.assertEqual(parent["usage_source"], "stream+transcript")
        # A session with no matching transcript file leaves the stream value untouched.
        _, parent2, _ = self.dispatch([assistant("m2", 10), result()])
        self.assertEqual(parent2["models"]["claude-sonnet-x"]["output_tokens"], 10)
        self.assertEqual(parent2["usage_source"], "stream")


class Report(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        patcher = patch.object(profile, "TASKS_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.plan = self.root / "PLAN.md"
        self.plan.write_text("| ID | Task | Impact | Cmplx | Pri |\n|---|---|---|---|---|\n| T1 | a | 5 | 3 | 1 |\n| T2 | b | 5 | 8 | 1 |\n")
        self.cli("init", "--wave", "w", "--task", "T1", "--task", "t2", "--plan", str(self.plan))
        self.profiles = self.root / "waves" / "w" / "profiles"

    def cli(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return profile.main(list(argv))

    def report(self):
        self.assertEqual(self.cli("report", "--wave", "w"), 0)
        return json.loads((self.root / "waves" / "w" / "profile.json").read_text())

    def record(self, run_id, category="implementation", models=None, requests=None, **extra):
        record = {"schema_version": 2, "run_id": run_id, "wave_id": "w", "category": category, "complete": True,
                  "role": "worker", "task_ids": ["T1"], "models": models or {}, **extra}
        if requests is not None:
            record["request_records"] = requests
        profile.write_json(self.profiles / (run_id + ".json"), record)

    @staticmethod
    def request(message_id, output, session="S", model="m", **usage):
        return {"session_id": session, "message_id": message_id, "model": model,
                "usage": {**profile.zero(), "output_tokens": output, **usage}}

    def test_points_are_frozen_from_plan_and_reported_honestly(self):
        self.cli("task", "--wave", "w", "--id", "T1", "--status", "merged")
        self.cli("task", "--wave", "w", "--id", "T2", "--status", "completed")
        self.record("a", requests=[self.request("m1", 110)])
        points = self.report()["points"]
        self.assertTrue(points["frozen_digest_matches"])
        self.assertEqual((points["planned"], points["completed"], points["merged"]), (11, 11, 3))
        self.assertIn("provisional", points["sources"][0])
        self.assertEqual(points["tokens_per_merged_point"]["output_tokens"], 36.7)
        manifest_path = self.root / "waves" / "w" / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["tasks"][0]["points"] = 13
        manifest_path.write_text(json.dumps(manifest))
        self.assertFalse(self.report()["points"]["frozen_digest_matches"])
        self.assertEqual(self.cli("init", "--wave", "w", "--task", "T9"), 2)  # refuses to re-freeze

    def test_stream_and_transcript_sources_are_deduplicated(self):
        self.record("run", requests=[self.request("msg_1", 100)])
        transcript = self.root / "t.jsonl"
        event = assistant("msg_1", 100)
        event["sessionId"] = event.pop("session_id")
        transcript.write_text(json.dumps(event) + "\n")
        self.cli("ingest", "--directory", str(self.profiles), "--identity", "imp", "--wave", "w", "--tasks", "T1",
                 "--role", "supervisor", "--phase", "supervisor", "--transcript", str(transcript))
        report = self.report()
        self.assertEqual(report["tokens"]["output_tokens"], 100)
        self.assertEqual(report["coverage"]["duplicate_requests_skipped"], 1)

    def test_capture_totals_superseded_by_request_level_import_of_same_session(self):
        self.record("cap", category="review/proof", session_id="CAP", models={"m": {**profile.zero(), "output_tokens": 10}})
        self.record("tx", category="review/proof", requests=[self.request("msg_9", 10, session="CAP")])
        report = self.report()
        self.assertEqual(report["tokens"]["output_tokens"], 10)
        self.assertEqual(report["coverage"]["superseded_totals_records"], ["cap"])

    def test_categories_rank_by_output_not_cache_reads(self):
        self.record("qa", "tests/QA", requests=[self.request("q", 5000, cache_read_input_tokens=2_000_000)])
        self.record("design", "design/root-cause", requests=[self.request("d", 400_000, model="opus")])
        self.record("impl", "implementation", requests=[self.request("i", 9000)])
        self.record("sup", "coordination", requests=[self.request("s", 100)])
        report = self.report()
        self.assertEqual([c["category"] for c in report["top_categories"]], ["design/root-cause", "implementation", "tests/QA"])
        self.assertEqual(report["categories"]["design/root-cause"]["opus"]["output_tokens"], 400_000)

    def test_coverage_gaps_are_derived_not_copied(self):
        self.cli("task", "--wave", "w", "--id", "T1", "--status", "merged")
        stray = {"schema_version": 2, "run_id": "s", "wave_id": "standalone-t1", "category": "implementation",
                 "complete": True, "models": {}, "request_records": [self.request("z", 999)]}
        profile.write_json(self.root / "profiles" / "t1" / "s.json", stray)
        running = {"schema_version": 2, "run_id": "killed", "wave_id": "w", "category": "implementation",
                   "outcome": "running", "complete": False, "source": "task.sh drive stream-json"}
        live = self.root / "t1" / ".dotask-profile"
        profile.write_json(live / "killed.json", running)
        (live / "killed.jsonl").write_text(json.dumps(assistant("k1", 500)) + "\n")
        (live / "orphan.jsonl").write_text(json.dumps(assistant("o1", 1)) + "\n")
        report = self.report()
        coverage = report["coverage"]
        self.assertEqual(report["tokens"]["output_tokens"], 500)
        self.assertEqual(coverage["stale_running"], ["killed"])
        self.assertEqual(coverage["excluded_other_waves"], {"standalone-t1": 1})
        self.assertTrue(coverage["orphan_raw_logs"][0].endswith("orphan.jsonl"))
        self.assertTrue(any("supervisor" in m for m in coverage["missing"]))
        self.assertTrue(any("landing capture" in m for m in coverage["missing"]))

    def test_cli_spawned_count_is_checked_against_nested_records(self):
        self.record("p", requests=[], subagent_stats={"spawned": 2}, nested_agents=["p-toolu_A"])
        self.record("q", requests=[], subagent_stats={"spawned": 1}, nested_agents=["q-toolu_B"])
        self.assertEqual(self.report()["coverage"]["nested_agent_count_mismatch"], {"p": {"cli_spawned": 2, "records": 1}})

    def test_quota_delta_only_from_comparable_operator_snapshots(self):
        manifest_path = self.root / "waves" / "w" / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["quota"]["delta"] = 0.42
        manifest_path.write_text(json.dumps(manifest))
        quota = self.report()["quota"]
        self.assertIsNone(quota["delta_percent_points"])
        self.assertEqual(quota["ignored_manifest_delta"], 0.42)
        self.cli("quota", "--wave", "w", "--when", "before", "--used-percent", "20", "--resets-at", "R1", "--source", "/usage")
        self.cli("quota", "--wave", "w", "--when", "after", "--used-percent", "31.5", "--resets-at", "R2", "--source", "/usage")
        self.assertIn("different reset windows", self.report()["quota"]["status"])
        self.cli("quota", "--wave", "w", "--when", "after", "--used-percent", "31.5", "--resets-at", "R1", "--source", "/usage")
        quota = self.report()["quota"]
        self.assertEqual(quota["delta_percent_points"], 11.5)
        self.assertIn("concurrent", quota["contamination"])

    def test_meta_steps_and_automation_candidates(self):
        meta = self.root / "profiles" / "t1" / "meta.jsonl"
        meta.parent.mkdir(parents=True)
        meta.write_text("\n".join(json.dumps({"wave_id": wave, "step": step, "seconds": s, "exit_code": rc})
                                  for wave, step, s, rc in [("w", "container_wake", 41.5, 0), ("w", "container_wake", 3.5, 0),
                                                            ("w", "auth_status", 1.0, 1), ("other", "container_wake", 99, 0)]) + "\n")
        activity = {"Bash: bash task.sh test": {"count": 4, "result_chars": 8000, "wall_seconds": 120.0}}
        self.record("a", requests=[], tool_activity=activity, duration_seconds=300.0, source="task.sh drive stream-json")
        self.record("b", requests=[], tool_activity=activity)
        report = self.report()
        steps = report["meta"]["host_steps"]
        self.assertEqual(steps["container_wake"], {"count": 2, "total_seconds": 45.0, "max_seconds": 41.5, "failures": 0})
        self.assertEqual(steps["auth_status"]["failures"], 1)
        self.assertEqual(report["meta"]["model_time_seconds_estimate"], 180.0)
        top = report["automation_candidates"]["repeated_commands"][0]
        self.assertEqual((top["label"], top["count"], top["runs"], top["est_context_tokens"]), ("Bash: bash task.sh test", 8, 2, 4000))

    def test_supervisor_ingest_finds_session_and_subagents_within_window(self):
        project = self.root / "project"
        session = "sess-1"
        (project / session / "subagents").mkdir(parents=True)
        manifest = json.loads((self.root / "waves" / "w" / "manifest.json").read_text())
        early = {**assistant("old", 999), "timestamp": "2000-01-01T00:00:00Z"}
        inside = {**bash("toolu_1", "DOTASK_WAVE_ID=w bash scripts/task.sh drive t1 go"), "timestamp": manifest["created_at"]}
        (project / f"{session}.jsonl").write_text(json.dumps(early) + "\n" + json.dumps(inside) + "\n")
        (project / "unrelated.jsonl").write_text(json.dumps(assistant("u", 5)) + "\n")
        agent = project / session / "subagents" / "agent-a1.jsonl"
        agent.write_text(json.dumps({**assistant("sub", 70, model="claude-opus-x"), "timestamp": manifest["created_at"]}) + "\n")
        agent.with_suffix(".meta.json").write_text(json.dumps({"agentType": "expert", "toolUseId": "toolu_9"}))
        self.assertEqual(self.cli("ingest-supervisor", "--wave", "w", "--project-dir", str(project)), 0)
        report = self.report()
        roles = {a["role"]: a for a in report["agents"]}
        self.assertEqual(set(roles), {"supervisor", "expert"})
        self.assertEqual(report["tokens"]["output_tokens"], 71)  # the pre-wave record is excluded
        self.assertEqual(report["categories"]["design/root-cause"]["claude-opus-x"]["output_tokens"], 70)
        self.assertEqual(json.loads((self.root / "waves" / "w" / "manifest.json").read_text())["supervisor_session_ids"], [session])

    def test_init_refuses_a_task_already_merged_on_origin_master(self):
        repo = self.root / "gitrepo"
        repo.mkdir()

        def git(*args):
            subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
        git("init", "-q")
        (repo / "f.txt").write_text("x")
        git("add", ".")
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "T9000: landed already")
        sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
        git("update-ref", "refs/remotes/origin/master", sha)
        cwd = os.getcwd()
        os.chdir(repo)
        try:
            self.assertEqual(self.cli("init", "--wave", "w2", "--task", "T9000", "--plan", str(self.plan)), 2)
            self.assertFalse((self.root / "waves" / "w2" / "manifest.json").exists())
            self.assertEqual(self.cli("init", "--wave", "w2", "--task", "T9000", "--allow-existing", "T9000",
                                      "--plan", str(self.plan)), 0)
        finally:
            os.chdir(cwd)
        self.assertTrue((self.root / "waves" / "w2" / "manifest.json").exists())

    def test_note_appends_to_manifest(self):
        self.cli("note", "--wave", "w", "--text", "quota reset at midnight")
        manifest = json.loads((self.root / "waves" / "w" / "manifest.json").read_text())
        self.assertEqual(manifest["notes"][-1]["text"], "quota reset at midnight")
        self.cli("note", "--wave", "w", "--text", "second note")
        manifest = json.loads((self.root / "waves" / "w" / "manifest.json").read_text())
        self.assertEqual([n["text"] for n in manifest["notes"]], ["quota reset at midnight", "second note"])

    def test_duplicate_message_ids_are_max_merged_not_first_wins_or_summed(self):
        self.record("a", requests=[self.request("dup", 50, cache_read_input_tokens=100)])
        self.record("b", requests=[self.request("dup", 80, cache_read_input_tokens=40)])
        report = self.report()
        self.assertEqual(report["tokens"]["output_tokens"], 80)
        self.assertEqual(report["tokens"]["cache_read_input_tokens"], 100)
        self.assertEqual(report["coverage"]["duplicate_requests_skipped"], 1)

    def test_meta_tokens_buckets_split_supervisor_captures_abandoned_and_worker_activity(self):
        self.record("sup", category="coordination", role="supervisor", requests=[self.request("s1", 20)])
        self.record("cap", category="review/proof", requests=[self.request("c1", 30)])
        self.record("aband", task_ids=["T9"], requests=[self.request("ab1", 40)])
        self.cli("task", "--wave", "w", "--id", "T9", "--status", "abandoned", "--add")
        book_req, orient_req, work_req = self.request("bk1", 5), self.request("or1", 7), self.request("wk1", 100)
        book_req["activity"], orient_req["activity"], work_req["activity"] = "bookkeeping", "orientation", "edit"
        self.record("work", task_ids=["T1"], requests=[book_req, orient_req, work_req])
        meta = self.report()["meta_tokens"]
        self.assertEqual(meta["supervisor"]["output_tokens"], 20)
        self.assertEqual(meta["captures"]["output_tokens"], 30)
        self.assertEqual(meta["abandoned_task_runs"]["output_tokens"], 40)
        self.assertEqual(meta["worker_bookkeeping"]["output_tokens"], 5)
        self.assertEqual(meta["worker_orientation"]["output_tokens"], 7)
        self.assertEqual(meta["productive"]["output_tokens"], 100)
        self.assertIn("heuristic", meta["method"])

    def test_window_group_coverage_has_no_supervisor_or_dispatch_noise(self):
        # A window-driven /dotask group has no supervisor and no headless dispatch (2026-10-08 groups
        # g-t12110-8 / g-t12190-4 reported both as "missing" on every run).
        self.cli("init", "--wave", "win", "--task", "T1", "--plan", str(self.plan), "--mode", "window")
        profile.write_json(self.root / "waves" / "win" / "profiles" / "worker-s.json",
                           {"schema_version": 2, "run_id": "worker-s", "wave_id": "win", "category": "implementation",
                            "role": "worker", "task_ids": ["T1"], "models": {}, "source": "transcript s.jsonl",
                            "request_records": [self.request("m1", 10)]})
        self.assertEqual(self.cli("report", "--wave", "win"), 0)
        report = json.loads((self.root / "waves" / "win" / "profile.json").read_text())
        self.assertEqual(report["wave"]["mode"], "window")
        self.assertEqual(report["coverage"]["missing"], [])

    def test_headless_group_still_expects_dispatch_records_but_no_supervisor(self):
        self.cli("init", "--wave", "hl", "--task", "T1", "--plan", str(self.plan), "--mode", "headless")
        self.assertEqual(self.cli("report", "--wave", "hl"), 0)
        missing = json.loads((self.root / "waves" / "hl" / "profile.json").read_text())["coverage"]["missing"]
        self.assertFalse(any("supervisor" in m for m in missing))
        self.assertTrue(any("dispatch records" in m for m in missing))

    def test_a_manifest_without_mode_keeps_the_supervised_checks(self):
        missing = self.report()["coverage"]["missing"]
        self.assertTrue(any("supervisor" in m for m in missing))
        self.assertTrue(any("dispatch records" in m for m in missing))

    def test_an_ingested_transcript_is_not_an_orphan_raw_log(self):
        # land copies every group's transcripts into the shared TASKS_ROOT/profiles/<slug>/transcripts;
        # only this wave's own group (wave id = <slug>-<timestamp>) can have orphans there.
        wave = "g-t1-1-20261008T2227"
        self.cli("init", "--wave", wave, "--task", "T1", "--plan", str(self.plan), "--mode", "window")
        for slug, names in (("g-t1-1", ("abc", "never-ingested")), ("g-t9-1", ("other-group",)),
                            ("g-t1-1-2", ("longer-slug",))):  # a slug that extends ours is another group
            raw_dir = self.root / "profiles" / slug / "transcripts" / "-workspace"
            raw_dir.mkdir(parents=True)
            for name in names:
                (raw_dir / f"{name}.jsonl").write_text(json.dumps(assistant(name, 1)) + "\n")
        profile.write_json(self.root / "waves" / wave / "profiles" / "worker-abc.json",
                           {"schema_version": 2, "run_id": "worker-abc", "wave_id": wave, "category": "implementation",
                            "role": "worker", "task_ids": ["T1"], "models": {}, "source": "transcript abc.jsonl",
                            "request_records": [self.request("abc", 1)]})
        self.assertEqual(self.cli("report", "--wave", wave), 0)
        orphans = json.loads((self.root / "waves" / wave / "profile.json").read_text())["coverage"]["orphan_raw_logs"]
        self.assertEqual([Path(p).name for p in orphans], ["never-ingested.jsonl"])

    def test_completed_points_give_tokens_per_completed_point(self):
        self.cli("task", "--wave", "w", "--id", "T1", "--status", "completed")
        self.record("a", requests=[self.request("m1", 30, cache_read_input_tokens=300)])
        points = self.report()["points"]
        self.assertEqual(points["completed"], 3)
        self.assertEqual(points["tokens_per_completed_point"]["output_tokens"], 10.0)
        self.assertEqual(points["tokens_per_completed_point"]["cache_read_input_tokens"], 100.0)

    def test_context_growth_per_run_follows_request_order(self):
        # One long multi-task session re-reads a growing context on every request (48k -> 190k measured).
        self.record("a", requests=[self.request("r1", 1, cache_read_input_tokens=40_000, cache_creation_input_tokens=8_000),
                                   self.request("r2", 1, cache_read_input_tokens=90_000),
                                   self.request("r3", 1, cache_read_input_tokens=70_000)])
        growth = self.report()["context_growth"]["a"]
        self.assertEqual(growth, {"requests": 3, "first": 48_000, "last": 70_000, "peak": 90_000, "mean": 69_333})

    def test_a_test_run_that_writes_qa_logs_is_test_not_bookkeeping(self):
        def tool(command):
            return [{"type": "tool_use", "name": "Bash", "input": {"command": command}}]
        self.assertEqual(profile.classify_request_activity(
            tool("npx vitest run src/x.test.jsx > ../../qa/red-x.log 2>&1; echo $?")), "test")
        self.assertEqual(profile.classify_request_activity(
            tool("echo '2026-10-08T22:34 STAGE_DONE T1 commit' >> /workspace/.dotask-status")), "bookkeeping")
        self.assertEqual(profile.classify_request_activity(tool("git status --short")), "bookkeeping")

    def test_implementation_checkpoint_matches_the_kickoff_protocol(self):
        # Appended to every headless dispatch: "append IMPL_READY" here contradicted the kickoff's
        # per-task commit line and made task.sh run chain QA after the first task (PR 576 review).
        text = profile.CHECKPOINTS["implementation"]
        self.assertNotIn("IMPL_READY", text)
        self.assertIn("STAGE_DONE <task> commit", text)
        self.assertIn("PUSHREADY <branch> <sha>", text)

    def test_command_labels_generalize_arguments(self):
        self.assertEqual(profile.normalize_command("cd /c/x && DOTASK_PHASE=qa bash scripts/task.sh drive t12 -c 'go'"),
                         "bash task.sh drive")
        self.assertEqual(profile.normalize_command("git diff --stat abc1234 | tail -5"), "git diff <n>")
        self.assertEqual(profile.normalize_command(""), "<empty>")


if __name__ == "__main__":
    unittest.main()
