# T11790: One status ladder for a clip's progress

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Tier:** M (frontend only, ~7 files + tests, ~150 LOC)
**Created:** 2026-10-04
**Decision gate:** S1 (recommended A1). If S2 = Finish, the last rung's word comes from T11820.

## Epic Context

Task 1 of 5 in [Epic C](EPIC.md). Read the EPIC for the verified mechanism (four surfaces, one
state). Runs after T11760 (same `ProjectManager.jsx`). Milestone rules:
[README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/08](../../../ux/2026-10-04-parent-usability-audit/desktop/08-clips-status-inconsistent-spotlight.png),
[tablet/06](../../../ux/2026-10-04-parent-usability-audit/tablet/06-tablet-post-generation-jargon.png).
The parent skipped Add Spotlight, then saw their clip under "Draft, in Spotlight" with an "In
Spotlight" badge, while the filter chip said "In Overlay (1)". It reads as if the app changed the
video without asking.

## Solution (option A1): status word + a factual "what's done" qualifier

Statuses never name a mode the clip is "in". They say what has been done. Stage keys do not change.

| Stage key + condition | Group heading / detail | Tile badge + filter chip | Annotate play row status / CTA |
|---|---|---|---|
| NOT_STARTED | Draft, not framed yet | Not framed | Marked / Frame Highlight |
| IN_FRAMING | Draft, framing started | Framing | Framing started / Frame Highlight |
| IN_OVERLAY, `!has_overlay_edits` | Draft, framed | Framed | Framed / Add spotlight |
| IN_OVERLAY, `has_overlay_edits` | Draft, spotlight started | Spotlight started | Spotlight started / Add spotlight |
| READY, not published | Private, ready to watch | Private | Private / Preview Highlight |
| READY, published | Published | Published | Published / View Highlight |

- The `has_overlay_edits` split is a **label axis**, not a new `DRAFT_STAGE` key (same approach T9860
  used for Private/Published). It is already returned by the projects API.
- Tints: keep `DRAFT_STAGE_TINTS`; "Spotlight started" reuses `text-blue-300`.
- 390px: badges use the short form only; headings may wrap at the comma; no ellipsis.

## Relevant Files (under `src/frontend/src/`)

- `utils/draftStage.js:32` (labels), `:57-68` (`getDraftStage`), `:82-84` (status details).
- `components/DraftTile.jsx:469` - literal "In Spotlight"; read the shared map instead.
- `components/shared/CollapsibleGroup.jsx:148` - legend literal.
- `components/shared/SegmentedProgressStrip.jsx:203` - tooltip reads the stage label.
- `components/ProjectManager.jsx:692-700, 727-728, 1949` - filter buckets and chip labels.
- `modes/annotate/clipStage.js:139-140` - "Framed" / "Add Overlay to Highlight".
- `components/GameTile.jsx:336` - failed-upload line contains an em dash, "saved" and "annotations".
- `config/displayNames.js` - `MODE_NAMES`, `DRAFT_STAGE_LABELS` if it lives there.

## Implementation Steps

1. In `draftStage.js` add a `getDraftStageLabel(project)` (long) and `getDraftStageShortLabel(project)`
   that return the table's words, using `has_overlay_edits` for the IN_OVERLAY split. Keep
   `getDraftStage` as is.
2. Make DraftTile, CollapsibleGroup, SegmentedProgressStrip and the ProjectManager filter chips read
   those functions. Delete the literals.
3. Rebuild the Phase filter on `getDraftStage` buckets plus the short labels. Delete the inline
   "In Overlay" and "Generated" buckets. **Do this as its own commit** (behavior-preserving
   refactor separate from the copy change, refactoring rule 3).
4. `clipStage.js`: status "Framed", CTA "Add spotlight".
5. GameTile failed-upload line: "Upload didn't finish. Retry to keep your 3 marked plays." (pluralize;
   "plays" vs "annotations" follows decision H3; if H3 = keep, use "annotations").

## Acceptance Criteria

1. Frame a clip, choose Done for now: Clips shows "Draft, framed" heading, "Framed" badge, a "Framed (1)"
   filter chip. The words "Spotlight" and "Overlay" appear nowhere in that clip's status.
2. Open Spotlight, move the spotlight once, leave: the same clip reads "Draft, spotlight started".
3. A grep of `src/frontend/src` for `In Overlay` and `in ${MODE_NAMES.SPOTLIGHT}` returns no
   user-visible strings.
4. Annotate's play row and the Clips tile agree for the same clip.

## Tests (red first)

- `utils/draftStage.test.js`: one case per table row, including the `has_overlay_edits` split.
- `components/DraftTile.test.jsx`, `DraftTile.preview.test.jsx:100-101` (describe names),
  `components/shared/CollapsibleGroup.test.jsx`, `modes/annotate/clipStage.test.js`,
  `ProjectManager.gameGrouping.test.jsx`, `ProjectManager.threeTabIA.test.jsx`.
- E2E (local): `e2e/T9600-status-labels.qa.spec.js:13,48,113` asserts "Draft, in Spotlight"; update it.

## Landmines

- Stage keys drive tile sizing and row grouping. Change labels, not keys.
- Record in `docs/plans/tasks/T9860-design.md` (or its task file) that S1 reversed "Draft, in Spotlight" on 2026-10-04.
- T11430's aspect-qualified status wording lives in `clipStage.js` too; keep its aspect qualifier.
- If the user picks S1 option A3 (minimal), do steps 2-4 only for IN_OVERLAY with "Draft, framed" / "Framed" and skip the `has_overlay_edits` split.
