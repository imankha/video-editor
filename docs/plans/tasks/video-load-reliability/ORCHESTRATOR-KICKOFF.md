# Orchestrator Kickoff Prompt — Video Load Reliability Epic

Paste the block below into a fresh Claude Code session started from the repo root (`C:\Users\imank\projects\video-editor`) on `master`. The orchestrator will run the cascade, spawning one subagent per task.

---

```
You are the orchestrator for the "Video Load Reliability" epic. Read
docs/plans/tasks/video-load-reliability/EPIC.md before anything else — it lists
the three tasks in priority order and the shared context.

ROLE
You do NOT write code yourself. You delegate each task to a fresh subagent (use
the Agent tool, subagent_type "general-purpose"), then verify, merge, and pass
forward information the next subagent needs.

TASK ORDER (strict — do not parallelize; each unblocks/informs the next)
  1. T1360 — Blob URL Error Recovery    (user-blocking error)
  2. T1370 — Blob Preload Size Gate + Unmount Safety  (removes T1360's root cause)
  3. T1350 — Cache Warming CORS Cleanup  (console hygiene)

For each task, follow this protocol EXACTLY:

  A. Precheck
     - Confirm git status is clean and current branch is master (or the prior
       task's merge commit). Pull latest.
     - Read the task file: docs/plans/tasks/video-load-reliability/T{id}-*.md
     - Create the branch specified in the task file.

  B. Delegate implementation
     Spawn a subagent with a self-contained prompt that includes:
       - Path to the task file
       - Path to EPIC.md for shared context
       - Any findings carried forward from prior tasks (see C below)
       - The standing repo rules: CLAUDE.md, src/frontend/CLAUDE.md
       - Explicit instruction: WRITE THE FAILING TEST FIRST, commit it, THEN
         implement the fix, THEN re-run the test. Record before/after numbers
         in the task file's Result table.
       - Explicit instruction: no reactive useEffect persistence, no console.logs
         in committed code, no silent fallbacks for internal data.
       - Return value: a structured report containing
           * branch name + final commit SHA
           * before-test failure output (short)
           * after-test pass output (short)
           * files changed
           * anything surprising that later tasks should know
           * any scope creep it resisted (so you can confirm)

  C. Carry-forward findings
     Maintain a running notes file at
     docs/plans/tasks/video-load-reliability/ORCHESTRATOR-NOTES.md
     After each task completes, append: what the subagent learned about the
     shared code path (useVideo.js, AnnotateContainer.jsx, cacheWarming.js)
     that the NEXT subagent should read before starting. Keep entries terse.

  D. Verify
     - Run the full frontend test suite:
         cd src/frontend && npm test 2>&1 > /tmp/test-output.log; echo "exit: $?"
       Use reduce_log if you need to inspect.
     - Run the task's specific e2e:
         cd src/frontend && npx playwright test <spec> 2>&1 > /tmp/e2e.log; echo "exit: $?"
     - If anything else breaks, DO NOT merge. Hand back to a subagent to fix
       on the same branch.

  E. Hand to user for approval
     Per repo rules in CLAUDE.md, AI cannot mark tasks DONE. Update the task
     file status to TESTING, set the PLAN.md row to TESTING, and tell the user:
        "T{id} implementation is complete and tests pass. Ready to merge?
         Reply 'complete' or 'done' to mark DONE and proceed to the next task."

  F. Merge (only after user approval)
     - git checkout master && git pull
     - git merge --no-ff feature/T{id}-{slug}
     - Do NOT push — per standing feedback, master merges stay local until user
       explicitly asks to push.
     - Update PLAN.md: status → DONE.
     - Move to next task.

EPIC RULES (non-negotiable)
  - One branch per task. No batching.
  - Before-test must fail on master and pass on the feature branch. If the
    "before" test passes on master, the task premise is wrong — stop and ask.
  - Do not skip tasks. Do not reorder without user approval.
  - If a subagent's report reveals a task is already solved or no longer
    relevant (e.g., T1370 alone eliminates all T1360 cases), pause and ask
    the user before proceeding.
  - Follow the user's standing preferences from memory:
    * Never merge without explicit approval.
    * Never push master without explicit approval.
    * No --no-verify, no hook skipping.

START NOW with task 1 (T1360). Read EPIC.md and the T1360 file, confirm
repo state, then spawn the first subagent.
```

---

## Why this structure

- **Each task delivers a visible win** with a test that proves it. No silent infra tasks.
- **One branch per task** keeps the "before" baseline cleanly reproducible on master.
- **Priority = user severity:** T1360 unblocks the stuck user; T1370 removes the source of the problem; T1350 is polish.
- **Carry-forward notes file** means the T1370 subagent sees what the T1360 subagent learned about `useVideo.js` without you having to re-explain.
- **User gates merges** — matches your standing feedback that AI only sets TESTING; only you say "done".
