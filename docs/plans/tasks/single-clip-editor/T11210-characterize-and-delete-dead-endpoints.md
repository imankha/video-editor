# T11210: Characterization - single-clip Modal golden + delete dead endpoints

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

The only Modal-branch export characterization is multi-clip
(`tests/test_export_golden_multiclip_modal.py`, fixture `clip_count=2` at :42). Once multi-clip
goes, the single-clip Modal path through `multi_clip._export_clips` has no golden. Several
endpoints and helpers are already dead and can go first with zero behavior change.

## Solution

1. **Add a single-clip Modal golden** mirroring the multi-clip one, green on master BEFORE any
   deletion in T11250.
2. **Delete dead code** (no callers, verify with grep at implementation time):
   - `POST /api/export/chapters`, `POST /api/export/concat-for-overlay` (`routers/export/multi_clip.py:2530-2726`)
   - `POST /api/projects` (`projects.py:684`) + `projectsStore.createProject` (`projectsStore.js:140`)
   - `POST /api/projects/preview-clips` (`projects.py:756`)
   - `ProjectCreationSettings.jsx` (no importers)
   - `projectDataStore.reorderClipsOnServer` stub (`:352`, no callers)

Pure deletion + one new test. No behavior change.

## Context

### Related Tasks
- Blocks: T11250 (needs the golden)
- Independent of T11200/T11220

## Acceptance Criteria

- [ ] New single-clip Modal golden passes on master before and after
- [ ] Deleted symbols have zero references (grep evidence in the PR)
- [ ] Existing goldens + `test_export_golden_local_render.py` unchanged and green
