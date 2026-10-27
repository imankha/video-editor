# T13720: Fix the dead references in knowledge docs and ratchet the drift baseline to 0

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-10-27
**Follow-up of:** T13710

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
