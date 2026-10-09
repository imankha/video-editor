# Kickoff: group __SLUG__

Branch: `__BRANCH__` (ONE branch, ONE PR for this whole group). Wave: `__WAVE_ID__`.
__TASK_COUNT__ task(s), worked IN ORDER, ONE COMMIT PER TASK. Each commit subject starts with
that task's id (`T1234: ...`); acceptance criteria are namespaced `T1234:C1`.

## Tasks

__TASK_LIST__

## One task per conversation (resume protocol)

0. Read `/workspace/.dotask-notes.md` if it exists: what earlier tasks in this group learned
   about the code you all touch. Trust it over re-exploring that code (code is still truth;
   fix a note that proves wrong).
1. Read `/workspace/.dotask-status` (it may not exist yet). A task with a
   `STAGE_DONE <task> commit` line is done. Work ONLY the first task without one. If the group
   branch isn't checked out yet, `git checkout -b __BRANCH__` (once, for the first task only).
2. Finish a task in this order: `git commit`, THEN append a `## T<id>` section to
   `/workspace/.dotask-notes.md`, THEN the `STAGE_DONE <task> commit` status line (it marks the
   task done, so the notes must already be written when it lands). The notes are gitignored,
   never commit them. Write only what a LATER task in this group needs and would otherwise
   re-discover. Shared component/API as actually used, how call sites are wired,
   conventions, test helpers and patterns, traps you hit, decisions made and why, and what
   you added that later tasks can reuse. Terse facts, under ~40 lines; no narrative of
   what you did (git has that).
   When all three are in and tasks remain, STOP. End your turn with
   exactly: `T<id> committed (<k>/__TASK_COUNT__). Send /clear, then: Implement /workspace/.dotask-kickoff.md`
   Do not start the next task in this conversation: every request re-reads the whole
   conversation, and one session across 8 tasks grew from 48k to 190k tokens per request
   (2026-10-08). The next conversation resumes from the status file and git, not memory.
3. After the LAST task's commit line: append `<UTC yyyy-mm-ddTHH:MM> PUSHREADY __BRANCH__ <sha>`
   (the one final line; a headless run stops on it), then tell the
   user: **run `/dotask land __SLUG__`**. It starts the app stack and prints a URL for the
   human test; after testing, `/dotask land __SLUG__ --after-test` pushes and opens the PR.

## Rules (every task)

- CLAUDE.md is already in your context (don't re-read it). Read this task's file and the
  knowledge doc(s) it names BEFORE exploring. Docs are claims, code is truth.
- Failing test first (observe it fail for the intended reason), implement, run the named
  relevant tests + explicit lint, commit with EXPLICIT `git add <paths>` (never `-A`/`-a`),
  subject `T<id>: <summary>`, ending `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Append one status line to `/workspace/.dotask-status` per stage, IN THE SAME shell command as
  the stage's last action: `<UTC yyyy-mm-ddTHH:MM> STAGE_DONE <task> <stage> "<detail>"`.
  The commit stage's line is the resume key: `STAGE_DONE <task> commit "<tests run>"`.
- **Red/green proof** (required): before production code changes, run the new test against the
  unchanged code, raw output to `qa/red-<test>.log`; after the fix, `qa/green-<test>.log`. Before
  this task's commit, MERGE its entries into `qa/proof.json` (create it on the first task; keep
  earlier tasks' entries, which a fresh conversation only knows from the file):
  ```json
  {
    "task_ids": ["T1", "T2"],
    "criteria": [{"id": "T1:C1", "description": "...", "artifacts": ["test1", "red1", "green1"]}],
    "artifacts": {
      "test1": {"path": "qa/test_x.py", "sha256": "<hex, from sha256sum when you ran red/green>"},
      "red1": {"path": "qa/red-test_x.log"},
      "green1": {"path": "qa/green-test_x.log"}
    },
    "tests": [{"criteria": ["T1:C1"], "test": "test1", "red_log": "red1", "green_log": "green1",
               "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError: ..."}],
    "human_checks": []
  }
  ```
  Paths are relative to the checkout root; `scripts/dotask_evidence.py` re-hashes any artifact
  with a `sha256` and refuses evidence if the test file changed since red/green.
- Test scope: the RELEVANT SET only (~10 tests: new tests + regression tests for the files you
  change + at most one e2e spec). Never a full suite. Name the set in the status line.
- Do NOT spawn a reviewer (capture flag: __CAPTURE__). If one focused fix attempt fails on a
  non-obvious mechanism, spawn `expert` (Opus) once with the knowledge doc name and a precise
  question; also for design tradeoffs, async/persistence/concurrency, or real performance
  analysis. Use `code-expert` first for an unknown entry point or a stale knowledge doc.
- Persistence: gesture-based only; no `useEffect` that writes to a store/backend. No silent
  fallbacks for internal data.
- Headless run: every command in the foreground (a backgrounded command or ScheduleWakeup ends
  the dispatch).
- Never `git push` / `gh pr create` -- you have no push creds by design.
- Last task only: update the touched knowledge doc(s) if you learned a new invariant; the notes
  file is the place to find candidates (anything durable beyond this group belongs in the doc).
