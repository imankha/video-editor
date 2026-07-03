# T4500: selectedProject → id + Selector (Fix Rename Desync)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit item D4

## Problem

[SYNC] The selected project's data lives twice in `projectsStore`: in the `projects[]` array AND as an independently-fetched `selectedProject` snapshot (:26-28 state; `selectProject` :125-135 fetches a separate copy). Writers update one and not the other: `renameProject` (:220-238) patches only the list — so `ProjectContext` (`contexts/ProjectContext.jsx:15`), which feeds BOTH editors' headers, `aspectRatio`, and `working_video_url`, serves the stale snapshot until an unrelated `refreshSelectedProject`. Demonstrable today: rename a project, open it — editor shows the old name.

## Solution

Single source: store `selectedProjectId` (+ any detail fields the detail fetch returns that the list lacks, MERGED into the list entry) and derive:

```
const selectSelectedProject = (s) => s.projects.find(p => p.id === s.selectedProjectId) ?? null;
```

- `selectProject(id)`: sets the id; if the detail endpoint returns extra fields, merge them into the list entry (one object, one truth).
- Every mutation (`renameProject`, ratio changes via T4230's single writer, working_video updates) touches the list entry only — derivation makes desync impossible.
- `ProjectContext` consumes the selector; audit consumers for shape assumptions (`grep -rn "selectedProject" src/frontend/src`).

## Context

- Files: `stores/projectsStore.js`, `contexts/ProjectContext.jsx`, consumers per grep
- House rules: memory "No redundant state"; state-management skill (raw list + selectors).
- Check what the detail fetch (`selectProject`) returns beyond list fields — if nothing, delete the second fetch entirely (page-load-optimization precedent: fewer duplicate fetches).

## Steps

1. [ ] Consumer + field inventory (list shape vs detail shape) in the Progress Log.
2. [ ] Unit test pinning the bug: rename → selector reflects new name immediately (fails on old code).
3. [ ] Migrate store + context + consumers; delete the snapshot state.
4. [ ] E2E: rename → open project → header/name correct; editors get correct aspectRatio/working_video_url.

## Acceptance Criteria

- [ ] `selectedProject` object state deleted; selector + id only
- [ ] Rename desync test green (red on old code)
- [ ] Detail fields merged into the list entry, or the redundant fetch removed
- [ ] No consumer reads a stale project snapshot (grep-verified)
