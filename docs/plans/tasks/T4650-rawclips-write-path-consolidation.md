# T4650: raw_clips Write-Path Consolidation (Bulk vs Gesture)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-03
**Source:** Audit item E11 ([audit doc](../audit-2026-07-03-code-quality.md)) · After T4270 (its caller inventory feeds this)

## Problem

[SYNC][DRY] raw_clips annotations have TWO write paths that can disagree:

- **Gesture path (canonical):** `clips.py` `save_raw_clip` (:911-1049) / `update_raw_clip` (:1052-1181) — surgical, per-gesture, with boundaries-version logic.
- **Bulk path:** `games.py:1599-1699` `save_annotations_to_db` — full-table sync (UPDATE/INSERT/DELETE), described as called "whenever annotations change" (:1445), with its own duplicated boundaries-version logic.

"Single write path per data" is the rule; two implementations of boundaries-version logic means the T350-corruption class is one drift away. T4270 already removed the dead FRONTEND caller of the bulk endpoint; this task deals with what remains.

## Solution (investigate → decide → consolidate; do NOT assume the bulk path is deletable)

1. **Caller census** (T4270's inventory + fresh grep): who calls `save_annotations_to_db`? Candidates per the audit: share materialization, recap flows, import flows. For EACH caller, determine whether it's (a) genuinely bulk (importing N clips at once — legitimate) or (b) a full-state rewrite of gesture-owned data (illegitimate — route through the gesture path or a batch variant of it).
2. **One boundaries-version implementation:** extract the version logic from save/update_raw_clip into a shared function; the bulk path (if it survives for legitimate bulk cases) uses IT — never a parallel copy.
3. If the bulk path survives, rename/re-document it for its actual purpose (e.g., `import_raw_clips`) with a docstring stating it must never run on user-editing-owned data; if it doesn't survive, delete it and its endpoint.

## Context

- Files: `src/backend/app/routers/clips.py`, `routers/games.py`, callers per census
- History: T1540 (gesture persistence during upload) and the boundaries-version machinery exist because annotate edits during uploads are tricky — read both save paths fully before deciding anything.
- Gesture-based-sync skill is the governing doc.

## Steps

1. [ ] Caller census table (caller → bulk-legit? → migration plan) in the Progress Log. **If any caller's legitimacy is unclear, surface the question before proceeding.**
2. [ ] Extract shared boundaries-version logic + tests (both paths' current tests stay green).
3. [ ] Per-caller migration/deletion, one commit each.
4. [ ] E2E: annotate save/edit/delete; share-materialization flow; recap create-clip (T4130 path) — whichever callers survive.

## Acceptance Criteria

- [ ] One boundaries-version implementation
- [ ] Every remaining raw_clips writer is either the gesture path or a named, documented bulk-import path that cannot touch gesture-owned rows
- [ ] Caller census recorded; unclear cases escalated, not guessed
