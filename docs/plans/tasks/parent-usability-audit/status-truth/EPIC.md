# Epic C: Status you can trust after Generate

**Status:** TODO (decisions ruled 2026-10-04, see README decision register)
**Milestone:** [Parent Usability Audit](../README.md)
**Impact:** 9 | **Complexity:** 5
**Knowledge docs:** `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/annotate.md`

## Goal

Right after the parent's first credit spend, every label says what actually happened, and "Done for
now" leaves them looking at their work, not an empty-looking editor.

## Verified findings (2026-10-04)

- **"In Spotlight" is a label bug, not a state bug.** After a Framing render plus "Done for now", the
  project correctly sits in stage `IN_OVERLAY` ("framed, spotlight step next"). Nothing was applied.
  But four surfaces name that state differently, each reading only `has_working_video`:
  - group heading "Draft, in Spotlight": `utils/draftStage.js:32` (set on purpose by T9860)
  - tile badge "In Spotlight": `components/DraftTile.jsx:469` (a literal, outside `draftStage.js`)
  - legend "In Spotlight": `components/shared/CollapsibleGroup.jsx:148`
  - filter chip "In Overlay": `components/ProjectManager.jsx:1949`, whose matching (`:692-700`) and
    counts (`:727-728`) re-derive buckets inline, including a "Generated" bucket `getDraftStage` lacks
  - Annotate's `modes/annotate/clipStage.js:139-140` says "Framed" with the CTA "Add Overlay to Highlight".
  `has_overlay_edits` (`backend/app/routers/projects.py:444-447`) says whether spotlight work started.
- **"Done for now" lands on Annotate on purpose (T8390)** via `handleAddSpotlightLater`
  (`screens/FocusScreen.jsx:1115-1140`), but the play is **not re-selected**. The one consumer of the
  selection breadcrumb (`containers/AnnotateContainer.jsx:1408-1456`, armed at `:1219`) fires once and
  drops the breadcrumb with a `console.warn` (`:1450`) if nothing matches. Frame Highlight and Add
  Spotlight then show as locked (`ModeSwitcher.jsx:97-104`), and the page looks empty. The toast says
  "publish it from here", but "here" is Annotate.
- **"Publish" creates no audience.** It sets `final_videos.published_at`, archives the working data
  and moves the item from Clips to the Published tab. No link, no viewer. Sharing is a separate
  gesture. The status details make it worse: PRIVATE says "Only you can see it" and PUBLISHED says
  "Only you can see it until you share a link" (`utils/draftStage.js:82-84`): same audience, two words.
- **"Saved" chips** (`RESULT_RETENTION` in `displayNames.js:621-629`, T10670) conflict with the
  standing no-"Saved"-copy rule.
- **Loading:** while `/load` is in flight the Annotate header shows "0" plays and locked tabs
  (`AnnotateScreen.jsx:694`, `useAnnotate.js:801`). The static preloader says "Ready" while it fades
  over the page (`App.jsx:241-250`).

## Prior decisions this epic touches (record any reversal in the old task's file)

- T8470 (upheld 2026-09-10): statuses are Draft / Private / Published with `draftStage.js` as the
  single source. **Kept** under the recommended options.
- T9600: no surface invents its own status word. **Kept and finished** by T11790.
- T9860 (2026-09): chose "Draft, in Spotlight". **Reversed** by S1.
- T8555 / T9530 N12 (2026-09-10) / T10180 / T9860 D5: "Publish" and the Published tab. **Reversed** (S2 ruled "Finish" 2026-10-04).

- T8390: "Done for now" returns to Annotate. **Kept** under S3 option C2.
- T10670 (2026-09-19): ready-screen copy and the "Saved" chip. Copy changed by S4, chip removed by S5.

## Design decisions

Full proposal: [after-generate.md](../../../ux/2026-10-04-parent-usability-audit/design/after-generate.md).

## Tasks

| ID | Task | Status |
|----|------|--------|
| T11790 | [One status ladder for a clip's progress](T11790-one-status-ladder.md) | STAGING |
| T11800 | ["Done for now" re-selects the play and confirms](T11800-done-for-now-reselect-and-confirm.md) | TODO |
| T11810 | [Ready-screen copy and no "Saved" chip](T11810-ready-screen-copy-and-saved-chip.md) | TODO |
| T11820 | [Rename Publish to Finish across the app ](T11820-publish-to-finish-sweep.md) | TODO |
| T11830 | [No fake zeros or "Ready" while loading](T11830-loading-placeholders-and-preloader.md) | TODO |

T11790 first (critical, independent). T11800 and T11830 can run in parallel with it. T11810 then
T11820 (T11820 sweeps strings T11810 just set).

## Completion criteria

- [ ] A framed clip with no spotlight is labeled the same way on every surface, and no surface says
      "Spotlight" or "Overlay" for it.
- [ ] "Done for now" lands with the play selected and a visible confirmation naming the clip.
- [ ] No "Saved" copy remains on the ready screen.
- [ ] `export-pipeline.md` and `annotate.md` updated (status ladder, Done-for-now landing).
