# T13720: Knowledge docs name only real code

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-10-27
**Follow-up of:** T13710
**Updated:** 2026-11-13

## In plain words

The knowledge docs the AI agents load before working point at 48 files or functions that no longer exist, 34 of them in the Annotate and Frame docs. An agent that trusts them searches for code that is gone or copies a dead pattern. Fix every reference and set the allowed count to zero, so CI blocks any new one. The Annotate doc can be fixed now; the others wait for the multi-clip removal (T11250, T11260, T11270), which rewrites them.

## Current facts (checked 2026-11-13)

Checked against the code on 2026-11-13. Where the older text further down disagrees, this section is right.

- `scripts/check_doc_drift.py` has `BASELINE = 49`; the real count is 48: `annotate.md` 20, `keyframes-framing.md` 14, `export-pipeline.md` 3, seven other files at 1 or 2 each.
- `.claude/knowledge/modal-gpu.md` names `call_modal_framing_ai` as a live caller; it is not (T4410 deletes it).

## Problem

`scripts/check_doc_drift.py` (T13710) found 51 backticked path references in instruction and
knowledge docs that resolve to nothing. Almost all are files later code PRs deleted or renamed
(e.g. `DownloadsPanel.jsx` deleted 2026-09-04, `ClipSelectorSidebar.jsx` 2026-09-27,
`resultRetentionNote.js` 2026-10-05, several `e2e/T*.qa.spec.js`). Agents load these docs at task
start, so a dead entry point sends them looking for code that no longer exists. Distribution at
filing: annotate.md 20, keyframes-framing.md 14, export-pipeline.md 3, modal-gpu.md 3,
backend-services.md 2, persistence-sync.md 2, coding-standards.md 2, 4-implementation.md 2,
retrospectives/README.md 1, dotask SKILL.md 1, har-analysis SKILL.md 1.

The check already blocks NEW dead references; this task clears the backlog.

## Solution

1. `python scripts/check_doc_drift.py` lists nothing until the total exceeds `BASELINE`; to see the
   list, temporarily run it with a lower baseline, or call `dead_refs('.', 'HEAD')` from Python.
2. For each reference, find what replaced the file (`git log --diff-filter=D -- '*<name>'`, then the
   follow-up commit) and point the doc at the current entry point, or delete the line if the
   behaviour is gone. A line that intentionally describes removed code should say so (removed /
   renamed / replaced), which the checker treats as history.
3. Lower `BASELINE` in `scripts/check_doc_drift.py` to the new count (target 0) in the same PR.
4. Also review the ~150 code-shaped symbols the investigation found missing from the code
   (backticked names in the knowledge docs); the checker only blocks these on added lines.

## Acceptance

- `python scripts/check_doc_drift.py` passes with `BASELINE` at the new count, ideally 0.
- Each changed knowledge doc still describes current code (spot-check entry points exist).
