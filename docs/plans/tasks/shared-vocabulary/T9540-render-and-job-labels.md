# T9540: Render, job, progress and completion labels

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N19-N21, N23-N25, N37, N44, UX-11 (handoff E1-03, E6-01)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

**This is the child with real plumbing, not just strings.** Today "Export Focused Video" produces a
toast saying "Creating reel..." and finishes as "Export Complete" - but the export is not complete,
because **"Add Overlay" is the button that actually renders the final video.** A parent cannot tell
which stage finished, what the next stage costs, or whether they are done. "Add" naming a render is
the specific inversion the report calls out.

Progress copy leaks internals: "Computing hash", "Hash complete", "frame 150/180", "Detecting
players".

## Rename table

| Group | Observed | Becomes |
|-------|----------|---------|
| N19 | Export Focused Video / Creating reel | **Generate framed clip** / **Framing clip...** / **Framed clip ready** |
| N20 | Add Overlay / Creating reel... | **Export clip with effects** / **Exporting clip...** |
| N21 | Export Complete / Complete / Completed | **Framing ready** or **Clip ready** - name the stage that finished |
| N23 | Publish Now / Publish to Highlight Reels | **Publish clip** / **Publish reel** (helper: creates a share link) |
| N24 | Publish Later / Saved to Clips | **Save draft** / **Draft saved** - what happens now, not a future obligation |
| N25 | Reapply Overlay / Reapply Focus / Open in Focus | **Edit effects** / **Edit framing**, with the re-render cost stated first |
| N37 | Computing hash / frame 150/180 / Detecting players | **Preparing video** / **Uploading** / **Rendering** / **Finding players for spotlight** (counters as optional detail) |
| N44 | Refocus / Reapply Focus / Open in Focus | **Edit framing** (one name) |

Note the interaction with the epic override: the **mode** is still called **AI Focus**, but the
**render action** is "Generate framed clip". Those are consistent - one names a place, the other
names a job.

## Beyond strings (UX-11 behavior)

- The job name in the button, the progress toast, the job list and the completion message must all
  name the **same object and stage**.
- Keep background jobs visible across navigation; do not disable unrelated game annotation while one
  runs.
- Preserve draft state on render failure and offer Retry with correct billing behavior.
- **No duplicate job or charge on double click.**
- Show backend-confirmed cost, including zero where that is true - never invent a free stage.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` - `FOCUS_PUBLISH`, `OVERLAY_PUBLISH` blocks
- Export button / job progress components and their toasts
- `src/backend/app/routers/exports.py` - job naming and cost confirmation
- `.claude/knowledge/export-pipeline.md` - read before exploring

### Related Tasks
- T9590 - the post-Focus action bar carries several of these labels; sequence so they agree
- T7580 previously did a Focus/Export naming pass - check what it settled before re-renaming
- T9680 - confirmed cost rules

### Technical Notes
The double-click and cross-navigation requirements are behavior, not copy. Treat this as an
implementation task with a rename inside it, not a string sweep.

## Acceptance Criteria

- [ ] Each button, job label, progress toast and completion message names the same object and stage
- [ ] A completed job opens or links to its correct result
- [ ] Double click produces no duplicate job and no duplicate charge
- [ ] Background jobs stay visible across navigation and do not disable unrelated annotation
- [ ] Displayed cost is backend-confirmed, with no invented free stage
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
