---
name: nextup
description: "Pick the next work from PLAN.md as a BUNDLE of TODO tasks that touch the same code area, confirm it with the user, then start it as one /dotask group (one container, one branch, one PR). The worker clears its conversation between task commits but carries what it learned about the shared code forward in /workspace/.dotask-notes.md. Usage: /nextup [focus words] [--headless] [--capture]"
license: MIT
metadata:
  author: video-editor
  version: 1.0.0
user-invocable: true
---

# /nextup

Choose the next highest-priority work, bundled by code area, and start it with `/dotask`.

## Why bundles

A `/dotask` group works its tasks one per conversation (fresh context per task is an estimated
33-51% fewer worker input tokens, 2026-10-08). The cost is that each fresh conversation
re-learns the code. When every task in the group touches the same code, the worker's
`/workspace/.dotask-notes.md` (read first, appended after each commit, see the kickoff
template) hands that learning forward: the second task onward starts from the first
task's map of the component, its conventions and its traps. The CtaBar group (g-t12020-1,
2026-10-09) is the model case: eight tasks, one shared component.

## Steps

1. **Candidates.** Run `bash scripts/dotask.sh nextup --limit 8`. It reads PLAN.md's TODO rows in
   priority order and joins tasks that share a Relevant File or an epic folder. It holds back
   tasks whose files a live group owns (`held:` lines) and names unresolvable ids (`skipped:`).
   The joins are mechanical; the bundle is your judgment.
2. **Judge the top bundles.** Read the task files of the first few bundles (Context and Relevant
   Files; don't explore code). A good bundle:
   - **Shares learnable code.** Tasks edit the same component, module or flow, so notes from one
     save real exploration in the next. Drop an epic-mate that touches unrelated code. Pull in a
     task from another bundle that edits the same component or directory (the script only joins
     on identical paths).
   - **Is implementable in a container.** Leave out tasks that are a user decision, an
     investigation awaiting the user, a human-only walkthrough, or an analytics read. Say why.
   - **Is 2-8 tasks.** Split a bigger bundle by sub-area; a lone task is fine when nothing shares
     its code.
   - **Respects priority.** Prefer the highest-ranked bundle. Only pass it over for a bundle that
     ranks nearly as high and shares more code, and say so.
   - **Is ordered foundation first.** PLAN order, unless a task's Related Tasks or text says it
     builds on another task in the bundle.
   If the user gave focus words (`/nextup cta`), prefer bundles matching them in titles, epics or
   files.
3. **Confirm.** Ask with `AskUserQuestion`: up to 3 bundles, recommended first. Label = the code
   area (e.g. "CtaBar screens"); description = the task ids in order, the shared code, and
   anything you left out and why. Starting flips PLAN.md statuses to WIP and opens a container,
   so never start without the user's pick.
4. **Start.** `bash scripts/dotask.sh start [--headless] [--capture] <ids in order>` (pass through
   the flags the user gave). A group's task list is fixed at start, so get the bundle right in
   step 3. Relay exactly what `/dotask` relays: slug, branch, window (or log path). Add one line:
   the worker clears between task commits; shared learnings travel in
   `/workspace/.dotask-notes.md`, archived to the wave folder by `/dotask land --after-test`.
   Then return. Landing is `/dotask land <slug>`, unchanged.

A `preflight` refusal from `start` (status, merged commit, overlap with a live group) exits 2:
relay it and offer the bundle without the refused tasks. Never retry with `--allow-overlap`
unless the user asks.
