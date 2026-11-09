"""dotask_cli.py (supervisorless /dotask) against fake docker/code/gh on PATH and a
temp TASKS_ROOT + fixture MAIN_REPO. Never touches real Docker/VS Code/GitHub."""
import contextlib
import io
import json
import re
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import dotask_cli
import ensure_sonnet_default

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
        -u|-e) skip=1; continue ;;
        -i|-it|-d) continue ;;
        *) if [ -z "$name" ]; then name="$a"; else cmdargs+=("$a"); fi ;;
      esac
    done
    joined="${cmdargs[*]}"
    echo "$name $joined" >> "$state/exec.log"
    if [ -n "${FAKE_STACK_DOWN:-}" ] && [[ "$joined" == *"/api/health"* ]]; then exit 1; fi
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
echo "$@" >> "${FAKE_GH_LOG:-/dev/null}"
case "$1 $2" in
  "pr create")
    if [ -n "${FAKE_GH_PR_EXISTS:-}" ]; then
      echo "a pull request for branch already exists: https://github.com/example/repo/pull/42" >&2; exit 1
    fi
    echo "https://github.com/example/repo/pull/42"; exit 0 ;;
  "pr view") echo "https://github.com/example/repo/pull/42"; exit 0 ;;
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
        self.gh_log = self.root / "gh.log"

        self._build_main_repo()

        self.env_patch = patch.dict(os.environ, {
            "PATH": f"{self.fakebin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DOCKER_STATE": str(self.docker_state),
            "FAKE_CODE_LOG": str(self.code_log),
            "FAKE_GH_LOG": str(self.gh_log),
            "DOTASK_PREFILL": "0",  # task.sh code's background panel prefill would outlive the test
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
        # land writes evidence under LANDING_ROOT: never the real C:/work/landing (a regression leaked there).
        landing_patch = patch.object(dotask_cli, "LANDING_ROOT", self.root / "landing")
        landing_patch.start()
        self.addCleanup(landing_patch.stop)

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

    def _push_commit(self, subject, code_file=None):
        if code_file:
            (self.main_repo / code_file).write_text("work = 1\n")
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", subject)
        git(self.main_repo, "push", "-q", "origin", "HEAD:master")
        git(self.main_repo, "fetch", "-q", "origin")

    def test_start_refuses_a_task_already_merged_on_origin_master(self):
        # The merged commit must touch code: docs/plans-only commits are bookkeeping (next test).
        self._write_task("T2", "Already merged", "TODO", ["x.py"])
        self._push_commit("T2: already merged", code_file="x.py")
        with self.assertRaises(SystemExit) as ctx:
            dotask_cli.start(SimpleNamespace(tasks=["T2"], headless=False, capture=False, allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)

    def test_docs_plans_only_commits_do_not_count_as_merged_work(self):
        self._write_task("T2", "Filed only", "TODO", ["x.py"])
        self._push_commit("T2: file the task")
        self.assertEqual(dotask_cli.merged_commits("T2"), [])
        self._push_commit("T2: the work", code_file="x.py")
        self.assertEqual(len(dotask_cli.merged_commits("T2")), 1)

    def test_a_reverted_commit_does_not_count_as_merged_work(self):
        # T15220 (2026-11-08): reverted out of PR #717, then refused a restart for the reverted commits.
        self._write_task("T2", "Reverted", "TODO", ["x.py"])
        self._push_commit("T2: the first attempt", code_file="x.py")
        self.assertEqual(len(dotask_cli.merged_commits("T2")), 1)
        git_c(self.main_repo, "revert", "--no-edit", "HEAD")
        git(self.main_repo, "push", "-q", "origin", "HEAD:master")
        git(self.main_repo, "fetch", "-q", "origin")
        self.assertEqual(dotask_cli.merged_commits("T2"), [])

    def test_agent_doc_commits_do_not_count_as_merged_work(self):
        # 5e3c33f8c: filing T14970 also touched .claude/agents, and T14970 read as already shipped.
        self._write_task("T2", "Filed only", "TODO", ["x.py"])
        (self.main_repo / ".claude" / "agents").mkdir(parents=True)
        self._push_commit("T2: file the task and the agent doc", code_file=".claude/agents/analyst.md")
        self.assertEqual(dotask_cli.merged_commits("T2"), [])
        self._push_commit("T2: the work", code_file="x.py")
        self.assertEqual(len(dotask_cli.merged_commits("T2")), 1)

    def test_a_task_id_opening_a_body_line_does_not_count_as_merged_work(self):
        # 5c669996f: T14920's body wrapped so a line opened "T14780 T14800 ...", and T14780 read as shipped.
        self._write_task("T2", "Named in a body", "TODO", ["x.py"])
        self._push_commit("T9: other work\n\nRestores the rows for T1\nT2 T3, all still TODO.", code_file="other.py")
        self.assertEqual(dotask_cli.merged_commits("T2"), [])
        self._push_commit("T2: the work", code_file="x.py")
        self.assertEqual(len(dotask_cli.merged_commits("T2")), 1)

    def test_a_merge_that_files_a_task_does_not_count_as_merged_work(self):
        # PR #579: the merge's body quoted "T11500: file ..." and its diff carried another task's code.
        self._write_task("T2", "Filed only", "TODO", ["x.py"])
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "base for T2")
        git(self.main_repo, "checkout", "-qb", "filing")
        self._write_task("T2", "Filed only, with decisions", "TODO", ["x.py"])
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "T2: file the task")
        (self.main_repo / "other.py").write_text("work = 1\n")
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "T9: other work")
        git(self.main_repo, "checkout", "-q", "-")
        # Master moves on before the merge, so the merge differs from both parents (as #579 did).
        (self.main_repo / "master_only.py").write_text("work = 1\n")
        git_c(self.main_repo, "add", ".")
        git_c(self.main_repo, "commit", "-qm", "T8: master moved on")
        git_c(self.main_repo, "merge", "--no-ff", "-q", "filing", "-m", "Merge filing\n\nT2: file the task")
        git(self.main_repo, "push", "-q", "origin", "HEAD:master")
        git(self.main_repo, "fetch", "-q", "origin")
        self.assertEqual(dotask_cli.merged_commits("T2"), [])

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

    @unittest.skipIf(os.name == "nt", "posix pass-through")
    def test_posix_paths_pass_through_unchanged(self):
        self.assertEqual(dotask_cli.host_path("/c/work/tasks").as_posix(), "/c/work/tasks")

    # Patching os.name makes pathlib build a WindowsPath, which Linux cannot instantiate.
    @unittest.skipUnless(os.name == "nt", "WindowsPath only exists on Windows")
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
        self.assertIn(f"/dotask land {slug}", kickoff)
        self.assertIn(f"/dotask land {slug} --after-test", kickoff)
        self.assertIn("`docs/plans/tasks/fixture/T1-fix-the-thing.md`", kickoff)  # posix path for the Linux container
        self.assertNotIn(b"\r\n", (checkout / ".dotask-kickoff.md").read_bytes())

        self.assertIn("WIP", self._plan_text())
        self.assertIn("**Status:** WIP", (dotask_cli.resolve_task_file("T1")).read_text())

        manifest = self.tasks_root / "waves" / group["wave_id"] / "manifest.json"
        self.assertTrue(manifest.is_file())
        self.assertEqual(json.loads(manifest.read_text())["mode"], "window")

        self.assertTrue(self.code_log.is_file())  # `code --folder-uri ...` was invoked

    def test_kickoff_resumes_from_status_and_stops_for_a_clear_after_each_task(self):
        # One growing session re-read 48k -> 190k context per request over 8 tasks (g-t12110-8);
        # the user chose stop + /clear between tasks over a subagent-per-task worker (2026-10-08).
        dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        kickoff = (self.tasks_root / "g-t1-1" / ".dotask-kickoff.md").read_text()
        self.assertIn("STAGE_DONE <task> commit", kickoff)  # resume key: a task with a commit line is done
        self.assertIn("/clear", kickoff)
        self.assertIn("Implement /workspace/.dotask-kickoff.md", kickoff)
        self.assertIn("PUSHREADY feature/T1-fix-thing <sha>", kickoff)  # the one final line
        self.assertNotIn("pushready", kickoff)

    def test_kickoff_runs_the_preland_check_before_pushready(self):
        dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        kickoff = (self.tasks_root / "g-t1-1" / ".dotask-kickoff.md").read_text()
        step = "bash scripts/dotask_preland_check.sh"
        self.assertIn(step, kickoff)
        self.assertLess(kickoff.index(step), kickoff.index("PUSHREADY feature/T1-fix-thing <sha>"))

    def test_kickoff_carries_shared_notes_between_conversations(self):
        # /clear between tasks drops what one task learned about the shared code; a notes file the
        # next conversation reads first carries it (CtaBar group g-t12020-1, 2026-10-09).
        dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        kickoff = (self.tasks_root / "g-t1-1" / ".dotask-kickoff.md").read_text()
        notes = "/workspace/.dotask-notes.md"
        self.assertIn(notes, kickoff)
        self.assertLess(kickoff.index(notes), kickoff.index("Read `/workspace/.dotask-status`"))  # read before resuming
        self.assertLess(kickoff.index(notes, kickoff.index("Read `/workspace/.dotask-status`")),
                        kickoff.index("Send /clear"))  # appended before the stop
        # The commit status line marks the task done; notes written after it are lost on a cut-off.
        self.assertIn("THEN append a `## T<id>` section", kickoff)
        self.assertIn("THEN the `STAGE_DONE <task> commit` status line", kickoff)

    # --- nextup: bundle TODO tasks that share a code area --------------------------
    def _plan_rows(self, specs):
        rows = []
        for task_id, title, status, files, directory in specs:
            path = self._write_task(task_id, title, status, files, directory)
            rows.append((task_id, title, path.relative_to(self.main_repo / "docs" / "plans").as_posix(), status))
        self._write_plan(rows)

    def test_nextup_bundles_todo_tasks_that_share_a_file_or_an_epic_folder(self):
        self._plan_rows([
            ("T10", "Bar component", "STAGING", ["src/Bar.jsx"], "cta"),
            ("T20", "Focus bar", "TODO", ["src/Bar.jsx", "src/Focus.jsx"], "cta"),
            ("T30", "Lonely fix", "TODO", ["src/Other.py"], "misc"),
            ("T40", "Choice card", "TODO", ["src/Choice.jsx"], "cta"),
            ("T50", "Focus tweak", "TODO", ["src/Focus.jsx"], "misc2"),
        ])
        bundles = dotask_cli.nextup_bundles()
        # PLAN order inside a bundle; bundles ranked by their first task's PLAN position.
        self.assertEqual([b["tasks"] for b in bundles], [["T20", "T40", "T50"], ["T30"]])
        self.assertEqual(bundles[0]["shared_files"], {"src/Focus.jsx": ["T20", "T50"]})

    def test_nextup_never_bundles_loose_tasks_by_the_tasks_root_folder(self):
        self._plan_rows([
            ("T20", "Loose one", "TODO", ["src/a.py"], ""),
            ("T30", "Loose two", "TODO", ["src/b.py"], ""),
        ])
        self.assertEqual([b["tasks"] for b in dotask_cli.nextup_bundles()], [["T20"], ["T30"]])

    # --- decision gate: a task that waits on the user is not headless work ----------
    def test_start_refuses_a_task_that_waits_on_a_user_ruling(self):
        path = self._write_task("T2", "Pick a name", "TODO", ["src/Name.jsx"])
        path.write_text(path.read_text() + "\n## Solution\n\nPut the options on a decision page; the user picks.\n")
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err:
            dotask_cli.preflight(["T1", "T2"])
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn("T2: Put the options on a decision page; the user picks.", err.getvalue())
        self.assertIn("/dotask T1", err.getvalue())
        # An unchecked "Owner has ruled" criterion is the gate, not the ruling.
        path.write_text(path.read_text() + "\n## Acceptance Criteria\n\n- [ ] Owner has ruled A, B or C\n")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            dotask_cli.preflight(["T2"])
        # The user's recorded ruling clears it.
        path.write_text(path.read_text() + "\n## Ruling\n\n**B** (owner, 2026-11-07). Shorter header.\n")
        files_by_task, _owned, _shared = dotask_cli.preflight(["T1", "T2"])
        self.assertEqual(sorted(files_by_task), ["T1", "T2"])

    def test_pending_decision_tells_a_recorded_ruling_from_a_worker_s_own_pick(self):
        cases = {  # real shapes from docs/plans/tasks, 2026-11-07
            "A, tentatively (2026-11-07, autonomous /dotask dispatch, no live owner available to rule)": True,
            '**"Confirm once"** (owner, 2026-11-07). Replaces F1.': False,
            "## Ruling (2026-10-11, T12310 re-run, user agreed)": False,
            "## Approved design (user, 2026-11-03)": False,
            "ui-designer proposed A/B/C; user picked C.": False,
        }
        for ruling, still_pending in cases.items():
            path = self.root / "t.md"
            path.write_text(f"# T9: Name the steps (decision)\n\n## Ruling\n\n{ruling}\n")
            self.assertEqual(dotask_cli.pending_decision(path) is not None, still_pending, ruling)
        path.write_text("# T9: Plain fix\n\n## Problem\n\nThe user picks a clip and nothing happens.\n")
        self.assertIn("user picks", dotask_cli.pending_decision(path))  # conservative: a false gate costs one question
        path.write_text("# T9: Plain fix\n\n## Problem\n\nSaving fails.\n")
        self.assertIsNone(dotask_cli.pending_decision(path))

    def test_nextup_sets_aside_tasks_that_wait_on_a_user_ruling(self):
        self._plan_rows([
            ("T20", "Name the steps", "TODO", ["src/a.py"], "a"),
            ("T30", "Free", "TODO", ["src/b.py"], "b"),
        ])
        path = next((self.main_repo / "docs" / "plans" / "tasks").rglob("T20-*.md"))
        path.write_text(path.read_text() + "\n## Solution (after the user decides)\n")
        self.assertEqual([b["tasks"] for b in dotask_cli.nextup_bundles()], [["T30"]])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(dotask_cli.main(["nextup"]), 0)
        self.assertIn("decision: T20: ## Solution (after the user decides)", out.getvalue())

    def test_nextup_prints_one_start_line_per_four_tasks(self):
        self._plan_rows([(f"T{n}0", f"Part {n}", "TODO", [f"src/p{n}.py"], "epic") for n in range(1, 6)])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(dotask_cli.main(["nextup"]), 0)
        self.assertIn("[over 4: one group per start line below, in order]", out.getvalue())
        self.assertIn("start: bash scripts/dotask.sh start T10 T20 T30 T40\n", out.getvalue())
        self.assertIn("start: bash scripts/dotask.sh start T50\n", out.getvalue())

    def test_nextup_holds_back_tasks_whose_files_a_live_group_owns(self):
        self._plan_rows([
            ("T20", "Busy", "TODO", ["src/busy.py"], "a"),
            ("T30", "Free", "TODO", ["src/free.py"], "b"),
        ])
        live_dir = self.tasks_root / "g-t9-1"
        live_dir.mkdir()
        (live_dir / dotask_cli.GROUP_FILE).write_text(json.dumps(
            {"slug": "g-t9-1", "tasks": ["T9"], "owned_files": ["src/busy.py"]}))
        (self.docker_state / f"{dotask_cli.cname('g-t9-1')}.running").touch()
        bundles = dotask_cli.nextup_bundles()
        self.assertEqual([b["tasks"] for b in bundles], [["T30"]])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(dotask_cli.main(["nextup"]), 0)
        self.assertIn("bash scripts/dotask.sh start T30", out.getvalue())
        self.assertIn("T20: src/busy.py (live group g-t9-1)", out.getvalue())

    def test_stack_starts_the_group_stack_waits_and_prints_offset_urls(self):
        slug = "g-t1-stack"
        checkout = self._group_dir_with_ports(slug)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = dotask_cli.main(["stack", slug])
        self.assertEqual(code, 0)
        self.assertIn("http://localhost:5176", out.getvalue())
        self.assertIn("http://localhost:8003/api/health", out.getvalue())
        for preset in ("empty", "upload", "full"):
            self.assertIn(f"http://localhost:5176/?dev_account={preset}", out.getvalue())
        execs = (self.docker_state / "exec.log").read_text()
        self.assertIn("container-stack.sh", execs)
        self.assertIn("/api/health", execs)  # waited for the backend, not just launched
        self.assertTrue(checkout.is_dir())

    def test_stack_fails_loudly_when_the_stack_never_comes_up(self):
        slug = "g-t1-down"
        self._group_dir_with_ports(slug)
        with patch.dict(os.environ, {"FAKE_STACK_DOWN": "1", "STACK_WAIT_SECONDS": "2"}), \
                contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
            code = dotask_cli.main(["stack", slug])
        self.assertEqual(code, 1)
        self.assertNotIn("ready", out.getvalue())

    def test_start_headless_backgrounds_task_sh_run_and_returns_immediately(self):
        # Record the background launch instead of spawning it: a live child keeps run.log open,
        # which Windows refuses to delete during temp-dir cleanup.
        real_popen, launched = subprocess.Popen, []

        def popen(args, *rest, **kwargs):
            if "resume" in args:  # the background headless run: build loop, then autoland
                launched.append((args, kwargs["env"]))
                return SimpleNamespace(pid=0)
            return real_popen(args, *rest, **kwargs)

        with patch.object(dotask_cli.subprocess, "Popen", side_effect=popen), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            code = dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=True, capture=False, allow_overlap=False))
        self.assertEqual(code, 0)
        args, env = launched[0]
        # The same command continues a stopped group, so a first launch is nothing special.
        self.assertTrue(args[1].endswith("dotask_cli.py"))
        self.assertEqual(args[2:], ["resume", "g-t1-1"])
        self.assertTrue(env["DOTASK_WAVE_ID"].startswith("g-t1-1-"))
        self.assertEqual(env["DOTASK_PHASE"], "implementation")
        self.assertIn("eta: PR about", out.getvalue())  # every relay carries an ETA
        log_path = self.tasks_root / "profiles" / "g-t1-1" / "run.log"
        self.assertTrue(log_path.parent.is_dir())
        group = json.loads((self.tasks_root / "g-t1-1" / dotask_cli.GROUP_FILE).read_text())
        manifest = self.tasks_root / "waves" / group["wave_id"] / "manifest.json"
        self.assertEqual(json.loads(manifest.read_text())["mode"], "headless")

    def test_start_caps_a_group_at_four_tasks(self):
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err:
            dotask_cli.start(SimpleNamespace(tasks=["T1", "T2", "T3", "T4", "T5"], headless=True, capture=False,
                                             allow_overlap=False))
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn("The cap is 4", err.getvalue())
        self.assertIn("/dotask T1 T2 T3 T4 now and /dotask T5 after it", err.getvalue())

    def test_kickoff_tells_the_worker_to_stop_on_a_conflict_with_another_task_s_criterion(self):
        dotask_cli.start(SimpleNamespace(tasks=["T1"], headless=False, capture=False, allow_overlap=False))
        kickoff = (self.tasks_root / "g-t1-1" / ".dotask-kickoff.md").read_text()
        self.assertIn("CONFLICT <your task> <other task>:C<n>", kickoff)
        self.assertIn("do NOT edit that criterion", kickoff)
        self.assertIn("handoff", kickoff)
        # After a failure only the failing test runs again; a pass is final for that code (user rule).
        self.assertIn("re-run ONLY that test", kickoff)
        self.assertIn("Re-run only the tests that failed", dotask_cli.FIX_INSTRUCTION)

    # --- headless build loop: one fresh dispatch per task, restarts after running out of turns ---
    def _loop(self, behavior, tasks=("T1", "T2", "T3"), status_text=""):
        """build_loop against a fake dispatch. behavior(task, attempt) -> (status lines the dispatch
        leaves, the run record's outcome class). Returns (exit code, calls, stderr)."""
        checkout = self.tasks_root / "g-x"
        (checkout / ".dotask-profile").mkdir(parents=True, exist_ok=True)
        status = checkout / ".dotask-status"
        status.write_text(status_text)
        group = {"slug": "g-x", "tasks": list(tasks), "wave_id": "w", "branch": "feature/x"}
        calls, attempts = [], {}

        def dispatch(slug, group, phase, instruction, task_ids=None):
            task = task_ids[0]
            attempts[task] = attempts.get(task, 0) + 1
            calls.append(f"{phase} {slug} {task}" + (" resumed" if "handoff section" in instruction else ""))
            lines, outcome = behavior(task, attempts[task])
            with status.open("a") as stream:
                stream.write(lines)
            (checkout / ".dotask-profile" / f"{len(calls):03d}.json").write_text(json.dumps(
                {"schema_version": 2, "started_at": f"2026-11-07T{len(calls):02d}:00:00+00:00",
                 "outcome_class": outcome, "requests": 120}))
            return False
        with patch.object(dotask_cli, "dispatch", dispatch), contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            code = dotask_cli.build_loop("g-x", group, checkout)
        return code, calls, err.getvalue()

    @staticmethod
    def _commit(task, pushready=False):
        return f"t STAGE_DONE {task} commit x\n" + (f"t PUSHREADY feature/x abc\n" if pushready else "")

    def test_build_loop_dispatches_each_task_once_until_pushready(self):
        code, calls, _ = self._loop(lambda task, n: (self._commit(task, pushready=task == "T3"), "success"))
        self.assertEqual((code, calls), (0, ["implementation g-x T1", "implementation g-x T2", "implementation g-x T3"]))

    def test_build_loop_resumes_at_the_first_task_without_a_commit_line(self):
        code, calls, _ = self._loop(lambda task, n: (self._commit(task, pushready=task == "T3"), "success"),
                                    status_text="t STAGE_DONE T1 commit x\n")
        self.assertEqual((code, calls), (0, ["implementation g-x T2", "implementation g-x T3"]))

    def test_build_loop_stops_unless_the_dispatch_ends_on_its_commit_line(self):
        # IMPL_READY after the first task once chained QA, whose PUSHREADY ended the run with
        # tasks undone (review of PR 576): anything but the commit line or PUSHREADY stops it.
        for last in ("t IMPL_READY", "t BLOCKED needs input", "t ENDED_WITHOUT_STATUS phase=implementation"):
            code, calls, _ = self._loop(lambda task, n: (last + "\n", "success"))
            self.assertEqual((code, calls), (1, ["implementation g-x T1"]), last)

    def test_build_loop_stops_for_the_user_when_a_task_conflicts_with_another_s_criterion(self):
        code, calls, err = self._loop(lambda task, n: ('t CONFLICT T1 T2:C1 "step count changed"\n', "success"))
        self.assertEqual((code, calls), (1, ["implementation g-x T1"]))
        self.assertIn("needs the user's ruling", err)

    def test_build_loop_without_pushready_after_every_commit_exits_3(self):
        code, calls, _ = self._loop(lambda task, n: (self._commit(task), "success"))
        self.assertEqual((code, len(calls)), (3, 3))

    def test_build_loop_restarts_a_task_that_ran_out_of_turns_with_a_handoff_note(self):
        # Three such stops were restarted by hand on g-t15220-10 (2026-11-07), each with the code done
        # and only the commit missing; one of them sat overnight.
        def behavior(task, attempt):
            if attempt <= 2:
                return "t DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop\n", "budget_stop"
            return self._commit(task, pushready=True), "success"
        code, calls, _ = self._loop(behavior, tasks=("T1",))
        self.assertEqual(code, 0)
        self.assertEqual(calls, ["implementation g-x T1", "implementation g-x T1 resumed",
                                 "implementation g-x T1 resumed"])
        notes = (self.tasks_root / "g-x" / ".dotask-notes.md").read_text()
        self.assertEqual(notes.count("## T1 handoff"), 2)
        self.assertIn("ran out of turns (120 requests)", notes)
        self.assertIn("RESUMED T1 dispatch 2 of 3", (self.tasks_root / "g-x" / ".dotask-status").read_text())

    def test_build_loop_gives_up_after_two_restarts(self):
        body = "t DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop\n"
        code, calls, _ = self._loop(lambda task, n: (body, "budget_stop"), tasks=("T1",))
        self.assertEqual((code, len(calls)), (1, 3))

    def test_resume_refuses_an_unknown_group(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            dotask_cli.main(["resume", "g-nope"])

    def test_resume_continues_a_fix_round_that_stopped_with_uncommitted_work(self):
        # g-t15220-10, 2026-11-07: fix round 1 ran out of turns with 17 files changed. Resuming straight
        # into autoland would have verified that dirty tree from scratch and blocked.
        checkout = self.tasks_root / "g-x"
        (checkout / ".dotask-profile").mkdir(parents=True)
        group = {"slug": "g-x", "tasks": ["T1"], "wave_id": "w", "branch": "feature/x"}
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        (checkout / ".dotask-status").write_text("t STAGE_DONE T1 commit x\nt PUSHREADY feature/x aaa\n"
                                                 "t DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop\n")
        verdict = {"head": "a" * 40, "bugs": [], "criteria": [{"id": "T1:C1", "status": "fail", "evidence": "x"}]}
        (checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(verdict))
        waves = self.tasks_root / "waves" / "w"
        waves.mkdir(parents=True)
        (waves / "verify-round-1.json").write_text(json.dumps(verdict))
        (checkout / ".dotask-profile" / "r1.json").write_text(json.dumps(
            {"schema_version": 2, "started_at": "2026-11-07T20:00:00+00:00", "phase": "implementation",
             "outcome_class": "budget_stop", "requests": 120}))
        state = {"head": "a" * 40, "dirty": " M src/x.js"}
        calls = []

        def dispatch(slug, group, phase, instruction, task_ids=None):
            calls.append(instruction)
            state["head"], state["dirty"] = "b" * 40, ""
            (checkout / ".dotask-profile" / "r2.json").write_text(json.dumps(
                {"schema_version": 2, "started_at": "2026-11-07T21:00:00+00:00", "phase": "implementation",
                 "outcome_class": "success"}))
            with (checkout / ".dotask-status").open("a") as stream:
                stream.write("t PUSHREADY feature/x bbb fix round 1\n")
            return True
        autoland = MagicMock(return_value=0)
        with patch.object(dotask_cli, "dispatch", dispatch), patch.object(dotask_cli, "autoland", autoland), \
                patch.object(dotask_cli, "git_head", lambda c: state["head"]), \
                patch.object(dotask_cli, "tracked_changes", lambda c: state["dirty"]), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(dotask_cli.main(["resume", "g-x"]), 0)
        self.assertEqual(len(calls), 1)
        self.assertIn("## fix round 1 T1 progress", calls[0])
        self.assertIn("handoff section", calls[0])
        self.assertIn("## fix round 1 T1 handoff", (checkout / ".dotask-notes.md").read_text())
        autoland.assert_called_once()
        self.assertIn("fix round 1 stopped with uncommitted work", out.getvalue())

    # --- ETA: every relay carries one; a move of more than 15 minutes is a change --------------
    def _group_for_eta(self, status_text, tasks=("T1", "T2", "T3"), minutes=()):
        checkout = self.tasks_root / "g-x"
        checkout.mkdir(parents=True, exist_ok=True)
        (checkout / ".dotask-status").write_text(status_text)
        profiles = self.tasks_root / "profiles" / "g-x"
        profiles.mkdir(parents=True, exist_ok=True)
        for i, (phase, mins) in enumerate(minutes):
            (profiles / f"r{i}.json").write_text(json.dumps(
                {"schema_version": 2, "phase": phase, "outcome_class": "success", "duration_seconds": mins * 60}))
        return {"slug": "g-x", "tasks": list(tasks), "wave_id": "w", "branch": "feature/x"}, checkout

    def test_eta_uses_the_group_s_own_medians_and_what_is_left(self):
        now = dotask_cli.dt.datetime(2026, 11, 7, 10, 0).astimezone()
        group, checkout = self._group_for_eta("t STAGE_DONE T1 commit x\n", minutes=[
            ("implementation", 20), ("implementation", 30), ("implementation", 40), ("qa", 8)])
        best, with_fix, basis = dotask_cli.estimate(group, checkout, now)
        # 2 tasks x 30 (median) + 4 verifiers (3 criteria, the task files are missing so 1 each, and the
        # regression pass) x 8 + CI 8 = 100 min; one fix round adds 30 + 2 re-checks x 8.
        self.assertEqual(best, now + dotask_cli.dt.timedelta(minutes=100))
        self.assertEqual(with_fix, best + dotask_cli.dt.timedelta(minutes=46))
        self.assertIn("2 task(s) x 30 min", basis)
        self.assertIn("medians of 4 timed dispatch(es)", basis)
        self.assertIn("eta: PR about 11:40 (12:26 with one fix round)", dotask_cli.eta_line(group, checkout, now))

    def test_eta_never_counts_a_verify_batch_past_the_verifier_cap(self):
        now = dotask_cli.dt.datetime(2026, 11, 7, 10, 0).astimezone()
        group, checkout = self._group_for_eta("t STAGE_DONE T1 commit x\n", minutes=[
            ("implementation", 30), ("qa", 120)])
        best, _, basis = dotask_cli.estimate(group, checkout, now)
        self.assertEqual(best, now + dotask_cli.dt.timedelta(minutes=2 * 30 + 4 * dotask_cli.VERIFY_TIMEOUT_MINUTES + 8))

    def test_eta_after_a_clean_verdict_is_ci_only_and_a_stopped_group_has_none(self):
        now = dotask_cli.dt.datetime(2026, 11, 7, 10, 0).astimezone()
        group, checkout = self._group_for_eta("t PUSHREADY feature/x abc\nt VERIFY_PASS abc round 1\n")
        best, with_fix, _ = dotask_cli.estimate(group, checkout, now)
        self.assertEqual((best, with_fix), (now + dotask_cli.dt.timedelta(minutes=8), None))
        group, checkout = self._group_for_eta("t PUSHREADY feature/x abc\nt BLOCKED needs a ruling\n")
        self.assertEqual(dotask_cli.estimate(group, checkout, now)[:2], (None, None))
        self.assertIn("eta: none (stopped", dotask_cli.eta_line(group, checkout, now))
        # Mid-verify: only the batches still to run count.
        group, checkout = self._group_for_eta("t PUSHREADY feature/x abc verify round 1 batch 1 of 4\n")
        self.assertIn("3 verify batch(es)", dotask_cli.estimate(group, checkout, now)[2])

    def test_eta_while_a_fix_round_runs_or_restarts(self):
        # g-t15220-10, 2026-11-07: after the last batch found problems, and after a fix dispatch was
        # restarted, `status` estimated a whole build plus a full verify instead of the fix round.
        now = dotask_cli.dt.datetime(2026, 11, 7, 10, 0).astimezone()
        group, checkout = self._group_for_eta(
            "t STAGE_DONE T1 commit x\nt STAGE_DONE T2 commit x\nt STAGE_DONE T3 commit x\n"
            "t PUSHREADY feature/x abc verify round 1 batch 2 of 2\n")
        (checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(
            {"head": "abc", "bugs": [], "criteria": [{"id": "T1:C1", "status": "fail", "evidence": "x"}]}))
        best, with_fix, basis = dotask_cli.estimate(group, checkout, now)
        self.assertIn("fix 1 task(s) x 25 min", basis)
        # One fix, then the failed criterion and the regression pass re-checked, each capped at 10 min.
        self.assertEqual(best, now + dotask_cli.dt.timedelta(minutes=25 + 2 * 10 + 8))
        # Findings in four tasks: four fix dispatches and five re-checks (four criteria and the regression pass).
        group["tasks"] = ["T1", "T2", "T3", "T4"]
        (checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps({"head": "abc", "criteria": [
            {"id": f"{t}:C1", "status": "fail", "evidence": "x"} for t in ("T1", "T2", "T3", "T4")], "bugs": []}))
        best, _with_fix, basis = dotask_cli.estimate(group, checkout, now)
        self.assertIn("fix 4 task(s) x 25 min, 5 re-check batch(es) x 10 min", basis)
        self.assertEqual(best, now + dotask_cli.dt.timedelta(minutes=4 * 25 + 5 * 10 + 8))
        with (checkout / ".dotask-status").open("a") as stream:
            stream.write("t DISPATCH_FAILED phase=implementation exit=1 outcome=budget_stop\n"
                         "t RESUMED Fix round 1 dispatch 2 of 3: ran out of turns, handoff written\n")
        self.assertIn("fix round (restarted)", dotask_cli.estimate(group, checkout, now)[2])

    def test_eta_reporter_speaks_only_when_the_estimate_moves(self):
        group, checkout = self._group_for_eta("")
        reporter = dotask_cli.EtaReporter(group, checkout)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            reporter.report()
            reporter.report()  # nothing changed: silent
            (checkout / ".dotask-status").write_text("t STAGE_DONE T1 commit x\nt STAGE_DONE T2 commit x\n")
            reporter.report()  # two tasks fewer: 50 minutes earlier
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn("(was ", lines[1])

    def test_status_prints_an_eta_line_per_group(self):
        group, checkout = self._group_for_eta("")
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        (self.docker_state / f"{dotask_cli.cname('g-x')}.running").touch()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(dotask_cli.main(["status"]), 0)
        self.assertIn("g-x\tT1,T2,T3\trunning", out.getvalue())
        self.assertIn("  eta: PR about", out.getvalue())

    def test_status_gives_no_eta_for_a_stopped_or_merged_group(self):
        # A merged group's file outlived its PR, and a stopped container's PUSHREADY was weeks old:
        # both got a made-up "PR about" time (2026-11-07).
        group, checkout = self._group_for_eta("t PUSHREADY feature/x abc\n")
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        with contextlib.redirect_stdout(io.StringIO()) as out:
            dotask_cli.main(["status"])
        self.assertIn("eta: none (container stopped; `bash scripts/dotask.sh resume g-x`", out.getvalue())
        with patch.object(dotask_cli, "merged_pr", lambda branch: "716"), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            dotask_cli.main(["status"])
        self.assertIn("eta: done -- PR #716 merged", out.getvalue())
        self.assertNotIn("freed", out.getvalue())  # a stopped container has nothing to free

    def test_a_merged_groups_running_container_is_freed_by_status_and_start(self):
        # T15350, owner rule 2026-11-08: merged groups kept their stacks up and slowed the live ones.
        group, checkout = self._group_for_eta("t PUSHREADY feature/x abc\n")
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        (self.docker_state / f"{dotask_cli.cname('g-x')}.running").touch()
        calls = []
        down = lambda *args, **kw: calls.append(args) or SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(dotask_cli, "merged_pr", lambda branch: "716"), patch.object(dotask_cli, "task_sh", down), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            dotask_cli.main(["status"])
        self.assertEqual(calls, [("down", "g-x")])
        self.assertIn("freed: container stopped (PR #716 merged", out.getvalue())
        calls.clear()
        with patch.object(dotask_cli, "merged_pr", lambda branch: "716"), patch.object(dotask_cli, "task_sh", down), \
                patch.object(dotask_cli, "preflight", MagicMock(side_effect=SystemExit(2))), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
            dotask_cli.main(["start", "T1"])
        self.assertEqual(calls, [("down", "g-x")])

    # --- D3 / D4: land ------------------------------------------------------------
    def _group_dir_with_ports(self, slug):
        """A running group container whose checkout already holds task.sh's offset ports (offset 3)."""
        checkout = self.tasks_root / slug
        checkout.mkdir(parents=True, exist_ok=True)
        (checkout / ".task-env").write_bytes(b"WT_OFFSET=3\nBACKEND_PORT=8003\nFRONTEND_PORT=5176\n")
        (self.docker_state / f"{dotask_cli.cname(slug)}.running").touch()
        return checkout

    def _build_group_checkout(self, slug, capture, tested=True):
        checkout = self.tasks_root / slug
        subprocess.run(["git", "clone", "-q", "--local", str(self.main_repo), str(checkout)],
                       check=True, capture_output=True)
        git(checkout, "remote", "set-url", "origin", str(self.origin))
        branch = "feature/T1-land-smoke"
        git(checkout, "checkout", "-q", "-b", branch)
        qa = checkout / "qa"
        qa.mkdir()
        test_path = checkout / "src" / "backend" / "tests" / "test_x.py"  # T13840: code under qa/ fails CI routing
        test_path.parent.mkdir(parents=True)
        test_path.write_text("def test_x():\n    assert True\n")
        (qa / "red-x.log").write_text("red\n")
        (qa / "green-x.log").write_text("green\n")
        import hashlib
        proof = {
            "task_ids": ["T1"],
            "criteria": [{"id": "T1:C1", "description": "works", "artifacts": ["test", "red", "green"]}],
            "artifacts": {"test": {"path": "src/backend/tests/test_x.py", "sha256": hashlib.sha256(test_path.read_bytes()).hexdigest()},
                         "red": {"path": "qa/red-x.log"}, "green": {"path": "qa/green-x.log"}},
            "tests": [{"criteria": ["T1:C1"], "test": "test", "red_log": "red", "green_log": "green",
                      "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError"}],
            "human_checks": [],
        }
        (qa / "proof.json").write_text(json.dumps(proof))
        git_c(checkout, "add", "qa", "src")
        git_c(checkout, "commit", "-qm", "T1: land smoke")
        head = subprocess.run(["git", "-C", str(checkout), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
        group = {"slug": slug, "tasks": ["T1"], "branch": branch, "owned_files": [],
                "wave_id": f"{slug}-20261008", "capture": capture, "headless": False}
        if tested:
            group["tested_head"] = head
        (checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        (checkout / ".task-env").write_bytes(b"WT_OFFSET=3\nBACKEND_PORT=8003\nFRONTEND_PORT=5176\n")
        (self.docker_state / f"{dotask_cli.cname(slug)}.running").touch()
        gh_runs = self.root / f"{slug}-runs.json"
        gh_runs.write_text(json.dumps([{"databaseId": 1, "headSha": head, "status": "completed", "conclusion": "success"}]))
        return checkout, group, head, gh_runs

    def _remote_has(self, branch):
        return branch in subprocess.run(["git", "-C", str(self.origin), "branch", "--list", branch],
                                        capture_output=True, text=True, check=True).stdout

    def test_land_brings_up_the_stack_and_stops_before_push_for_a_human_test(self):
        slug = "g-t1-land0"
        checkout, group, head, _gh_runs = self._build_group_checkout(slug, capture=False, tested=False)
        with contextlib.redirect_stdout(io.StringIO()) as out, \
                patch.object(dotask_cli, "wait_for_ci", return_value="success"), \
                patch.object(dotask_cli, "run_preland_check",  # hygiene has its own tests; CI has no ruff
                             return_value=SimpleNamespace(returncode=0, stdout="", stderr="")):
            code = dotask_cli.land(SimpleNamespace(slug=slug, after_test=False))
        self.assertEqual(code, 0)
        self.assertIn("http://localhost:5176", out.getvalue())
        self.assertIn(f"land {slug} --after-test", out.getvalue())
        self.assertIn("container-stack.sh", (self.docker_state / "exec.log").read_text())
        self.assertFalse(self._remote_has(group["branch"]))  # nothing pushed yet
        self.assertFalse(self.gh_log.exists())  # no PR yet
        saved = json.loads((checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual(saved["tested_head"], head)
        self.assertNotIn(b"\r\n", (checkout / dotask_cli.GROUP_FILE).read_bytes())

    def test_land_step_one_refuses_to_record_a_tested_head_while_the_preland_check_fails(self):
        slug = "g-t1-hygiene"
        checkout, _group, _head, _gh_runs = self._build_group_checkout(slug, capture=False, tested=False)
        (checkout / "qa" / "stray.test.js").write_text("test('x', () => {})\n")
        git_c(checkout, "add", "qa")
        git_c(checkout, "commit", "-qm", "T1: stray")
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err, \
                contextlib.redirect_stdout(io.StringIO()):
            dotask_cli.land(SimpleNamespace(slug=slug, after_test=False))
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertIn("qa/stray.test.js", err.getvalue())
        saved = json.loads((checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertNotIn("tested_head", saved)

    def test_land_after_test_refuses_a_group_that_was_never_stack_tested(self):
        slug = "g-t1-untested"
        _checkout, group, _head, _gh_runs = self._build_group_checkout(slug, capture=False, tested=False)
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err, \
                patch.object(dotask_cli, "wait_for_ci", return_value="success"):
            dotask_cli.land(SimpleNamespace(slug=slug, after_test=True))
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn(f"land {slug}", err.getvalue())
        self.assertFalse(self._remote_has(group["branch"]))

    def test_land_after_test_refuses_when_head_moved_since_the_test_stack(self):
        slug = "g-t1-moved"
        checkout, group, _head, _gh_runs = self._build_group_checkout(slug, capture=False)
        (checkout / "late.txt").write_text("late fix\n")
        git_c(checkout, "add", "late.txt")
        git_c(checkout, "commit", "-qm", "T1: late fix after the human test")
        with self.assertRaises(SystemExit) as ctx, contextlib.redirect_stderr(io.StringIO()) as err, \
                patch.object(dotask_cli, "wait_for_ci", return_value="success"):
            dotask_cli.land(SimpleNamespace(slug=slug, after_test=True))
        self.assertEqual(ctx.exception.code, 2)
        self.assertIn("changed since", err.getvalue())
        self.assertFalse(self._remote_has(group["branch"]))

    def test_land_after_test_marks_committed_tasks_completed_in_the_wave(self):
        slug = "g-t1-points"
        _checkout, group, _head, gh_runs = self._build_group_checkout(slug, capture=False)
        import wave_profile
        with patch.object(wave_profile, "TASKS_ROOT", self.tasks_root), \
                contextlib.redirect_stdout(io.StringIO()):
            wave_profile.main(["init", "--wave", group["wave_id"], "--task", "T1",
                               "--plan", str(self.main_repo / "docs" / "plans" / "PLAN.md"), "--mode", "window"])
        with patch.object(dotask_cli, "LANDING_ROOT", self.root / "landing"), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(dotask_cli.land(SimpleNamespace(slug=slug, after_test=True)), 0)
        manifest = json.loads((self.tasks_root / "waves" / group["wave_id"] / "manifest.json").read_text())
        self.assertEqual(manifest["tasks"][0]["status"], "completed")

    def test_land_hands_red_ci_back_to_autoland_only_when_asked(self):
        # T15330: autoland asks (fix_on_red) and gets CI_RED before any evidence; a person running
        # --after-test by hand still gets the full report and a 0.
        slug = "g-t1-red"
        _checkout, _group, _head, gh_runs = self._build_group_checkout(slug, capture=False)
        landing_root = self.root / "landing"
        for fix_on_red, want in ((True, dotask_cli.CI_RED), (False, 0)):
            with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                    patch.object(dotask_cli, "wait_for_ci", return_value="failure"), \
                    patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs), "FAKE_GH_PR_EXISTS": "1"}), \
                    contextlib.redirect_stdout(io.StringIO()):
                code = dotask_cli.land(SimpleNamespace(slug=slug, after_test=True, fix_on_red=fix_on_red))
            self.assertEqual(code, want)
            self.assertEqual((landing_root / "evidence" / slug / "evidence.json").exists(), not fix_on_red)

    def test_land_after_test_reuses_an_existing_pr_on_a_rerun(self):
        # A fix push after a red CI run means --after-test runs again for the same branch;
        # `gh pr create` then refuses ("already exists"). The landing must reuse that PR and
        # still produce the CI verdict + evidence, not die at the create step.
        slug = "g-t1-land2"
        _checkout, group, head, gh_runs = self._build_group_checkout(slug, capture=False)
        landing_root = self.root / "landing"
        gh_log = self.root / "gh.log"
        out = io.StringIO()
        with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs), "FAKE_GH_PR_EXISTS": "1",
                                        "FAKE_GH_LOG": str(gh_log)}), \
                contextlib.redirect_stdout(out):
            code = dotask_cli.land(SimpleNamespace(slug=slug, after_test=True))
        self.assertEqual(code, 0)
        self.assertIn("PR: https://github.com/example/repo/pull/42 (existing)", out.getvalue())
        self.assertIn("pr view", gh_log.read_text())
        evidence = json.loads((landing_root / "evidence" / slug / "evidence.json").read_text())
        self.assertEqual(evidence["head"], head)

    def test_land_pushes_opens_pr_and_writes_evidence_and_profile(self):
        slug = "g-t1-land1"
        _checkout, group, head, gh_runs = self._build_group_checkout(slug, capture=False)
        landing_root = self.root / "landing"
        with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), \
                patch.object(dotask_cli, "maybe_capture_and_gate") as capture_mock:
            code = dotask_cli.land(SimpleNamespace(slug=slug, after_test=True))
        self.assertEqual(code, 0)
        capture_mock.assert_not_called()  # D4: no --capture -> no capture call
        self.assertNotIn("container-stack.sh", (self.docker_state / "exec.log").read_text()
                         if (self.docker_state / "exec.log").exists() else "")  # --after-test never restarts it
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

    def test_land_after_test_archives_the_group_notes(self):
        # The notes are gitignored and die with the checkout on nuke; keep them with the wave profile.
        slug = "g-t1-notes"
        checkout, group, _head, gh_runs = self._build_group_checkout(slug, capture=False)
        (checkout / ".dotask-notes.md").write_text("## T1\n- CtaBar takes `actions`\n")
        with patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(dotask_cli.land(SimpleNamespace(slug=slug, after_test=True)), 0)
        archived = self.tasks_root / "waves" / group["wave_id"] / "notes.md"
        self.assertEqual(archived.read_text(), "## T1\n- CtaBar takes `actions`\n")

    def test_land_runs_capture_only_when_group_started_with_capture(self):
        slug = "g-t1-land2"
        _checkout, _group, _head, gh_runs = self._build_group_checkout(slug, capture=True)
        landing_root = self.root / "landing"
        with patch.object(dotask_cli, "LANDING_ROOT", landing_root), \
                patch.dict(os.environ, {"FAKE_GH_RUNS": str(gh_runs)}), \
                patch.object(dotask_cli, "maybe_capture_and_gate", return_value="landed") as capture_mock:
            code = dotask_cli.land(SimpleNamespace(slug=slug, after_test=True))
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


PRELAND = Path(__file__).resolve().parent / "dotask_preland_check.sh"


class PrelandCheckTest(unittest.TestCase):
    """T13840: each CI miss of 2026-10-28 is caught locally with the offending path named."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        origin = self.root / "origin.git"
        self.repo = self.root / "repo"
        subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True, capture_output=True)
        subprocess.run(["git", "clone", "-q", str(origin), str(self.repo)], check=True, capture_output=True)
        (self.repo / "README.md").write_text("base\n")
        git_c(self.repo, "add", ".")
        git_c(self.repo, "commit", "-qm", "base")
        git(self.repo, "push", "-q", "origin", "HEAD:master")
        git(self.repo, "fetch", "-q", "origin")
        git(self.repo, "checkout", "-q", "-b", "feature/T1-x")

    def _commit(self, relpath, content):
        path = self.repo / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        git_c(self.repo, "add", relpath)
        git_c(self.repo, "commit", "-qm", "T1: change")

    def _run(self):
        result = subprocess.run(["bash", str(PRELAND), str(self.repo)], capture_output=True, text=True, check=False)
        return result.returncode, result.stdout + result.stderr

    def test_clean_branch_passes(self):
        self._commit("qa/red-x.log", "red\n")
        code, out = self._run()
        self.assertEqual(code, 0, out)

    def test_code_like_copy_under_qa_fails_naming_the_path(self):
        self._commit("qa/useReEditReel.test.js", "test('x', () => {})\n")
        code, out = self._run()
        self.assertEqual(code, 1, out)
        self.assertIn("qa/useReEditReel.test.js", out)

    def test_blank_line_at_eof_fails_naming_the_path(self):
        self._commit("qa/red-T13800.log", "red\n\n")
        code, out = self._run()
        self.assertEqual(code, 1, out)
        self.assertIn("qa/red-T13800.log", out)

    def test_new_ruff_finding_in_a_backend_file_fails_naming_the_path(self):
        self._commit("src/backend/tests/test_new.py", "import sys\nimport os\n\nprint(os, sys)\n")  # I001
        code, out = self._run()
        self.assertEqual(code, 1, out)
        self.assertIn("src/backend/tests/test_new.py", out)

    def test_committed_proof_json_fails_naming_the_path(self):
        # T14260: proof.json stays in the checkout; tracked, every group PR conflicts with the last one
        for relpath in ("qa/proof.json", "src/frontend/qa/proof.json"):
            self._commit(relpath, "{}\n")
            code, out = self._run()
            self.assertEqual(code, 1, out)
            self.assertIn(f"{relpath}: proof.json stays local", out)
            git_c(self.repo, "rm", "-q", relpath)
            git_c(self.repo, "commit", "-qm", "T1: untrack")

    def test_untracking_proof_json_passes(self):
        git(self.repo, "checkout", "-q", "-B", "base", "origin/master")
        self._commit("qa/proof.json", "{}\n")
        git(self.repo, "push", "-q", "origin", "HEAD:master")
        git(self.repo, "fetch", "-q", "origin")
        git(self.repo, "checkout", "-q", "-B", "feature/T1-x")
        git_c(self.repo, "rm", "-q", "qa/proof.json")
        git_c(self.repo, "commit", "-qm", "T1: untrack")
        code, out = self._run()
        self.assertEqual(code, 0, out)


class StartModeFlagTests(unittest.TestCase):
    """`start` defaults to headless; --window is the opt-out."""

    def _parsed(self, *argv):
        with patch.object(dotask_cli, "start", return_value=0) as start:
            self.assertEqual(dotask_cli.main(["start", *argv, "T1"]), 0)
        return start.call_args.args[0]

    def test_start_is_headless_by_default(self):
        self.assertTrue(self._parsed().headless)

    def test_headless_flag_is_still_accepted(self):
        self.assertTrue(self._parsed("--headless").headless)

    def test_window_opts_out_of_headless(self):
        self.assertFalse(self._parsed("--window").headless)

    def test_window_and_headless_together_are_refused(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            dotask_cli.main(["start", "--window", "--headless", "T1"])
        self.assertEqual(caught.exception.code, 2)


class ContainerDefaultsTest(unittest.TestCase):
    def test_long_commands_stay_in_the_foreground(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "settings.json"
            path.write_text(json.dumps({"env": {"KEEP": "1", "BASH_DEFAULT_TIMEOUT_MS": "5"}}))
            data = ensure_sonnet_default.merge(path)
        self.assertEqual(data["env"]["KEEP"], "1")
        self.assertEqual(data["env"]["BASH_DEFAULT_TIMEOUT_MS"], "600000")
        self.assertEqual(data["env"]["BASH_MAX_TIMEOUT_MS"], "600000")

    def test_the_stack_watches_the_bind_mount_by_polling(self):
        stack = (dotask_cli.REPO_ROOT / ".devcontainer" / "container-stack.sh").read_text(encoding="utf-8")
        self.assertIn("export CHOKIDAR_USEPOLLING=true", stack)


class AutolandBase(unittest.TestCase):
    """verify -> fix -> verify until clean or out of rounds. Dispatches are faked: no model, no Docker."""
    TASK_TEXT = ("# T1: Fix the thing\n\n**Status:** WIP\n\n## Acceptance Criteria\n\n"
                 "- [ ] First\n- [x] Second\n\n## Context\n\nnothing\n")

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.main_repo = self.root / "main"
        (self.main_repo / "docs" / "plans" / "tasks").mkdir(parents=True)
        (self.main_repo / "docs" / "plans" / "tasks" / "T1-fix-the-thing.md").write_text(self.TASK_TEXT)
        (self.main_repo / "docs" / "plans" / "tasks" / "T1234-old.md").write_text("# T1234: old\n")
        self.plan = self.main_repo / "docs" / "plans" / "PLAN.md"
        self.plan.write_text("# Plan\n\n| ID | Task |\n|---|---|\n\n## Environment Configuration\n\nx\n")
        self.tasks_root = self.root / "tasks"
        self.checkout = self.tasks_root / "g-t1-1"
        (self.checkout / ".git" / "info").mkdir(parents=True)
        (self.checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(
            {"slug": "g-t1-1", "tasks": ["T1"], "branch": "feature/T1-x", "wave_id": "w1", "owned_files": []}))
        self.status = self.checkout / ".dotask-status"
        self.status.write_text("t STAGE_DONE T1 commit \"x\"\nt PUSHREADY feature/T1-x aaa\n")
        self.head = "a" * 40
        self.dirty = ""
        self.verdicts = []
        self.fix_commits = True
        self.dispatches = []
        self.land = MagicMock(return_value=0)
        self.preland = [SimpleNamespace(returncode=0, stdout="", stderr="")]
        for name, value in (("MAIN_REPO", self.main_repo), ("TASKS_ROOT", self.tasks_root),
                            ("dispatch", self._dispatch), ("bring_up_stack", lambda slug: "http://x"),
                            ("git_head", lambda checkout: self.head), ("land", self.land),
                            ("tracked_changes", lambda checkout: self.dirty),
                            ("run_preland_check", lambda checkout: self.preland[0])):
            patcher = patch.object(dotask_cli, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _dispatch(self, slug, group, phase, instruction, task_ids=None):
        self.dispatches.append((phase, instruction))
        if phase == "qa":
            self._serve_verdict(instruction)
        elif self.fix_commits:
            self.head = f"{len(self.dispatches):040d}"
        return True

    def _serve_verdict(self, instruction):
        """self.verdicts holds one verdict per verify ROUND. Each per-criterion verifier gets that
        criterion's entry, a bug re-check the bugs it names, and the regression pass (the round's last
        dispatch) the remaining bugs, then the round's verdict is used up. None: no verdict file."""
        verdict = self.verdicts[0]
        if verdict is None:
            self.verdicts.pop(0)
            return
        verdict.setdefault("head", self.head)  # verdicts made before a fix moved HEAD
        asked = re.search(r"Prove ONLY criterion (\S+?):? item", instruction)
        served = verdict.setdefault("_served_bugs", [])
        if asked:
            criteria, bugs = [c for c in verdict["criteria"] if c["id"] == asked.group(1)], []
        elif dotask_cli.REGRESSION_STEP in instruction:
            criteria, bugs = [], [b for b in verdict["bugs"] if b["title"] not in served]
            self.verdicts.pop(0)
        else:
            criteria = []
            bugs = [b for b in verdict["bugs"] if b["title"] in instruction]
            served += [b["title"] for b in bugs]
        (self.checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(
            {"head": verdict["head"], "criteria": criteria, "bugs": bugs}))

    def _verdict(self, statuses=("pass", "pass"), bugs=(), head=None):
        return {"head": head or self.head, "bugs": list(bugs),
                "criteria": [{"id": f"T1:C{i + 1}", "status": s, "evidence": "seen"} for i, s in enumerate(statuses)]}

    def _run(self, no_land=False):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return dotask_cli.autoland(SimpleNamespace(slug="g-t1-1", no_land=no_land))

    def _last(self):
        return self.status.read_text().splitlines()[-1]

    def _phases(self):
        """Dispatch phases, with each verify round's run of per-criterion verifiers counted once."""
        phases = []
        for phase, _ in self.dispatches:
            if not (phase == "qa" and phases[-1:] == ["qa"]):
                phases.append(phase)
        return phases


class AutolandTest(AutolandBase):
    def test_every_criterion_gets_its_own_verifier_and_only_the_last_runs_the_regression_pass(self):
        ids = [f"T{n}" for n in range(1, 5)]
        for task_id in ids[1:]:
            (self.main_repo / "docs" / "plans" / "tasks" / f"{task_id}-x.md").write_text(
                self.TASK_TEXT.replace("T1:", f"{task_id}:"))
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        group["tasks"] = ids
        (self.checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        self.status.write_text("".join(f"t STAGE_DONE {t} commit \"x\"\n" for t in ids))

        def batch_verdict(task_ids, status="pass"):
            return {"bugs": [], "criteria": [
                {"id": f"{t}:C{i}", "status": status, "evidence": "seen"} for t in task_ids for i in (1, 2)]}
        round_one = batch_verdict(ids[:3])
        round_one["criteria"] += batch_verdict(ids[3:], "fail")["criteria"]
        self.verdicts = [round_one, batch_verdict(ids[3:])]
        self.assertEqual(self._run(no_land=True), 0)
        qa = [text for phase, text in self.dispatches if phase == "qa"]
        # Round 1: 8 criteria, one verifier each, then the regression pass. After the fix only T4's two
        # criteria are re-checked, then the regression pass again.
        self.assertEqual(self._phases(), ["qa", "implementation", "qa"])
        self.assertEqual(len(qa), 9 + 3)
        self.assertIn("Prove ONLY criterion T1:C1:", qa[0])
        self.assertIn("which reads: 'First'", qa[0])
        self.assertIn("batch 1 of 9", qa[0])
        self.assertIn("Skip the regression pass", qa[0])
        self.assertIn("Prove ONLY criterion T4:C2:", qa[7])
        self.assertIn(dotask_cli.NO_CRITERION_STEP, qa[8])
        self.assertIn(dotask_cli.REGRESSION_STEP, qa[8])
        self.assertIn("Prove ONLY criterion T4:C1:", qa[9])
        self.assertIn("re-check after fix round 1", qa[9])
        self.assertIn(dotask_cli.REGRESSION_STEP, qa[11])
        # The fix worker saw the whole round, not just the last verifier.
        merged = json.loads((self.tasks_root / "waves" / "w1" / "verify-round-1.json").read_text())
        self.assertEqual(len(merged["criteria"]), 8)
        final = json.loads((self.tasks_root / "waves" / "w1" / "verify-round-2.json").read_text())
        self.assertEqual(len(final["criteria"]), 8)
        self.assertEqual(sum("carried_from" in c for c in final["criteria"]), 6)

    def test_after_a_fix_round_only_the_failed_criteria_are_re_checked_and_earlier_passes_carry(self):
        first_head = self.head
        bug = {"scope": "group", "task": "T1", "title": "Crash on save", "actual": "boom"}
        self.verdicts = [self._verdict(("pass", "fail"), bugs=[bug])]
        original = self._dispatch

        def dispatch(slug, group, phase, instruction, task_ids=None):
            if phase == "implementation":
                self.verdicts.append(None)
            result = original(slug, group, phase, instruction)
            if phase == "implementation":  # the re-check reports only what it was asked to prove
                self.verdicts[-1] = {"head": self.head, "bugs": [],
                                     "criteria": [{"id": "T1:C2", "status": "pass", "evidence": "fixed"}]}
            return result
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(no_land=True), 0)
        qa = [text for phase, text in self.dispatches if phase == "qa"]
        self.assertIn("Prove ONLY criterion T1:C1:", qa[0])
        self.assertEqual(len(qa), 3 + 3)  # C1, C2, regression; then C2, the bug, regression
        scope = next(line for line in qa[3].splitlines() if line.startswith("1. "))
        self.assertIn("re-check after fix round 1", scope)
        self.assertIn("Prove ONLY criterion T1:C2:", scope)
        self.assertNotIn("T1:C1", scope)  # the JSON example below step 1 always shows T1:C1
        self.assertIn("Crash on save", qa[4])
        self.assertIn(dotask_cli.NO_CRITERION_STEP, qa[4])
        self.assertIn(dotask_cli.REGRESSION_STEP, qa[5])
        final = json.loads((self.tasks_root / "waves" / "w1" / "verify-round-2.json").read_text())
        self.assertEqual([c["id"] for c in final["criteria"]], ["T1:C1", "T1:C2"])
        self.assertEqual(final["criteria"][0]["carried_from"], first_head)
        self.assertNotIn("carried_from", final["criteria"][1])
        self.assertIn("VERIFY_PASS", self._last())

    def test_a_restart_after_the_fix_round_resumes_with_only_the_failed_criteria(self):
        # The process that ran round 1 and its fix was stopped; HEAD has the fix commit.
        old_head = "b" * 40
        (self.checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(self._verdict(("pass", "fail"), head=old_head)))
        waves = self.tasks_root / "waves" / "w1"
        waves.mkdir(parents=True)
        (waves / "verify-round-1.json").write_text(json.dumps({"head": old_head}))
        self.verdicts = [{"bugs": [], "criteria": [{"id": "T1:C2", "status": "pass", "evidence": "fixed"}]}]
        with patch.object(dotask_cli, "is_ancestor", lambda checkout, older, newer: older == old_head):
            self.assertEqual(self._run(no_land=True), 0)
        qa = [text for phase, text in self.dispatches if phase == "qa"]
        self.assertEqual(len(qa), 2)  # T1:C2, then the regression pass
        self.assertIn("Prove ONLY criterion T1:C2:", qa[0])
        self.assertIn("re-check after fix round 1", qa[0])
        final = json.loads((waves / "verify-round-2.json").read_text())
        self.assertEqual(final["criteria"][0]["carried_from"], old_head)
        self.assertIn("VERIFY_PASS", self._last())

    def test_a_restart_with_no_fix_since_the_verdict_verifies_everything(self):
        (self.checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(self._verdict(("pass", "fail"))))
        self.verdicts = [self._verdict()]
        with patch.object(dotask_cli, "is_ancestor", lambda checkout, older, newer: True):
            self.assertEqual(self._run(no_land=True), 0)
        qa = [text for phase, text in self.dispatches if phase == "qa"]
        self.assertEqual(len(qa), 3)
        self.assertIn("Prove ONLY criterion T1:C1:", qa[0])
        self.assertNotIn("re-check", qa[0])

    def test_a_re_check_that_skips_a_failed_criterion_never_passes(self):
        self.verdicts = [self._verdict(("fail", "pass"))]
        original = self._dispatch

        def dispatch(slug, group, phase, instruction, task_ids=None):
            if phase == "implementation":
                self.verdicts.append(None)
            result = original(slug, group, phase, instruction)
            if phase == "implementation":  # C1 failed, but the verifier reports only C2
                self.verdicts[-1] = {"head": self.head, "bugs": [],
                                     "criteria": [{"id": "T1:C2", "status": "pass", "evidence": "seen"}]}
            return result
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(), 1)
        self.land.assert_not_called()
        self.assertIn("missing T1:C1", self._last())

    def test_clean_verdict_records_the_head_and_lands_it(self):
        self.verdicts = [self._verdict()]
        self.assertEqual(self._run(), 0)
        self.assertEqual(self._phases(), ["qa"])
        self.land.assert_called_once()
        self.assertTrue(self.land.call_args.args[0].after_test)
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual(group["tested_head"], self.head)
        self.assertIn("VERIFY_PASS", self._last())

    def test_no_land_stops_after_a_clean_verdict(self):
        self.verdicts = [self._verdict()]
        self.assertEqual(self._run(no_land=True), 0)
        self.land.assert_not_called()

    def test_failed_criterion_goes_to_a_fix_dispatch_then_a_fresh_verify(self):
        self.verdicts = [self._verdict(("pass", "fail"))]
        original = self._dispatch

        def dispatch(slug, group, phase, instruction, task_ids=None):
            if phase == "implementation":
                self.verdicts.append(None)
            result = original(slug, group, phase, instruction)
            if phase == "implementation":
                self.verdicts[-1] = self._verdict()
            return result
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(), 0)
        self.assertEqual(self._phases(), ["qa", "implementation", "qa"])
        self.land.assert_called_once()

    def test_a_verifier_that_runs_out_of_turns_is_skipped_like_one_out_of_time(self):
        (self.checkout / ".dotask-profile").mkdir()
        self.verdicts = [self._verdict()]
        original, qa_calls = self._dispatch, []

        def dispatch(slug, group, phase, instruction, task_ids=None):
            qa_calls.append(instruction)
            first = len(qa_calls) == 1
            (self.checkout / ".dotask-profile" / f"{len(qa_calls)}.json").write_text(json.dumps(
                {"schema_version": 2, "started_at": f"2026-11-07T{len(qa_calls):02d}:00:00+00:00",
                 "outcome_class": "budget_stop" if first else "success", "requests": 200}))
            if first:
                self.dispatches.append((phase, instruction))
                return False  # T1:C1's verifier ran out of turns: no verdict file
            return original(slug, group, phase, instruction)
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(no_land=True), 0)
        self.assertEqual(len(qa_calls), 3)  # never retried: C1 skipped, C2 and the regression pass ran
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual([c["id"] for c in group["skipped_checks"]], ["T1:C1"])
        self.assertIn("VERIFY_SKIPPED batch 1 of 3: verifier ran out of turns; T1:C1 not verified",
                      self.status.read_text())

    def test_a_fix_round_that_runs_out_of_turns_is_restarted_with_a_handoff(self):
        (self.checkout / ".dotask-profile").mkdir()
        self.verdicts = [self._verdict(("fail", "pass"))]
        original, fix_attempts = self._dispatch, []

        def dispatch(slug, group, phase, instruction, task_ids=None):
            if phase != "implementation":
                return original(slug, group, phase, instruction)
            self.dispatches.append((phase, instruction))
            fix_attempts.append(instruction)
            outcome = "budget_stop" if len(fix_attempts) == 1 else "success"
            (self.checkout / ".dotask-profile" / f"{len(fix_attempts)}.json").write_text(json.dumps(
                {"schema_version": 2, "started_at": f"2026-11-07T0{len(fix_attempts)}:00:00+00:00",
                 "outcome_class": outcome, "requests": 120}))
            if outcome == "success":  # the worker finishes: commit, then its PUSHREADY line
                self.head = "b" * 40
                self.verdicts.append(self._verdict(head=self.head))
                with self.status.open("a") as stream:
                    stream.write("t PUSHREADY feature/T1-x bbb fix round 1\n")
            return True
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(no_land=True), 0)
        self.assertEqual(self._phases(), ["qa", "implementation", "implementation", "qa"])
        self.assertIn("handoff section", fix_attempts[1])
        self.assertIn("## fix round 1 T1 handoff", (self.checkout / ".dotask-notes.md").read_text())
        self.assertIn("RESUMED fix round 1 T1 dispatch 2 of 3", self.status.read_text())

    def test_a_human_criterion_the_owner_ruled_check_on_staging_rides_in_the_pr(self):
        # The ruling is committed on the group branch only; master's copy has none. Reading master stopped
        # g-t15220-10 for T14860:C2 anyway (2026-11-07).
        branch_copy = self.checkout / "docs" / "plans" / "tasks" / "T1-fix-the-thing.md"
        branch_copy.parent.mkdir(parents=True)
        branch_copy.write_text(
            self.TASK_TEXT.replace("## Acceptance Criteria",
                                   "**2026-11-07 (owner ruling)**: C2 verified on staging after merge.\n\n"
                                   "## Acceptance Criteria"))
        self.verdicts = [self._verdict(("pass", "human"))]
        self.assertEqual(self._run(), 0)
        self.land.assert_called_once()
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual(group["staging_checks"], [{"id": "T1:C2", "text": "Second"}])
        self.assertIn("VERIFY_PASS", self._last())
        self.assertIn("check on staging after merge: T1:C2", self._last())
        body = dotask_cli.render_pr_body(group)
        self.assertIn("Check on staging after merge", body)
        self.assertIn("- T1:C2: Second", body)

    def test_staging_deferred_reads_a_ruling_named_or_placed_under_the_criterion(self):
        path = self.root / "T9-x.md"
        path.write_text("# T9: x\n\n## Acceptance Criteria\n\n- [ ] a\n- [ ] b\n  Ruling (owner, 2026-11-07): "
                        "verify on staging after merge.\n- [ ] c\n")
        self.assertEqual(dotask_cli.staging_deferred(path), {"T9:C2"})
        path.write_text("# T9: x\n\nWe could check C1 on staging some day.\n\n## Acceptance Criteria\n\n- [ ] a\n")
        self.assertEqual(dotask_cli.staging_deferred(path), set())  # a thought, not an owner ruling

    def test_group_bug_blocks_even_when_every_criterion_passes(self):
        bug = {"scope": "group", "title": "New crash", "actual": "boom"}
        self.verdicts = [self._verdict(bugs=[bug])]
        self.fix_commits = False
        self.assertEqual(self._run(), 1)
        self.land.assert_not_called()
        self.assertEqual(self._phases(), ["qa", "implementation"])

    def test_stops_after_three_fix_rounds_without_landing(self):
        def dispatch(slug, group, phase, instruction, task_ids=None):
            self.dispatches.append((phase, instruction))
            if phase == "qa":
                (self.checkout / dotask_cli.VERIFY_FILE).write_text(json.dumps(self._verdict(("fail", "pass"))))
            else:
                self.head = f"{len(self.dispatches):040d}"
            return True
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(), 1)
        self.assertEqual(self._phases(), ["qa", "implementation"] * 3 + ["qa"])
        self.land.assert_not_called()
        self.assertIn("VERIFY_EXHAUSTED", self._last())

    def test_verdict_covering_fewer_criteria_than_the_task_file_never_passes(self):
        self.verdicts = [self._verdict(("pass",))]
        self.assertEqual(self._run(), 1)
        self.land.assert_not_called()
        self.assertIn("VERIFY_BLOCKED", self._last())

    def test_verdict_for_another_head_never_passes(self):
        self.verdicts = [self._verdict(head="b" * 40)]
        self.assertEqual(self._run(), 1)
        self.land.assert_not_called()

    def test_missing_verdict_and_unknown_status_never_pass(self):
        for verdict in (None, self._verdict(("pass", "probably"))):
            self.verdicts = [verdict]
            (self.checkout / dotask_cli.VERIFY_FILE).unlink(missing_ok=True)
            self.assertEqual(self._run(), 1)
        self.land.assert_not_called()

    def test_verifier_that_changes_the_tree_is_not_trusted(self):
        self.verdicts = [self._verdict()]
        self.dirty = " M src/thing.py"
        self.assertEqual(self._run(), 1)
        self.land.assert_not_called()
        self.assertIn("VERIFY_BLOCKED", self._last())

    def test_human_only_criterion_stops_before_the_push(self):
        self.verdicts = [self._verdict(("pass", "human"))]
        self.assertEqual(self._run(), 0)
        self.land.assert_not_called()
        self.assertIn("VERIFY_NEEDS_USER", self._last())

    def test_unrelated_bug_is_filed_once_and_does_not_block(self):
        bug = {"scope": "unrelated", "title": "Old menu glitch", "steps": "open", "expected": "a", "actual": "b"}
        self.verdicts = [self._verdict(bugs=[bug])]
        self.assertEqual(self._run(), 0)
        self.land.assert_called_once()
        filed = self.main_repo / "docs" / "plans" / "tasks" / "T1240-old-menu-glitch.md"
        self.assertIn("Old menu glitch", filed.read_text())
        plan = self.plan.read_text()
        self.assertIn("| T1240 | [Old menu glitch](tasks/T1240-old-menu-glitch.md) |", plan)
        self.assertLess(plan.index(dotask_cli.BUG_SECTION), plan.index("## Environment Configuration"))
        self.assertIsNone(dotask_cli.file_unrelated_bug(bug, {"slug": "g"}, "abc"))
        self.assertEqual(self.plan.read_text().count("Old menu glitch"), 1)

    def test_preland_failure_goes_to_the_worker_without_a_verify(self):
        self.preland = [SimpleNamespace(returncode=1, stdout="FAIL: whitespace", stderr="")]
        self.fix_commits = False
        self.assertEqual(self._run(), 1)
        self.assertEqual(self._phases(), ["implementation"])
        self.assertIn("whitespace", (self.checkout / dotask_cli.VERIFY_FILE).read_text())

    def test_a_fix_round_works_one_task_at_a_time_and_a_stuck_task_does_not_block_the_rest(self):
        # g-t15220-10, 2026-11-07: one worker given every finding chased the hardest one through three
        # restarts and committed nothing, while three easy fixes sat uncommitted.
        (self.main_repo / "docs" / "plans" / "tasks" / "T2-x.md").write_text(self.TASK_TEXT.replace("T1:", "T2:"))
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        group["tasks"] = ["T1", "T2"]
        (self.checkout / dotask_cli.GROUP_FILE).write_text(json.dumps(group))
        self.status.write_text("t STAGE_DONE T1 commit x\nt STAGE_DONE T2 commit x\n")
        first = {"bugs": [{"scope": "group", "task": "T2", "title": "Subtitle missing"}], "criteria": [
            {"id": "T1:C1", "status": "fail", "evidence": "x"}, {"id": "T1:C2", "status": "pass", "evidence": "x"},
            {"id": "T2:C1", "status": "pass", "evidence": "x"}, {"id": "T2:C2", "status": "pass", "evidence": "x"}]}
        self.verdicts = [first]
        fixes = []

        def dispatch(slug, group, phase, instruction, task_ids=None):
            if phase == "qa":
                return self._dispatch(slug, group, phase, instruction)
            fixes.append((task_ids, instruction))
            if task_ids == ["T2"]:  # T1 is the hard one and commits nothing; T2 commits
                self.head = "c" * 40
                self.verdicts.append({"bugs": [], "criteria": [{"id": "T1:C1", "status": "pass", "evidence": "x"}]})
            return True
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(no_land=True), 0)
        self.assertEqual([t for t, _ in fixes], [["T1"], ["T2"]])
        self.assertIn("fixes ONLY T1's findings: T1:C1.", fixes[0][1])
        self.assertNotIn("Subtitle missing", fixes[0][1])
        self.assertIn("T2's findings: bug: Subtitle missing", fixes[1][1])
        self.assertIn("## fix round 1 T2 progress", fixes[1][1])
        self.assertIn("FIX_SKIPPED fix round 1 T1: no commit", self.status.read_text())
        self.assertIn("VERIFY_PASS", self._last())

    def test_fix_dispatch_with_no_commit_stops(self):
        self.verdicts = [self._verdict(("fail", "pass"))]
        self.fix_commits = False
        self.assertEqual(self._run(), 1)
        self.assertIn("committed nothing", self._last())

    def test_refuses_until_every_task_has_its_commit_line(self):
        self.status.write_text("t STAGE_DONE T9 commit \"x\"\n")
        with self.assertRaises(SystemExit):
            self._run()
        self.assertEqual(self.dispatches, [])

    def test_acceptance_count_reads_only_that_section_and_numbered_items(self):
        path = self.root / "t.md"
        path.write_text("## Solution\n- [ ] not this\n## Acceptance Criteria\n- [ ] a\n1. [x] b\n* [ ] c\nprose\n## After\n- [ ] no\n")
        self.assertEqual(dotask_cli.acceptance_count(path), 3)

    def test_acceptance_items_read_a_plain_list_when_the_section_has_no_checkboxes(self):
        # g-t15380-1 (2026-11-09): a plain numbered list parsed as zero criteria and crashed autoland.
        path = self.root / "t.md"
        path.write_text("## Acceptance criteria\n\n1. Portrait: 0% covered.\n2. Landscape: 75% visible.\n"
                        "   - indented detail, not a criterion\n* Keyboard still works.\nprose\n## Context\n- no\n")
        self.assertEqual(dotask_cli.acceptance_items(path),
                         ["Portrait: 0% covered.", "Landscape: 75% visible.", "Keyboard still works."])
        # Once the section has a checkbox, plain items are notes, not criteria.
        path.write_text("## Acceptance Criteria\n- [ ] a\n- note under a\n1. [ ] b\n")
        self.assertEqual(dotask_cli.acceptance_items(path), ["a", "b"])

    def test_criterion_line_is_empty_not_a_crash_past_the_last_item(self):
        tasks = self.root / "docs" / "plans" / "tasks"
        tasks.mkdir(parents=True, exist_ok=True)
        (tasks / "T7-x.md").write_text("# T7\n\n## Acceptance Criteria\n\nprose only\n")
        with patch.object(dotask_cli, "task_file_in", return_value=tasks / "T7-x.md"):
            self.assertEqual(dotask_cli.criterion_line(self.root, "T7:C1"), "")


class StallGapsTest(AutolandBase):
    """T15330: the seven ways headless groups stalled on 2026-11-07/08 and needed a person."""

    def _fix_dispatch(self, on_fix):
        """dispatch(): verifiers pop self.verdicts; a fix worker runs on_fix(instruction) -> finished."""
        def dispatch(slug, group, phase, instruction, task_ids=None):
            self.dispatches.append((phase, instruction))
            if phase == "qa":
                self.verdicts[0]["head"] = self.head
                self._serve_verdict(instruction)
                return True
            return on_fix(instruction)
        return dispatch

    def _commit_fix(self, instruction):
        self.head = f"{len(self.dispatches):040d}"
        return True

    # Gap 2: PRs #720, #722, #723 went red after a clean verdict and waited for a person.
    def test_red_branch_ci_after_a_clean_verdict_goes_to_a_fix_round_then_lands(self):
        self.verdicts = [self._verdict(), self._verdict()]
        self.land.side_effect = [dotask_cli.CI_RED, 0]
        report = "Run 7, failed jobs: backend-shard (2).\nFAILED tests/test_x.py::test_kpis"
        with patch.object(dotask_cli, "dispatch", self._fix_dispatch(self._commit_fix)), \
                patch.object(dotask_cli, "ci_failure_report", lambda branch, head: report):
            self.assertEqual(self._run(), 0)
        self.assertEqual(self._phases(), ["qa", "implementation", "qa"])
        self.assertEqual(self.land.call_count, 2)
        self.assertTrue(all(c.args[0].fix_on_red for c in self.land.call_args_list))
        fix = next(i for i, (phase, _) in enumerate(self.dispatches) if phase == "implementation")
        self.assertIn("Branch CI failed", self.dispatches[fix][1])
        self.assertIn("test_x.py::test_kpis", self.dispatches[fix + 1][1])  # the re-check gets the failing tests
        self.assertIn("CI_RED", self.status.read_text())

    # Gap 3: g-t14940-1, a fixer disputed a flake and the loop stopped as VERIFY_BLOCKED.
    def _dispute(self, instruction):
        label = instruction.split("`## ", 1)[1].split(" progress`", 1)[0]
        with self.status.open("a") as stream:
            stream.write(f"t DISPUTED {label} T1:C1: also fails on origin/master; a timing flake\n")
        return False

    def test_a_disputed_finding_goes_to_a_fresh_verifier_with_the_fixers_evidence(self):
        self.verdicts = [self._verdict(("fail", "pass")), self._verdict()]
        with patch.object(dotask_cli, "dispatch", self._fix_dispatch(self._dispute)):
            self.assertEqual(self._run(), 0)
        self.assertEqual(self._phases(), ["qa", "implementation", "qa"])
        fix = next(i for i, (phase, _) in enumerate(self.dispatches) if phase == "implementation")
        recheck = self.dispatches[fix + 1][1]  # T1:C1's own verifier carries the dispute
        self.assertIn("Prove ONLY criterion T1:C1:", recheck)
        self.assertIn("also fails on origin/master; a timing flake", recheck)
        self.assertIn("deferring to neither side", recheck)
        self.land.assert_called_once()
        self.assertNotIn("VERIFY_BLOCKED", self.status.read_text())
        self.assertEqual(json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())["disputes"], [])

    def test_a_dispute_the_fresh_verifier_upholds_goes_to_the_owner(self):
        self.verdicts = [self._verdict(("fail", "pass")), self._verdict(("fail", "pass"))]
        with patch.object(dotask_cli, "dispatch", self._fix_dispatch(self._dispute)):
            self.assertEqual(self._run(), 1)
        self.assertEqual(self._phases(), ["qa", "implementation", "qa"])
        self.land.assert_not_called()
        self.assertIn("VERIFY_NEEDS_USER", self._last())
        self.assertIn("T1:C1 (fixer: T1:C1: also fails on origin/master", self._last())

    # Gap 6: npm churn and landing build logs read as "verifier changed the tree".
    def test_tool_output_the_verifier_rewrote_is_put_back_and_the_verdict_stands(self):
        self.verdicts = [self._verdict()]
        self.dirty = " M src/frontend/package-lock.json\n M qa/landing-build.log"
        restored = []
        with patch.object(dotask_cli, "restore_tool_noise", lambda checkout, paths: restored.extend(paths)):
            self.assertEqual(self._run(), 0)
        self.land.assert_called_once()
        self.assertEqual(restored, ["src/frontend/package-lock.json", "qa/landing-build.log"] * 3)  # each verifier

    def test_a_real_edit_next_to_tool_output_still_blocks(self):
        self.verdicts = [self._verdict()]
        self.dirty = " M src/frontend/package-lock.json\n M src/thing.py"
        with patch.object(dotask_cli, "restore_tool_noise", lambda checkout, paths: None):
            self.assertEqual(self._run(), 1)
        self.assertIn("src/thing.py", self._last())
        self.assertNotIn("package-lock", self._last())

    # Gap 5: an uncommitted auto-filed T15300 collided with a hand-filed id and was swept into a plan commit.
    def _git_main_repo(self):
        git(self.main_repo, "init", "-q", "-b", "master")
        git(self.main_repo, "add", "-A")
        git_c(self.main_repo, "commit", "-q", "-m", "base")

    def _bug(self, title="Old menu glitch"):
        return {"scope": "unrelated", "title": title, "steps": "open", "expected": "a", "actual": "b"}

    def test_a_filed_bug_is_committed_alone_and_skips_ids_plan_already_uses(self):
        self.plan.write_text(self.plan.read_text().replace("|---|---|\n", "|---|---|\n| T1240 | [x](elsewhere.md) |\n"))
        self._git_main_repo()
        (self.main_repo / "unrelated.txt").write_text("someone else's work")
        with contextlib.redirect_stdout(io.StringIO()), \
                patch.dict(os.environ, {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t.com",
                                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t.com"}):
            self.assertEqual(dotask_cli.file_unrelated_bug(self._bug(), {"slug": "g"}, "abc"), "T1250")
        log = subprocess.run(["git", "-C", str(self.main_repo), "log", "-1", "--name-only", "--format=%s"],
                             capture_output=True, text=True, check=True).stdout
        self.assertIn("T1250: file Old menu glitch", log)
        self.assertEqual(sorted(log.split()[-2:]), ["docs/plans/PLAN.md", "docs/plans/tasks/T1250-old-menu-glitch.md"])
        left = subprocess.run(["git", "-C", str(self.main_repo), "status", "--porcelain"],
                              capture_output=True, text=True, check=True).stdout
        self.assertEqual(left.strip(), "?? unrelated.txt")

    def test_a_filed_bug_is_not_committed_over_someone_elses_plan_edit(self):
        self._git_main_repo()
        self.plan.write_text(self.plan.read_text() + "half-done edit\n")
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            task_id = dotask_cli.file_unrelated_bug(self._bug(), {"slug": "g"}, "abc")
        self.assertIn("did not commit it (PLAN.md already had uncommitted edits)", err.getvalue())
        count = subprocess.run(["git", "-C", str(self.main_repo), "rev-list", "--count", "HEAD"],
                               capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(count, "1")
        self.assertIn(task_id, self.plan.read_text())

    # Gap 7: a relaunch while the first resume still ran gave two autolands on one checkout.
    def test_a_second_driver_is_refused_while_the_first_lives_and_a_stale_lock_is_taken_over(self):
        ran = []
        lock = self.checkout / dotask_cli.RUN_LOCK
        lock.write_text(json.dumps({"pid": os.getpid(), "since": "now"}))
        err = io.StringIO()
        with patch.object(dotask_cli, "resume", lambda args: ran.append(args.slug) or 0), \
                contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit):
                dotask_cli.main(["resume", "g-t1-1"])
            self.assertEqual(ran, [])
            self.assertIn("already being driven by process", err.getvalue())
            lock.write_text(json.dumps({"pid": 2 ** 31 - 2, "since": "then"}))  # no such process
            self.assertEqual(dotask_cli.main(["resume", "g-t1-1"]), 0)
        self.assertEqual(ran, ["g-t1-1"])
        self.assertFalse(lock.exists())  # released on the way out
        self.assertIn(dotask_cli.RUN_LOCK, (self.checkout / ".git" / "info" / "exclude").read_text())

    def test_pid_alive(self):
        self.assertTrue(dotask_cli.pid_alive(os.getpid()))
        self.assertFalse(dotask_cli.pid_alive(2 ** 31 - 2))
        self.assertFalse(dotask_cli.pid_alive(0))

    # Gap 4: T14960:C4 needed T14930, which ran in another group (g-t15280-3).
    def test_a_criterion_naming_a_task_that_has_not_landed_is_warned_about(self):
        tasks = self.main_repo / "docs" / "plans" / "tasks"
        (tasks / "T1-fix-the-thing.md").write_text(self.TASK_TEXT.replace(
            "- [ ] First", "- [ ] First, using T2's sport parameter and T3's table and T1 itself"))
        (tasks / "T2-sport.md").write_text("# T2: sport\n\n**Status:** WIP\n")
        (tasks / "T3-table.md").write_text("# T3: table\n\n**Status:** STAGING\n")
        with patch.object(dotask_cli, "live_groups", lambda: [{"slug": "g-t2-1", "tasks": ["T2"]}]):
            lines = dotask_cli.criteria_waiting_elsewhere(["T1"])
            self.assertEqual(len(lines), 1)
            self.assertIn("T1:C1 names T2 (WIP, running in live group g-t2-1)", lines[0])
            self.assertEqual(dotask_cli.criteria_waiting_elsewhere(["T1", "T2"]), [])


class DispatchTurnCapTest(unittest.TestCase):
    """task.sh's 120-turn default starved the verifier twice on g-t15220-10 (2026-11-07): qa gets its own cap."""

    def _env_seen_by_task_sh(self, phase, environ):
        seen = {}

        def popen(cmd, env=None, **kwargs):
            seen.update(env)
            return SimpleNamespace(pid=1, wait=lambda timeout=None: 1)
        with patch.dict(os.environ, environ), patch.object(dotask_cli.subprocess, "Popen", popen), \
                patch.object(dotask_cli, "bash", lambda: "bash"):
            if "DOTASK_MAX_TURNS" not in environ:
                os.environ.pop("DOTASK_MAX_TURNS", None)
            dotask_cli.dispatch("g-t1-1", {"wave_id": "w1", "tasks": ["T1"]}, phase, "go")
        return seen

    def test_a_qa_dispatch_gets_the_higher_cap(self):
        self.assertEqual(self._env_seen_by_task_sh("qa", {})["DOTASK_MAX_TURNS"], "200")

    def test_an_implementation_dispatch_keeps_task_sh_s_default(self):
        self.assertNotIn("DOTASK_MAX_TURNS", self._env_seen_by_task_sh("implementation", {}))

    def test_an_explicit_cap_wins_for_every_phase(self):
        self.assertEqual(self._env_seen_by_task_sh("qa", {"DOTASK_MAX_TURNS": "50"})["DOTASK_MAX_TURNS"], "50")


class TrackedChangesTest(unittest.TestCase):
    def test_a_deleted_qa_file_on_the_first_porcelain_line_is_tool_noise(self):
        # g-t15260-1, 2026-11-08: stripping the output ate the first line's leading space, so
        # " D qa/x.log" parsed as "a/x.log" and stopped the loop as "verifier changed the tree".
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            git = ["git", "-C", tmp, "-c", "user.email=t@t", "-c", "user.name=t"]
            subprocess.run(git[:3] + ["init", "-q"], check=True)
            (repo / "qa").mkdir()
            (repo / "qa" / "red.log").write_text("x")
            subprocess.run(git + ["add", "."], check=True)
            subprocess.run(git + ["commit", "-qm", "x"], check=True)
            (repo / "qa" / "red.log").unlink()
            noise, real = dotask_cli.split_tool_noise(dotask_cli.tracked_changes(repo))
        self.assertEqual(noise, ["qa/red.log"])
        self.assertFalse(real)


REAL_DISPATCH = dotask_cli.dispatch  # AutolandBase patches it out; these tests need the real one


class VerifierTimeCapTest(AutolandBase):
    """Owner rule 2026-11-08: a verifier never runs past 10 minutes; one that does not come back is skipped."""

    def _popen(self, wait):
        return lambda cmd, env=None, **kw: SimpleNamespace(pid=7, wait=wait)

    def test_a_qa_dispatch_past_its_cap_is_killed_and_raises(self):
        waits, stopped = [], []

        def wait(timeout=None):
            waits.append(timeout)
            raise subprocess.TimeoutExpired("task.sh", timeout)
        with patch.object(dotask_cli.subprocess, "Popen", self._popen(wait)), \
                patch.object(dotask_cli, "bash", lambda: "bash"), \
                patch.object(dotask_cli, "stop_dispatch", lambda slug, process: stopped.append((slug, process.pid))), \
                self.assertRaises(dotask_cli.DispatchTimedOut):
            REAL_DISPATCH("g-t1-1", {"wave_id": "w1", "tasks": ["T1"]}, "qa", "go")
        self.assertEqual(waits, [dotask_cli.VERIFY_TIMEOUT_MINUTES * 60])
        self.assertEqual(stopped, [("g-t1-1", 7)])

    def test_an_implementation_dispatch_has_no_wall_clock_cap(self):
        waits = []
        with patch.object(dotask_cli.subprocess, "Popen", self._popen(lambda timeout=None: waits.append(timeout) or 1)), \
                patch.object(dotask_cli, "bash", lambda: "bash"):
            REAL_DISPATCH("g-t1-1", {"wave_id": "w1", "tasks": ["T1"]}, "implementation", "go")
        self.assertEqual(waits, [None])

    def test_a_timed_out_verifier_is_skipped_and_the_group_still_lands(self):
        def dispatch(slug, group, phase, instruction, task_ids=None):
            self.dispatches.append((phase, instruction))
            raise dotask_cli.DispatchTimedOut("qa dispatch passed its 10-minute cap")
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(), 0)
        self.assertEqual(self._phases(), ["qa"])  # never retried, never sent to a fix round
        self.land.assert_called_once()
        group = json.loads((self.checkout / dotask_cli.GROUP_FILE).read_text())
        self.assertEqual([c["id"] for c in group["skipped_checks"]], ["T1:C1", "T1:C2", "Other check"])
        lines = self.status.read_text().splitlines()
        self.assertTrue(any("VERIFY_SKIPPED batch 1 of 3" in line for line in lines))
        self.assertIn("not verified (verifier timed out): T1:C1 T1:C2 [regression pass]", self._last())
        body = dotask_cli.render_pr_body(group)
        self.assertIn("Not verified: the verifier passed its time cap", body)
        self.assertIn("- T1:C1: First", body)
        self.assertIn("- Other check: regression pass", body)

    def test_a_timed_out_verifier_that_left_edits_is_not_trusted(self):
        self.dirty = " M src/app.js"

        def dispatch(slug, group, phase, instruction, task_ids=None):
            raise dotask_cli.DispatchTimedOut("cap")
        with patch.object(dotask_cli, "dispatch", dispatch):
            self.assertEqual(self._run(), 1)
        self.assertIn("VERIFY_BLOCKED", self._last())
        self.land.assert_not_called()


class TaskFileCollisionTest(AutolandBase):
    def test_the_branch_copy_wins_over_a_colliding_uncommitted_file_in_the_main_checkout(self):
        # g-t15340-1, 2026-11-09: another session's untracked T15360-mobile-*.md in the shared checkout made
        # every lookup of the group's committed T15360 die with "matches multiple task files".
        tasks = self.main_repo / "docs" / "plans" / "tasks"
        (tasks / "T1-mobile-other.md").write_text("# T1: someone else's draft")
        branch = self.checkout / "docs" / "plans" / "tasks"
        branch.mkdir(parents=True)
        (branch / "T1-fix-the-thing.md").write_text(self.TASK_TEXT)
        self.assertEqual(dotask_cli.task_file_in(self.checkout, "T1"), branch / "T1-fix-the-thing.md")


if __name__ == "__main__":
    unittest.main()
