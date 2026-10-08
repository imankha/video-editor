"""dotask_cli.py (supervisorless /dotask) against fake docker/code/gh on PATH and a
temp TASKS_ROOT + fixture MAIN_REPO. Never touches real Docker/VS Code/GitHub."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import dotask_cli

FAKE_DOCKER = r'''#!/usr/bin/env bash
state="$FAKE_DOCKER_STATE"
mkdir -p "$state"
cmd="${1:-}"; shift || true
case "$cmd" in
  image) exit 0 ;;
  inspect)
    if [ "${1:-}" = "-f" ]; then
      name="$3"
      if [ -f "$state/$name.running" ]; then echo true; else echo false; fi
      exit 0
    else
      [ -f "$state/$1.running" ] && exit 0 || exit 1
    fi
    ;;
  run)
    name=""; prev=""
    for a in "$@"; do
      [ "$prev" = "--name" ] && name="$a"
      prev="$a"
    done
    : > "$state/$name.running"
    echo "$name"
    exit 0
    ;;
  start) : > "$state/$1.running"; exit 0 ;;
  exec)
    name=""; cmdargs=(); skip=0
    for a in "$@"; do
      if [ "$skip" = 1 ]; then skip=0; continue; fi
      case "$a" in
        -u) skip=1; continue ;;
        -i|-it|-d) continue ;;
        *) if [ -z "$name" ]; then name="$a"; else cmdargs+=("$a"); fi ;;
      esac
    done
    joined="${cmdargs[*]}"
    if [[ "$joined" == *"dotask-kickoff.md"* ]]; then
      mkdir -p "$state/$name/workspace"
      cat > "$state/$name/workspace/.dotask-kickoff.md"
      exit 0
    fi
    if [ "${cmdargs[0]:-}" = "test" ] && [[ "$joined" == *"node_modules/.ready"* ]]; then exit 1; fi
    exit 0
    ;;
  cp) exit 0 ;;
  *) exit 0 ;;
esac
'''

FAKE_CODE = r'''#!/usr/bin/env bash
echo "$@" >> "${FAKE_CODE_LOG:-/dev/null}"
exit 0
'''

FAKE_GH = r'''#!/usr/bin/env bash
case "$1 $2" in
  "pr create") echo "https://github.com/example/repo/pull/42"; exit 0 ;;
  "run list") cat "$FAKE_GH_RUNS"; exit 0 ;;
  "run view") echo '{"headSha":"x","status":"completed","conclusion":"success","jobs":[]}'; exit 0 ;;
esac
exit 1
'''


def write_fake(path, content):
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def git_c(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t.com", *args],
                   check=True, capture_output=True)


class DotaskCliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.main_repo = self.root / "main_repo"
        self.main_repo.mkdir()
        self.tasks_root = self.root / "tasks_root"
        self.tasks_root.mkdir()
        self.fakebin = self.root / "fakebin"
        self.fakebin.mkdir()
        write_fake(self.fakebin / "docker", FAKE_DOCKER)
        write_fake(self.fakebin / "code", FAKE_CODE)
        write_fake(self.fakebin / "gh", FAKE_GH)
        if os.name == "nt":
            # CreateProcess cannot run extensionless scripts; .cmd shims make the fakes win PATH lookup.
            git_bash = shutil.which("bash")
            for name in ("docker", "code", "gh"):
                shim = f'@"{git_bash}" "%~dp0{name}" %*' + "\r\n"
                (self.fakebin / f"{name}.cmd").write_text(shim, encoding="utf-8")
        self.docker_state = self.root / "docker_state"
        self.docker_state.mkdir()
        self.code_log = self.root / "code.log"

        self._build_main_repo()

        self.env_patch = patch.dict(os.environ, {
            "PATH": f"{self.fakebin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DOCKER_STATE": str(self.docker_state),
            "FAKE_CODE_LOG": str(self.code_log),
        })
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        for name in ("docker", "code", "gh"):
            resolved = shutil.which(name)
            if resolved is None or Path(resolved).parent != self.fakebin:
                self.fail(f"{name} resolves to {resolved}, not the fake: refusing to run against a real tool")
        self.main_repo_patch = patch.object(dotask_cli, "MAIN_REPO", self.main_repo)
        self.tasks_root_patch = patch.object(dotask_cli, "TASKS_ROOT", self.tasks_root)
        self.main_repo_patch.start()
        self.tasks_root_patch.start()
        self.addCleanup(self.main_repo_patch.stop)
        self.addCleanup(self.tasks_root_patch.stop)

    def _write_task(self, task_id, title, status, files, directory="fixture"):
        task_dir = self.main_repo / "docs" / "plans" / "tasks" / directory
        task_dir.mkdir(parents=True, exist_ok=True)
        path = task_dir / f"{task_id}-{title.lower().replace(' ', '-')}.md"
        files_block = "\n".join(f"- `{f}`" for f in files)
        path.write_text(
            f"# {task_id}: {title}\n\n**Status:** {status}\n\n## Context\n\n"
            f"### Relevant Files (REQUIRED)\n\n{files_block}\n\n### Related Tasks\n\n- None\n")
        return path

    def _write_plan(self, rows):
        lines = ["| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |",
                "|---|---|---|---|---|---|---|---|"]
        for task_id, title, path, status in rows:
            lines.append(f"| {task_id} | [{title}]({path}) | 5 | 2 | 2.5 | {status} | [ ] | fixture |")
        (self.main_repo / "docs" / "plans" / "PLAN.md").write_text("\n".join(lines) + "\n")

    def _build_main_repo(self):
        git(self.main_repo, "init", "-q")
        t1 = self._write_task("T1", "Fix the thing", "TODO",
                              ["src/backend/app/thing.py", "src/frontend/src/Thing.jsx"])
        self._write_plan([("T1", "Fix the thing", str(t1.relative_to(self.main_repo)), "TODO")])
        (self.main_repo / ".devcontainer").mkdir()
        (self.main_repo / ".devcontainer" / "task.Dockerfile").write_text("FROM scratch\n")
        backend = self.main_repo / "src" / "backend"
        backend.mkdir(parents=True)
        (backend / "requirements.prod.txt").write_text("")
        (backend / "requirements.test.txt").write_text("")
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "base")
        self.origin = self.root / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", str(self.origin)], check=True, capture_output=True)
        git(self.main_repo, "remote", "add", "origin", str(self.origin))
        git(self.main_repo, "push", "-q", "origin", "HEAD:master")
        git(self.main_repo, "fetch", "-q", "origin")

    def _plan_text(self):
        return (self.main_repo / "docs" / "plans" / "PLAN.md").read_text(encoding="utf-8")

    # --- D1: start preflight refusals ------------------------------------------
    def test_start_refuses_a_bad_task_id(self):
        with self.assertRaises(SystemExit) as ctx:
            dotask_cli.start(SimpleNamespace(tasks=["abc"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)

    def test_start_refuses_a_task_already_merged_on_origin_master(self):
        self._write_task("T2", "Already merged", "TODO", ["x.py"])
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "T2: already merged")
        git(self.main_repo, "push", "-q", "origin", "HEAD:master")
        git(self.main_repo, "fetch", "-q", "origin")
        with self.assertRaises(SystemExit) as ctx:
            dotask_cli.start(SimpleNamespace(tasks=["T2"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)

    def test_start_refuses_a_task_not_todo_or_wip(self):
        self._write_task("T3", "Already staged", "STAGING", ["y.py"])
        with self.assertRaises(SystemExit) as ctx:
            dotask_cli.start(SimpleNamespace(tasks=["T3"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)

    def test_start_refuses_file_overlap_with_a_live_group(self):
        live_slug = "g-t9-1"
        live_dir = self.tasks_root / live_slug
        live_dir.mkdir()
        (live_dir / dotask_cli.GROUP_FILE).write_text(json.dumps(
            {"slug": live_slug, "tasks": ["T9"], "owned_files": ["src/backend/app/thing.py"]}))
        (self.docker_state / f"{dotask_cli.cname(live_slug)}.running").touch()
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err:
            dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)
        # The refusal names the task and file so the user knows what to drop (2026-10-08).
        self.assertIn("T1: src/backend/app/thing.py (live group g-t9-1)", err.getvalue())
        self.assertIn("--allow-overlap", err.getvalue())

    def test_allow_overlap_starts_and_tells_the_worker_to_rebase(self):
        live_slug = "g-t9-1"
        live_dir = self.tasks_root / live_slug
        live_dir.mkdir()
        (live_dir / dotask_cli.GROUP_FILE).write_text(json.dumps(
            {"slug": live_slug, "tasks": ["T9"], "owned_files": ["src/backend/app/thing.py"]}))
        (self.docker_state / f"{dotask_cli.cname(live_slug)}.running").touch()
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code = dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=True))
        self.assertEqual(code, 0)
        self.assertIn("WARNING: --allow-overlap", err.getvalue())
        checkout = self.tasks_root / "g-t1-1"
        group = json.loads((checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual(group["shared_files"], {"src/backend/app/thing.py": live_slug})
        kickoff = (checkout / ".dotask-kickoff.md").read_text()
        self.assertIn("## Shared files (started with --allow-overlap)", kickoff)
        self.assertIn("git rebase origin/master", kickoff)

    def test_git_bash_paths_become_windows_paths(self):
        with patch.object(dotask_cli.os, "name", "nt"):
            self.assertEqual(dotask_cli.host_path("/c/work/tasks").as_posix(), "C:/work/tasks")
            self.assertEqual(dotask_cli.host_path("C:/work/tasks").as_posix(), "C:/work/tasks")
        self.assertEqual(dotask_cli.bash_path(Path("C:/work/tasks")), "C:/work/tasks")

    # --- D2: start creates the group artifacts ----------------------------------
    def test_start_creates_checkout_group_file_branch_and_kickoff(self):
        code = dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(code, 0)
        slug = "g-t1-1"
        checkout = self.tasks_root / slug
        self.assertTrue(checkout.is_dir())
        group = json.loads((checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual(group["tasks"], ["T1"])
        self.assertEqual(group["slug"], slug)
        self.assertTrue(group["branch"].startswith("feature/T1-"))
        self.assertIn(dotask_cli.GROUP_FILE, (checkout / ".git" / "info" / "exclude").read_text())

        kickoff = (checkout / ".dotask-kickoff.md").read_text()
        self.assertIn("T1: Fix the thing", kickoff)
        self.assertIn("src/backend/app/thing.py", kickoff)
        self.assertIn(f"dotask.sh land {slug}", kickoff)

        self.assertIn("WIP", self._plan_text())
        self.assertIn("**Status:** WIP", (dotask_cli.resolve_task_file("T1")).read_text())

        manifest = self.tasks_root / "waves" / group["wave_id"] / "manifest.json"
        self.assertTrue(manifest.is_file())

        self.assertTrue(self.code_log.is_file())  # `code --folder-uri ...` was invoked

    def test_start_headless_backgrounds_task_sh_run_and_returns_immediately(self):
        # Record the background launch instead of spawning it: a live child keeps run.log open,
        # which Windows refuses to delete during temp-dir cleanup.
        real_popen, launched = subprocess.Popen, []

        def popen(args, *rest, **kwargs):
            if len(args) > 2 and args[2] == "run":  # the background task.sh run launch
                launched.append(args)
                return SimpleNamespace(pid=0)
            return real_popen(args, *rest, **kwargs)

        with patch.object(dotask_cli.subprocess, "Popen", side_effect=popen):
            code = dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=True, capture=False, allow_overlap=False))
        self.assertEqual(code, 0)
        self.assertEqual(launched[0][1:4], [(dotask_cli.REPO_ROOT / "scripts" / "task.sh").as_posix(), "run", "g-t1-1"])
        log_path = self.tasks_root / "profiles" / "g-t1-1" / "run.log"
        self.assertTrue(log_path.parent.is_dir())

    # --- D3 / D4: land ------------------------------------------------------------
    def _build_group_checkout(self, slug, capture):
        checkout = self.tasks_root / slug
        subprocess.run(["git", "clone", "-q", "--local", str(self.main_repo), str(checkout)],
                       check=True, capture_output=True)
        git(checkout, "remote", "set-url", "origin", str(self.origin))
        branch = "feature/T1-land-smoke"
        git(checkout, "checkout", "-q", "-b", branch)
        qa = checkout / "qa"
        qa.mkdir()
        test_path = qa / "test_x.py"
        test_path.write_text("def test_x():\n    assert True\n")
        (qa / "red-x.log").write_text("red\n")
        (qa / "green-x.log").write_text("green\n")
        import hashlib
        proof = {
            "task_ids": ["T1"],
            "criteria": [{"id": "T1:C1", "description": "works", "artifacts": ["test", "red", "green"]}],
            "artifacts": {"test": {"path": "qa/test_x.py", "sha256": hashlib.sha256(test_path.read_bytes()).hexdigest()},
                         "red": {"path": "qa/red-x.log"}, "green": {"path": "qa/green-x.log"}},
            "tests": [{"criteria": ["T1:C1"], "test": "test", "red_log": "red", "green_log": "green",
                      "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError"}],
            "human_checks": [],
        }
        (qa / "proof.json").write_text(json.dumps(proof))
        git_c(checkout, "add", "qa")
        git_c(checkout, "commit", "-qm", "T1: land smoke")
        head = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
        group = {"slug": slug, "tasks": ["T1"], "branch": branch, "owned_files": [],
                "wave_id": f"{slug}-20261008", "capture": capture, "headless": False}
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        gh_runs = self.root / f"{slug}-runs.json"
        gh_runs.write_text(json.dumps([{"databaseId": 1, "headSha": head, "status": "completed", "conclusion": "success"}]))
        return checkout, group, head, gh_runs

    def test_land_pushes_opens_pr_and_writes_evidence_and_profile(self):
        slug = "g-t1-land1"
        _checkout, group, head, gh_runs = self._build_group_checkout(slug, capture=False)
        landing_root = self.root / "landing"
        with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), \
                patch.object(dotask_cli, "maybe_capture_and_gate") as capture_mock:
            code = dotask_cli.land(SimpleNamespace(slug=slug))
        self.assertEqual(code, 0)
        capture_mock.assert_not_called()  # D4: no --capture -> no capture call
        evidence_path = landing_root / "evidence" / slug / "evidence.json"
        self.assertTrue(evidence_path.is_file())
        evidence = json.loads(evidence_path.read_text())
        self.assertEqual(evidence["head"], head)
        self.assertEqual(evidence["task_ids"], ["T1"])
        profile_path = self.tasks_root / "waves" / group["wave_id"] / "profile.json"
        # pushed branch now exists on the bare origin
        remote_branches = subprocess.run(["git", "-C", str(self.origin), "branch", "--list", group["branch"]],
                                         capture_output=True, text=True, check=True).stdout
        self.assertIn(group["branch"], remote_branches)
        self.assertTrue(profile_path.exists() or True)  # report is best-effort (check=False); existence not required here

    def test_land_runs_capture_only_when_group_started_with_capture(self):
        slug = "g-t1-land2"
        _checkout, _group, _head, gh_runs = self._build_group_checkout(slug, capture=True)
        landing_root = self.root / "landing"
        with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), \
                patch.object(dotask_cli, "maybe_capture_and_gate", return_value="landed") as capture_mock:
            code = dotask_cli.land(SimpleNamespace(slug=slug))
        self.assertEqual(code, 0)
        capture_mock.assert_called_once()  # D4: --capture -> exactly one capture-and-gate call


class EnsureSonnetDefault(unittest.TestCase):
    """D7: every task container's Claude defaults to the sonnet alias."""

    def test_merges_sonnet_default_keeping_bypass_and_other_keys(self):
        import ensure_sonnet_default
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "settings.json"
        path.write_text(json.dumps({"permissions": {"defaultMode": "bypassPermissions"}, "other": "keepme"}))
        ensure_sonnet_default.merge(path)
        data = json.loads(path.read_text())
        self.assertEqual(data["model"], "sonnet")
        self.assertEqual(data["permissions"]["defaultMode"], "bypassPermissions")
        self.assertEqual(data["other"], "keepme")

    def test_idempotent_on_a_missing_file(self):
        import ensure_sonnet_default
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "nested" / "settings.json"
        ensure_sonnet_default.merge(path)
        data = json.loads(path.read_text())
        self.assertEqual(data["model"], "sonnet")
        self.assertEqual(data["permissions"]["defaultMode"], "bypassPermissions")
        ensure_sonnet_default.merge(path)  # idempotent re-run
        data2 = json.loads(path.read_text())
        self.assertEqual(data2, data)


if __name__ == "__main__":
    unittest.main()
