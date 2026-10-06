# T11910: Highlight list stays in sync with the server; Portrait and Landscape slots

**Status:** WIP
**Impact:** 9
**Complexity:** 5
**Tier:** L (frontend + backend, design-gated UX; approved 2026-10-06)
**Created:** 2026-10-06
**Updated:** 2026-10-06

## Epic Context

Follow-up to [T11840](T11840-rating-legibility-and-highlight-anyway.md) in [Epic D](EPIC.md). Found by the
user: making a "Brilliant Play" showed one layout (single Make Highlight button) and leaving and
coming back showed another (instance list plus Make Another Highlight).

## Problem

`region.highlightInstances` was filled only at game load (`useAnnotate.js` importer). A create set
only `autoProjectId` locally, so `AnnotateModeView` took the zero-instance branch right after
creating and the instance branch after a reload. Same class: an export finishing while Annotate
stays mounted never updated an instance's status. The screen also offered one default (Portrait)
CTA instead of an explicit Portrait or Landscape choice.

## Solution (user-approved 2026-10-06)

1. **Backend:** `POST /api/clips/raw/save` and `PUT /api/clips/raw/{id}` return the play's full
   `highlight_instances` (same serializer as load, same transaction); new read-only
   `GET /api/clips/raw/{id}/highlight-instances`; `aspect_ratio` accepted on the first-save path
   (422 on an unrecognized value, shared `_validated_aspect_ratio`).
2. **Frontend sync:** one mapper (`modes/annotate/highlightInstances.js`) shared by load and every
   response; create responses replace the list (never patched or appended locally; a response
   missing the list logs an error and leaves the list alone); export completion triggers a
   read-only refresh through the per-region write queue.
3. **One render path:** `HighlightOrientationSlots` (Portrait and Landscape slots, equal weight, no
   preselected default, use hints, per-slot Make button, filled slot opens that highlight; existing
   draft row says "Continue"). Legacy single stage CTA, instance list and "Make Another Highlight"
   removed. Edit play becomes an outline button.

UX consult (2026-10-06) recommended option (c), persistent orientation slots. Deferred pieces are
T11920 to T11940.

## Context

### Relevant Files
- `src/backend/app/routers/clips.py` - save/update responses, GET, `_validated_aspect_ratio`
- `src/backend/tests/test_t11910_highlight_instances_in_create_response.py`
- `src/frontend/src/modes/annotate/highlightInstances.js` (new), `hooks/useAnnotate.js`
- `src/frontend/src/containers/AnnotateContainer.jsx` - apply server list, export-complete refresh
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx` (new)
- `src/frontend/src/modes/AnnotateModeView.jsx`, `modes/annotate/clipStage.js`, `config/displayNames.js`
- Tests: `AnnotateContainer.highlightInstancesSync.test.jsx` (new), `AnnotateModeView.highlightInstances.test.jsx`, `AnnotateModeView.frameClip.test.jsx`
- e2e selectors updated: `e2e/new-user-flow.spec.js`, `e2e/T10760-selector-scoped-reads.qa.spec.js`

### Related Tasks
- Blocks: T11920 (remove `autoProjectId`), T11930, T11940

## Acceptance Criteria

- [x] Create response replaces the list with the server list; same shape as a reload
- [x] Export completion refreshes only the affected play, read-only
- [x] Portrait and Landscape each have their own Make button; neither preselected
- [x] Landscape can be the FIRST highlight of an unsaved play (`aspect_ratio` on save)
- [x] Live drive on a fixture game: Make Landscape sends 16:9, response holds both instances, reload shows both
- [ ] Independent proof verification VERIFIED
- [ ] Branch CI green for the final pushed SHA

## Progress Log

**2026-10-06**: Implemented and reviewed (Opus reviewer: no blocking or major findings). Red-to-green
proven: new frontend sync test fails 5/6 against the pre-change frontend (list undefined), backend
test fails 7/8 against the pre-change backend. Relevant frontend set 107 files / 845 tests green.
`test_t6030_migration_window_structural_guard.py` fails only when run in the shared main checkout
alongside other files (leftover user_data); passes alone and in a clean checkout. Pushed; awaiting
proof verifier and CI.
